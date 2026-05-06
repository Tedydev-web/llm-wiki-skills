/**
 * wiki-compile-rbac-denial.test.ts — contract test: 0-permission token fails before LLM call
 *
 * Scenario:
 *   - AuthContext with empty permissions array (zero-permission token)
 *   - Agent calls listCatalog as first tool
 *   - evaluatePolicy returns DENY → tool throws rbac-denied
 *   - agent-loop propagates rbac-denied immediately (no retry)
 *   - LLM must NOT be called more than once (first call sends tool result with error;
 *     second tool call from model hits RBAC again → loop propagates)
 *
 * Key assertion: job fails with code 'rbac-denied' BEFORE any write to DB.
 * LLM is MOCKED — no real Anthropic API calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWikiCompile } from '../../../apps/wiki-team/jobs/wiki-compile/agent-loop.js';
import { CostMeter } from '../../../apps/wiki-team/jobs/wiki-compile/cost-meter.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Mocks

// Track whether any DB write was attempted
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  // LLM mock: first call returns listCatalog tool use.
  // If RBAC is working, the rbac-denied error propagates before a second LLM call.
  // If rbac-denied is NOT propagated, the loop would continue and call LLM again.
  const mockCreate = vi.fn()
    .mockResolvedValueOnce({
      stop_reason: 'tool_use',
      usage: { input_tokens: 80, output_tokens: 30 },
      content: [
        {
          type: 'tool_use',
          id: 'tu_rbac_01',
          name: 'listCatalog',
          input: { workspaceId: 'ws-rbac-test', kbId: 'kb-rbac-test' },
        },
      ],
    })
    // Second response should never be reached if rbac-denied propagates correctly.
    // If it is reached, the test will see a non-rbac-denied failure.
    .mockResolvedValue({
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'done' }],
    });

  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

vi.mock('../../../apps/wiki-team/jobs/wiki-compile/prompts/prompt-loader.js', () => ({
  loadSystemPrompt: () => 'Mock system prompt for RBAC denial test.',
}));

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    values: mockInsert,
    set: vi.fn().mockReturnThis(),
  };
  return {
    getDb: () => ({
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue(chainable),
      update: vi.fn().mockReturnValue({ ...chainable, values: mockUpdate }),
    }),
    schema: { notes: {} },
    sql: vi.fn(),
  };
});

vi.mock('../../../apps/wiki-team/storage/embedding.js', () => ({
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0.0)),
}));

// RBAC mock: DENY for page.view (the first tool's gate)
vi.mock('../../../apps/wiki-team/rbac/index.js', () => ({
  evaluatePolicy: vi.fn().mockReturnValue({
    allow: false,
    reason: 'no-grant',
  }),
}));

// ---------------------------------------------------------------------------
// Helpers

function buildZeroPermissionContext(): AuthContext {
  return {
    userId: 'user-rbac-test',
    workspaceId: 'ws-rbac-test',
    membershipTier: 'observer',
    permissions: [], // zero permissions
    source: 'mcp-token',
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
// Tests

describe('wiki-compile RBAC denial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('fails with rbac-denied when token has zero permissions', async () => {
    const ctx = buildZeroPermissionContext();
    const costMeter = buildCostMeter();

    let caughtError: Error & { code?: string } | null = null;

    try {
      await runWikiCompile({
        ctx,
        workspaceId: 'ws-rbac-test',
        kbId: 'kb-rbac-test',
        materialId: 'mat-rbac-test',
        materialText: 'Some material content.',
        costMeter,
      });
    } catch (err) {
      caughtError = err as Error & { code?: string };
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('rbac-denied');
  });

  it('does not write any notes before rbac-denied is thrown', async () => {
    const ctx = buildZeroPermissionContext();
    const costMeter = buildCostMeter();

    try {
      await runWikiCompile({
        ctx,
        workspaceId: 'ws-rbac-test',
        kbId: 'kb-rbac-test',
        materialId: 'mat-rbac-test',
        materialText: 'Some material content.',
        costMeter,
      });
    } catch {
      // expected
    }

    // DB insert (upsertNote) must NOT have been called before RBAC denied
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rbac-denied error message contains denial reason', async () => {
    const ctx = buildZeroPermissionContext();
    const costMeter = buildCostMeter();

    let caughtError: Error | null = null;

    try {
      await runWikiCompile({
        ctx,
        workspaceId: 'ws-rbac-test',
        kbId: 'kb-rbac-test',
        materialId: 'mat-rbac-test',
        materialText: 'Some material content.',
        costMeter,
      });
    } catch (err) {
      caughtError = err as Error;
    }

    expect(caughtError?.message).toContain('rbac-denied');
  });

  it('recursion guard blocks worker with WIKI_COMPILE_INTERNAL_INVOCATION=1', async () => {
    const originalEnv = process.env['WIKI_COMPILE_INTERNAL_INVOCATION'];
    process.env['WIKI_COMPILE_INTERNAL_INVOCATION'] = '1';

    const ctx = buildZeroPermissionContext();
    const costMeter = buildCostMeter();

    let caughtError: Error & { code?: string } | null = null;

    try {
      await runWikiCompile({
        ctx,
        workspaceId: 'ws-rbac-test',
        kbId: 'kb-rbac-test',
        materialId: 'mat-rbac-test',
        materialText: 'Some material content.',
        costMeter,
      });
    } catch (err) {
      caughtError = err as Error & { code?: string };
    } finally {
      // Restore env
      if (originalEnv === undefined) {
        delete process.env['WIKI_COMPILE_INTERNAL_INVOCATION'];
      } else {
        process.env['WIKI_COMPILE_INTERNAL_INVOCATION'] = originalEnv;
      }
    }

    expect(caughtError).not.toBeNull();
    expect(caughtError?.code).toBe('recursion-detected');
  });
});
