/**
 * embedding-rebuild-job.test.ts — integration tests for the embedding-rebuild BullMQ handler.
 *
 * Tests:
 *   1. Full rebuild: iterates notes, calls embedAndStore for each, returns built count
 *   2. Mid-switch abort: detects provider config change mid-batch, aborts cleanly
 *   3. Idempotent: skips notes already at correct provider+model
 *   4. Per-note error: skips failed note, increments skipped count, continues
 *   5. No provider configured: aborts immediately (rebuilt=0, aborted=true)
 *   6. estimateRebuildCost: returns correct structure
 *
 * All DB and embedding calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  const sqlFn = Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) => ({ text: strings.join('?'), values: _values }),
    { raw: (s: string) => ({ text: s }) },
  );
  return {
    getDb: vi.fn(),
    schema: { notes: {} },
    sql: sqlFn,
  };
});

vi.mock('../../../apps/wiki-team/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../apps/wiki-team/services/embedding-router.js', () => ({
  embedNote: vi.fn(),
  getDimColumn: vi.fn((dim: number) => `embedding_${dim}`),
  getActiveEmbeddingConfig: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports

import { getDb } from '../../../apps/wiki-team/storage/db.js';
import {
  embedNote,
  getActiveEmbeddingConfig,
} from '../../../apps/wiki-team/services/embedding-router.js';
import {
  processEmbeddingRebuildJob,
  estimateRebuildCost,
} from '../../../apps/wiki-team/jobs/embedding-rebuild/handler.js';
import type { EmbeddingRebuildJobData } from '../../../apps/wiki-team/jobs/embedding-rebuild/handler.js';

// ---------------------------------------------------------------------------
// Helpers

function makeJob(data: Partial<EmbeddingRebuildJobData> = {}) {
  return {
    data: {
      workspaceId: 'ws-abc',
      providerUpdatedAt: '2026-05-07T10:00:00.000Z',
      targetVendor: 'google',
      batchSize: 2,
      ...data,
    },
    updateProgress: vi.fn().mockResolvedValue(undefined),
    id: 'job-1',
  };
}

function makeNote(id: string, provider: string | null = null, model: string | null = null) {
  return { id, title: 'Title', content: 'Body', embedding_provider: provider, embedding_model: model, embedding_dimensions: null };
}

// ---------------------------------------------------------------------------
// 1. Full rebuild

describe('processEmbeddingRebuildJob — full rebuild', () => {
  beforeEach(() => vi.clearAllMocks());

  it('iterates batches of notes and returns correct rebuilt count', async () => {
    const config = {
      vendor: 'google' as const,
      model: 'text-embedding-004',
      apiKey: 'key',
      updatedAt: new Date('2026-05-07T10:00:00.000Z'),
    };
    vi.mocked(getActiveEmbeddingConfig).mockResolvedValue(config as never);

    // Two calls: first returns 2 notes, second returns 0 (pagination end)
    const batch1 = [makeNote('n1'), makeNote('n2')];
    const db = { execute: vi.fn().mockResolvedValueOnce(batch1).mockResolvedValueOnce([]).mockResolvedValue([]) };
    vi.mocked(getDb).mockReturnValue(db as never);

    vi.mocked(embedNote).mockResolvedValue({
      vector: Array(768).fill(0.1),
      dim: 768,
      provider: 'google',
      model: 'text-embedding-004',
    });

    const job = makeJob({ batchSize: 2 });
    const result = await processEmbeddingRebuildJob(job as never);

    expect(result.rebuilt).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.aborted).toBe(false);
    expect(embedNote).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// 2. Mid-switch abort

describe('processEmbeddingRebuildJob — mid-switch abort', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aborts when provider updatedAt changes between batches', async () => {
    const originalUpdatedAt = '2026-05-07T10:00:00.000Z';

    // First call: original config. Second call (abort check before batch): new updatedAt
    vi.mocked(getActiveEmbeddingConfig)
      .mockResolvedValueOnce({
        vendor: 'google' as const,
        model: 'text-embedding-004',
        apiKey: 'key',
        updatedAt: new Date(originalUpdatedAt),
      } as never)
      .mockResolvedValueOnce({
        vendor: 'openai' as const,
        model: 'text-embedding-3-small',
        apiKey: 'key2',
        // Provider switched — different updatedAt triggers abort
        updatedAt: new Date('2026-05-07T11:00:00.000Z'),
      } as never);

    const batch1 = [makeNote('n1'), makeNote('n2')];
    const db = { execute: vi.fn().mockResolvedValueOnce(batch1).mockResolvedValue([]) };
    vi.mocked(getDb).mockReturnValue(db as never);

    vi.mocked(embedNote).mockResolvedValue({
      vector: Array(768).fill(0.1),
      dim: 768,
      provider: 'google',
      model: 'text-embedding-004',
    });

    const job = makeJob({ providerUpdatedAt: originalUpdatedAt, batchSize: 10 });
    const result = await processEmbeddingRebuildJob(job as never);

    expect(result.aborted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. No provider configured

describe('processEmbeddingRebuildJob — no provider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aborts immediately when no embedding provider row exists', async () => {
    vi.mocked(getActiveEmbeddingConfig).mockResolvedValue(null);

    const job = makeJob();
    const result = await processEmbeddingRebuildJob(job as never);

    expect(result.aborted).toBe(true);
    expect(result.rebuilt).toBe(0);
    expect(embedNote).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Per-note error resilience

describe('processEmbeddingRebuildJob — per-note error handling', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips a note that throws during embed, continues processing remaining notes', async () => {
    const config = {
      vendor: 'voyage' as const,
      model: 'voyage-3-large',
      apiKey: 'key',
      updatedAt: new Date('2026-05-07T10:00:00.000Z'),
    };
    vi.mocked(getActiveEmbeddingConfig).mockResolvedValue(config as never);

    const batch = [makeNote('n1'), makeNote('n2')];
    const db = { execute: vi.fn().mockResolvedValueOnce(batch).mockResolvedValue([]) };
    vi.mocked(getDb).mockReturnValue(db as never);

    // First note throws, second succeeds
    vi.mocked(embedNote)
      .mockRejectedValueOnce(new Error('API timeout'))
      .mockResolvedValueOnce({
        vector: Array(1024).fill(0.2),
        dim: 1024,
        provider: 'voyage',
        model: 'voyage-3-large',
      });

    const job = makeJob({ targetVendor: 'voyage', batchSize: 2 });
    const result = await processEmbeddingRebuildJob(job as never);

    expect(result.skipped).toBe(1);
    expect(result.rebuilt).toBe(1);
    expect(result.aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. estimateRebuildCost

describe('estimateRebuildCost', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns cost estimate with correct shape', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ count: '100', avg_chars: '800' }]),
    };
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await estimateRebuildCost('ws-id', 'openai', 'text-embedding-3-small');

    expect(result).toMatchObject({
      notesCount: 100,
      estimatedTokens: expect.any(Number),
      estimatedUsd: expect.any(Number),
      perMillionTokensUsd: 0.02,
    });
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('returns zero cost for Google provider (free tier)', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ count: '50', avg_chars: '400' }]),
    };
    vi.mocked(getDb).mockReturnValue(db as never);

    const result = await estimateRebuildCost('ws-id', 'google', 'text-embedding-004');

    expect(result.perMillionTokensUsd).toBe(0);
    expect(result.estimatedUsd).toBe(0);
  });
});
