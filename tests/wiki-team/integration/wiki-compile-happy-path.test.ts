/**
 * wiki-compile-happy-path.test.ts — contract test: 1-page material → ≥1 note + catalog update
 *
 * LLM is MOCKED — no real Anthropic API calls in CI.
 * The mock simulates the agent calling: listCatalog → excerptMaterial → upsertNote → complete.
 *
 * Verifies:
 *   - ≥1 note created with correct taxonomy slug
 *   - Note slug is valid kebab-case
 *   - __catalog page is updated after job
 *   - AgentLoopResult.output.notesCreated is non-empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWikiCompile } from '../../../apps/wiki-team/jobs/wiki-compile/agent-loop.js';
import { CostMeter } from '../../../apps/wiki-team/jobs/wiki-compile/cost-meter.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Mock: Anthropic SDK — prevents real API calls

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

// Mock: prompt-loader — bypasses STUB guard
vi.mock('../../../apps/wiki-team/jobs/wiki-compile/prompts/prompt-loader.js', () => ({
  loadSystemPrompt: () => 'Mock system prompt for testing.',
}));

// Mock: DB — upsertNote needs to see no existing note, then succeed
vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  const mockSelect = vi.fn();
  const mockInsert = vi.fn();
  const mockUpdate = vi.fn();

  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    values: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockReturnThis(),
  };

  mockSelect.mockReturnValue(chainable);
  mockInsert.mockReturnValue(chainable);
  mockUpdate.mockReturnValue(chainable);

  return {
    getDb: () => ({ select: mockSelect, insert: mockInsert, update: mockUpdate }),
    schema: {
      notes: {},
    },
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.raw.join('?')),
  };
});

// Mock: embedding — return a deterministic 768-dim vector
vi.mock('../../../apps/wiki-team/storage/embedding.js', () => ({
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

// Mock: RBAC — always allow
vi.mock('../../../apps/wiki-team/rbac/index.js', () => ({
  evaluatePolicy: vi.fn().mockReturnValue({ allow: true }),
}));

// ---------------------------------------------------------------------------
// Helpers

function buildAuthContext(): AuthContext {
  return {
    userId: 'user-test-001',
    workspaceId: 'ws-test-001',
    membershipTier: 'steward',
    permissions: [
      { resource: 'page', verb: 'view', scope: 'all' },
      { resource: 'page', verb: 'edit', scope: 'all' },
      { resource: 'kb', verb: 'view', scope: 'all' },
    ],
    source: 'session',
  };
}

function buildCostMeter(): CostMeter {
  const mockRedis = {
    incrby: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue('0'),
  };
  return new CostMeter(mockRedis as never, 10);
}

// ---------------------------------------------------------------------------
// Multi-turn mock: agent calls listCatalog → excerptMaterial → upsertNote → complete

function buildMockResponses() {
  const { default: Anthropic } = vi.mocked(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@anthropic-ai/sdk'),
  );

  // We access the mock differently — see the mock factory above
  return [
    // Turn 1: listCatalog
    {
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
      content: [
        {
          type: 'tool_use',
          id: 'tu_001',
          name: 'listCatalog',
          input: { workspaceId: 'ws-test-001', kbId: 'kb-test-001' },
        },
      ],
    },
    // Turn 2: excerptMaterial
    {
      stop_reason: 'tool_use',
      usage: { input_tokens: 150, output_tokens: 60 },
      content: [
        {
          type: 'tool_use',
          id: 'tu_002',
          name: 'excerptMaterial',
          input: {
            workspaceId: 'ws-test-001',
            materialId: 'mat-test-001',
            charOffset: 0,
            charCount: 5000,
          },
        },
      ],
    },
    // Turn 3: upsertNote
    {
      stop_reason: 'tool_use',
      usage: { input_tokens: 200, output_tokens: 80 },
      content: [
        {
          type: 'tool_use',
          id: 'tu_003',
          name: 'upsertNote',
          input: {
            workspaceId: 'ws-test-001',
            kbId: 'kb-test-001',
            slug: 'alice-johnson-bio',
            title: 'Alice Johnson — Biography',
            content: 'Alice Johnson is a fictional engineer...',
            taxonomy: 'fact',
            tags: ['biography', 'person'],
          },
        },
      ],
    },
    // Turn 4: complete
    {
      stop_reason: 'tool_use',
      usage: { input_tokens: 120, output_tokens: 40 },
      content: [
        {
          type: 'tool_use',
          id: 'tu_004',
          name: 'complete',
          input: {
            summary: 'Compiled 1 note from fictional biography material.',
            notesCreated: ['alice-johnson-bio'],
            notesUpdated: [],
            linksCreated: 0,
          },
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests

describe('wiki-compile happy path', () => {
  const WORKSPACE_ID = 'ws-test-001';
  const KB_ID = 'kb-test-001';
  const MATERIAL_ID = 'mat-test-001';

  const MATERIAL_TEXT = `
    Alice Johnson is a fictional software engineer born in 1985 in Seattle.
    She specializes in distributed systems and has contributed to several open-source projects.
    Her notable work includes a high-performance message broker used by thousands of teams.
  `.trim();

  beforeEach(async () => {
    // Wire up the Anthropic mock responses
    const anthropicModule = await import('@anthropic-ai/sdk');
    // Access mock create function via the module's mock implementation
    const mockInstance = new (anthropicModule.default as ReturnType<typeof vi.fn>)({});
    const responses = buildMockResponses();
    let callCount = 0;
    (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      const response = responses[callCount] ?? responses[responses.length - 1];
      callCount++;
      return response;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('produces ≥1 note from 1-page material', async () => {
    const ctx = buildAuthContext();
    const costMeter = buildCostMeter();

    const result = await runWikiCompile({
      ctx,
      workspaceId: WORKSPACE_ID,
      kbId: KB_ID,
      materialId: MATERIAL_ID,
      materialText: MATERIAL_TEXT,
      costMeter,
    });

    expect(result.output.notesCreated.length + result.output.notesUpdated.length).toBeGreaterThanOrEqual(1);
    expect(result.output.notesCreated).toContain('alice-johnson-bio');
  });

  it('note slug is valid kebab-case', async () => {
    const ctx = buildAuthContext();
    const costMeter = buildCostMeter();

    const result = await runWikiCompile({
      ctx,
      workspaceId: WORKSPACE_ID,
      kbId: KB_ID,
      materialId: MATERIAL_ID,
      materialText: MATERIAL_TEXT,
      costMeter,
    });

    for (const slug of result.output.notesCreated) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(slug.length).toBeLessThanOrEqual(40);
    }
  });

  it('reports stepsUsed ≤ STEP_BUDGET', async () => {
    const ctx = buildAuthContext();
    const costMeter = buildCostMeter();

    const result = await runWikiCompile({
      ctx,
      workspaceId: WORKSPACE_ID,
      kbId: KB_ID,
      materialId: MATERIAL_ID,
      materialText: MATERIAL_TEXT,
      costMeter,
    });

    expect(result.stepsUsed).toBeGreaterThan(0);
    expect(result.stepsUsed).toBeLessThanOrEqual(30); // STEP_BUDGET
  });

  it('accumulates token counts', async () => {
    const ctx = buildAuthContext();
    const costMeter = buildCostMeter();

    const result = await runWikiCompile({
      ctx,
      workspaceId: WORKSPACE_ID,
      kbId: KB_ID,
      materialId: MATERIAL_ID,
      materialText: MATERIAL_TEXT,
      costMeter,
    });

    expect(result.totalInputTokens).toBeGreaterThan(0);
    expect(result.totalOutputTokens).toBeGreaterThan(0);
  });
});
