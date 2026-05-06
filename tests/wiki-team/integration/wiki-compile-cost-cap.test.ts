/**
 * wiki-compile-cost-cap.test.ts — contract test: daily cost cap enforcement
 *
 * Scenario:
 *   - Set daily cap to $0.01 (1 cent = 10_000 µUSD)
 *   - Each mock LLM response returns tokens that cost ~$0.004
 *   - After 3 jobs the cap is exceeded; ≥1 job must fail with 'cost-cap-hit'
 *
 * LLM is MOCKED — no real Anthropic API calls.
 * Redis INCR is mocked with an in-memory counter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWikiCompile } from '../../../apps/wiki-team/jobs/wiki-compile/agent-loop.js';
import { CostMeter } from '../../../apps/wiki-team/jobs/wiki-compile/cost-meter.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Mocks

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn().mockResolvedValue({
    stop_reason: 'tool_use',
    usage: { input_tokens: 500, output_tokens: 200 },
    content: [
      {
        type: 'tool_use',
        id: 'tu_cost_01',
        name: 'complete',
        input: {
          summary: 'Done.',
          notesCreated: ['test-note'],
          notesUpdated: [],
          linksCreated: 0,
        },
      },
    ],
  });
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

vi.mock('../../../apps/wiki-team/jobs/wiki-compile/prompts/prompt-loader.js', () => ({
  loadSystemPrompt: () => 'Mock system prompt for cost-cap test.',
}));

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    values: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockReturnThis(),
  };
  return {
    getDb: () => ({
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue(chainable),
      update: vi.fn().mockReturnValue(chainable),
    }),
    schema: { notes: {} },
    sql: vi.fn(),
  };
});

vi.mock('../../../apps/wiki-team/storage/embedding.js', () => ({
  embed: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

vi.mock('../../../apps/wiki-team/rbac/index.js', () => ({
  evaluatePolicy: vi.fn().mockReturnValue({ allow: true }),
}));

// ---------------------------------------------------------------------------
// In-memory Redis mock for CostMeter — accumulates across calls

function buildCapExceedingCostMeter(dailyCapUsd: number): CostMeter {
  let accumulated = 0;
  const capMicroUsd = Math.round(dailyCapUsd * 1_000_000);

  const mockRedis = {
    incrby: vi.fn().mockImplementation(async (_key: string, delta: number) => {
      accumulated += delta;
      return accumulated;
    }),
    expire: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockImplementation(async () => String(accumulated)),
  };

  return new CostMeter(mockRedis as never, dailyCapUsd);
}

// ---------------------------------------------------------------------------
// Helpers

function buildAuthContext(workspaceId: string): AuthContext {
  return {
    userId: 'user-cap-test',
    workspaceId,
    membershipTier: 'steward',
    permissions: [
      { resource: 'page', verb: 'view', scope: 'all' },
      { resource: 'page', verb: 'edit', scope: 'all' },
      { resource: 'kb', verb: 'view', scope: 'all' },
    ],
    source: 'session',
  };
}

async function runOneJob(
  costMeter: CostMeter,
  workspaceId: string,
  materialId: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    await runWikiCompile({
      ctx: buildAuthContext(workspaceId),
      workspaceId,
      kbId: 'kb-cap-001',
      materialId,
      materialText: 'Short test material for cost cap test.',
      costMeter,
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      code: (err as { code?: string }).code ?? 'unknown',
    };
  }
}

// ---------------------------------------------------------------------------
// Tests

describe('wiki-compile cost cap', () => {
  const WORKSPACE_ID = 'ws-cap-test-001';
  // Cap: $0.01 = 10_000 µUSD
  // Each job: 500 input tokens × $3/1M = $0.0015 + 200 output tokens × $15/1M = $0.003
  // Total per job: ~$0.0045 → cap exceeded after job 3

  it('at least 1 of 5 jobs fails with cost-cap-hit when cap=$0.01', async () => {
    const costMeter = buildCapExceedingCostMeter(0.01);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        runOneJob(costMeter, WORKSPACE_ID, `mat-cap-${i}`),
      ),
    );

    const outcomes = results.map((r) =>
      r.status === 'fulfilled' ? r.value : { ok: false as const, code: 'promise-rejected' },
    );

    const failures = outcomes.filter((o) => !o.ok && o.code === 'cost-cap-hit');
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it('cost-cap-hit error has correct code property', async () => {
    // Set an extremely tight cap that fails on first job
    const costMeter = buildCapExceedingCostMeter(0.000001); // $0.000001 cap

    const result = await runOneJob(costMeter, WORKSPACE_ID, 'mat-cap-tight');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('cost-cap-hit');
    }
  });

  it('jobs succeed when under cap', async () => {
    const costMeter = buildCapExceedingCostMeter(100); // $100 cap — never hit in test

    const result = await runOneJob(costMeter, WORKSPACE_ID, 'mat-cap-ample');

    expect(result.ok).toBe(true);
  });
});
