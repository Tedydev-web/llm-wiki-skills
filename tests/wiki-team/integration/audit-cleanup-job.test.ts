/**
 * audit-cleanup-job.test.ts — integration tests for processAuditCleanupJob
 *
 * Mocks DB to avoid real Postgres dependency. Tests:
 *   - carve-out: audit.retention.* events never deleted
 *   - batch loop terminates when rowsAffected < BATCH_SIZE
 *   - self-audit row written after cleanup
 *   - AUDIT_RETENTION_MONTHS env respected
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job } from 'bullmq';

// ---------------------------------------------------------------------------
// Mock DB and logger

vi.mock('../../../apps/wiki-team/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// We intercept db.execute calls — track SQL strings for carve-out assertion
const executeMock = vi.fn();
vi.mock('../../../apps/wiki-team/storage/db.js', () => ({
  getDb: () => ({ execute: executeMock }),
  schema: {},
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({
      _sql: strings.raw.join('?'),
      _values: values,
    }),
    { raw: (s: string) => ({ _raw: s }) },
  ),
}));

import { processAuditCleanupJob } from '../../../apps/wiki-team/jobs/audit-cleanup/job-handler.js';

// ---------------------------------------------------------------------------
// Helpers

function makeJob(data?: Partial<{ enqueuedAt: string }>): Job<{ enqueuedAt: string }> {
  return {
    id: 'test-job-1',
    data: { enqueuedAt: new Date().toISOString(), ...data },
    updateProgress: vi.fn(),
  } as unknown as Job<{ enqueuedAt: string }>;
}

// ---------------------------------------------------------------------------
// Tests

describe('processAuditCleanupJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['AUDIT_RETENTION_MONTHS'] = '12';

    // Default: cutoff query returns a date, DELETE returns 0 affected rows (empty)
    executeMock
      .mockResolvedValueOnce([{ cutoff: new Date('2025-01-01T00:00:00Z') }]) // cutoff SELECT
      .mockResolvedValue({ count: 0 }); // DELETE returns 0 rows → single batch, done
  });

  afterEach(() => {
    delete process.env['AUDIT_RETENTION_MONTHS'];
  });

  it('returns correct shape with deleted count and retentionMonths', async () => {
    const result = await processAuditCleanupJob(makeJob());

    expect(result).toMatchObject({
      deleted: 0,
      retentionMonths: 12,
      batches: 1,
      durationMs: expect.any(Number),
    });
  });

  it('respects AUDIT_RETENTION_MONTHS env (custom value)', async () => {
    process.env['AUDIT_RETENTION_MONTHS'] = '6';
    executeMock
      .mockReset()
      .mockResolvedValueOnce([{ cutoff: new Date('2025-07-01T00:00:00Z') }])
      .mockResolvedValue({ count: 0 });

    const result = await processAuditCleanupJob(makeJob());
    expect(result.retentionMonths).toBe(6);
  });

  it('DELETE SQL includes carve-out: action NOT LIKE audit.retention.%', async () => {
    executeMock
      .mockReset()
      .mockResolvedValueOnce([{ cutoff: new Date('2025-01-01T00:00:00Z') }])
      .mockResolvedValue({ count: 0 });

    await processAuditCleanupJob(makeJob());

    // Find the DELETE call (second execute call)
    const deleteSqlArg = executeMock.mock.calls[1]?.[0];
    // The sql template tag produces an object; check it contains the carve-out fragment
    const sqlStr = JSON.stringify(deleteSqlArg);
    expect(sqlStr).toContain('audit.retention.%');
  });

  it('terminates batch loop when rowsAffected < BATCH_SIZE (1000)', async () => {
    // Simulate: first batch deletes 500 rows (< 1000 → stop)
    executeMock
      .mockReset()
      .mockResolvedValueOnce([{ cutoff: new Date('2025-01-01T00:00:00Z') }]) // cutoff
      .mockResolvedValueOnce({ count: 500 }) // batch 1 → 500 rows
      .mockResolvedValue({ count: 0 }); // self-audit INSERT

    const result = await processAuditCleanupJob(makeJob());
    expect(result.deleted).toBe(500);
    expect(result.batches).toBe(1);
  });

  it('runs multiple batches when rowsAffected = BATCH_SIZE', async () => {
    // Batch 1: 1000 rows; batch 2: 200 rows → stop
    executeMock
      .mockReset()
      .mockResolvedValueOnce([{ cutoff: new Date('2025-01-01T00:00:00Z') }])
      .mockResolvedValueOnce({ count: 1000 })
      .mockResolvedValueOnce({ count: 200 })
      .mockResolvedValue({ count: 0 });

    const result = await processAuditCleanupJob(makeJob());
    expect(result.deleted).toBe(1200);
    expect(result.batches).toBe(2);
  });

  it('writes self-audit row (audit.retention.purge INSERT) after run', async () => {
    executeMock
      .mockReset()
      .mockResolvedValueOnce([{ cutoff: new Date('2025-01-01T00:00:00Z') }])
      .mockResolvedValueOnce({ count: 0 }) // DELETE
      .mockResolvedValue(undefined); // INSERT (self-audit)

    await processAuditCleanupJob(makeJob());

    // Self-audit INSERT is the 3rd execute call
    const insertSqlArg = executeMock.mock.calls[2]?.[0];
    const sqlStr = JSON.stringify(insertSqlArg);
    expect(sqlStr).toContain('audit.retention.purge');
  });

  it('swallows self-audit write failure without throwing', async () => {
    executeMock
      .mockReset()
      .mockResolvedValueOnce([{ cutoff: new Date('2025-01-01T00:00:00Z') }])
      .mockResolvedValueOnce({ count: 0 })
      .mockRejectedValueOnce(new Error('INSERT failed')); // self-audit fails

    await expect(processAuditCleanupJob(makeJob())).resolves.toBeDefined();
  });
});
