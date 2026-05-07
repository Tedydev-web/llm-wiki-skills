/**
 * ivfflat-auto-create.test.ts — integration tests for createIvfflatIndexes
 *
 * Mocks DB to avoid real Postgres. Tests:
 *   - skips index when rowCount <= 1000
 *   - creates index when rowCount > 1000 and no existing index
 *   - skips when index already exists
 *   - lists tuning: GREATEST(100, LEAST(1000, ROUND(SQRT(count))))
 *   - errors per dim are caught without aborting other dims
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB + logger

vi.mock('../../../apps/wiki-team/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const executeMock = vi.fn();
vi.mock('../../../apps/wiki-team/storage/db.js', () => ({
  getDb: () => ({ execute: executeMock }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _sql: strings.raw.join(''),
      _values: values,
    }),
    {
      raw: (s: string) => ({ _raw: s }),
    },
  ),
}));

import { createIvfflatIndexes } from '../../../apps/wiki-team/services/ivfflat-index-creator.js';

// ---------------------------------------------------------------------------
// Helpers

/**
 * Build execute mock sequence for a single dimension:
 *   call 1 → rowCount (COUNT query)
 *   call 2 → pg_indexes check (exists or not)
 *   call 3 → CREATE INDEX (if created)
 */
function setupDimMocks(dims: Array<{ rowCount: number; indexExists: boolean; failCreate?: boolean }>) {
  executeMock.mockReset();
  for (const d of dims) {
    // COUNT query
    executeMock.mockResolvedValueOnce([{ cnt: d.rowCount }]);
    // pg_indexes check
    executeMock.mockResolvedValueOnce(d.indexExists ? [{ '?column?': 1 }] : []);
    // CREATE INDEX (only called when rowCount > 1000 and !indexExists)
    if (d.rowCount > 1000 && !d.indexExists) {
      if (d.failCreate) {
        executeMock.mockRejectedValueOnce(new Error('CREATE INDEX failed'));
      } else {
        executeMock.mockResolvedValueOnce(undefined);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests

describe('createIvfflatIndexes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips index creation when all dims are below threshold (<=1000 rows)', async () => {
    setupDimMocks([
      { rowCount: 0, indexExists: false },
      { rowCount: 500, indexExists: false },
      { rowCount: 1000, indexExists: false },
    ]);

    const summary = await createIvfflatIndexes();

    expect(summary.results).toHaveLength(3);
    for (const r of summary.results) {
      expect(r.created).toBe(false);
      expect(r.skippedReason).toContain('threshold');
    }
  });

  it('creates index when rowCount > 1000 and no existing index', async () => {
    setupDimMocks([
      { rowCount: 5000, indexExists: false }, // 768
      { rowCount: 0, indexExists: false },    // 1024
      { rowCount: 0, indexExists: false },    // 1536
    ]);

    const summary = await createIvfflatIndexes();
    const dim768 = summary.results.find((r) => r.dim === 768)!;
    expect(dim768.created).toBe(true);
    expect(dim768.lists).toBe(Math.max(100, Math.min(1000, Math.round(Math.sqrt(5000)))));
  });

  it('skips creation when index already exists', async () => {
    setupDimMocks([
      { rowCount: 10000, indexExists: true }, // 768
      { rowCount: 0, indexExists: false },    // 1024
      { rowCount: 0, indexExists: false },    // 1536
    ]);

    const summary = await createIvfflatIndexes();
    const dim768 = summary.results.find((r) => r.dim === 768)!;
    expect(dim768.created).toBe(false);
    expect(dim768.indexExists).toBe(true);
    expect(dim768.skippedReason).toBe('index_already_exists');
  });

  it('computes lists = GREATEST(100, LEAST(1000, ROUND(SQRT(count))))', async () => {
    const cases: Array<[number, number]> = [
      [1001, 100],      // sqrt(1001) ≈ 31.6 → round(31.6)=32, but GREATEST(100,32)=100
      [10000, 100],     // sqrt(10000)=100 → GREATEST(100,100)=100
      [1_000_000, 1000], // sqrt(1M)=1000 → LEAST(1000,1000)=1000
      [4000000, 1000],  // sqrt(4M)=2000 → LEAST(1000,2000)=1000
    ];

    for (const [rowCount, expectedLists] of cases) {
      executeMock.mockReset();
      setupDimMocks([
        { rowCount, indexExists: false },
        { rowCount: 0, indexExists: false },
        { rowCount: 0, indexExists: false },
      ]);
      const summary = await createIvfflatIndexes();
      const dim768 = summary.results.find((r) => r.dim === 768)!;
      expect(dim768.lists).toBe(expectedLists);
    }
  });

  it('continues processing remaining dims when one dim errors', async () => {
    // 768: count fails entirely (first execute throws)
    executeMock.mockReset();
    executeMock.mockRejectedValueOnce(new Error('count query failed')); // 768 count
    // 1024: normal skip
    executeMock.mockResolvedValueOnce([{ cnt: 0 }]);
    executeMock.mockResolvedValueOnce([]);
    // 1536: normal skip
    executeMock.mockResolvedValueOnce([{ cnt: 0 }]);
    executeMock.mockResolvedValueOnce([]);

    const summary = await createIvfflatIndexes();
    expect(summary.results).toHaveLength(3);

    const dim768 = summary.results.find((r) => r.dim === 768)!;
    expect(dim768.created).toBe(false);
    expect(dim768.skippedReason).toContain('error');

    // Other dims should still be processed
    const dim1024 = summary.results.find((r) => r.dim === 1024)!;
    expect(dim1024.skippedReason).toContain('threshold');
  });

  it('returns durationMs in result', async () => {
    setupDimMocks([
      { rowCount: 0, indexExists: false },
      { rowCount: 0, indexExists: false },
      { rowCount: 0, indexExists: false },
    ]);

    const summary = await createIvfflatIndexes();
    expect(typeof summary.durationMs).toBe('number');
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});
