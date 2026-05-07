/**
 * job-handler.ts — BullMQ job handler: delete audit_events older than retention threshold
 *
 * Strategy: small-batch DELETE (1000 rows + 100ms sleep) to avoid lock storms.
 * Carve-out: events with event_type LIKE 'audit.retention.%' are NEVER deleted.
 * Self-audit: writes one audit.retention.purge row per run for tamper-evidence.
 *
 * Env: AUDIT_RETENTION_MONTHS (default 12)
 */

import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { getDb } from '../../storage/db.js';
import { logger } from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types

export interface AuditCleanupJobData {
  /** ISO timestamp when job was enqueued (informational) */
  enqueuedAt: string;
}

export interface AuditCleanupResult {
  deleted: number;
  retentionMonths: number;
  cutoffAt: string;
  batches: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants

const BATCH_SIZE = 1_000;
const BATCH_SLEEP_MS = 100;
const MAX_BATCHES = 10_000; // safety ceiling — ~10M rows max per run

// ---------------------------------------------------------------------------
// Helpers

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetentionMonths(): number {
  const raw = process.env['AUDIT_RETENTION_MONTHS'];
  if (!raw) return 12;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    logger.warn({ raw }, '[audit-cleanup] Invalid AUDIT_RETENTION_MONTHS — using 12');
    return 12;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// writeRetentionPurgeRow — self-audit record (tamper-evidence)

async function writeRetentionPurgeRow(result: AuditCleanupResult): Promise<void> {
  const db = getDb();
  try {
    await db.execute(sql`
      INSERT INTO audit_events (
        id, workspace_id, actor_id, action, resource_type, resource_id,
        payload, ip_address, created_at
      ) VALUES (
        gen_random_uuid(),
        '00000000-0000-0000-0000-000000000000',
        NULL,
        'audit.retention.purge',
        'audit_events',
        '00000000-0000-0000-0000-000000000000',
        ${JSON.stringify({
          deleted_count: result.deleted,
          retention_months: result.retentionMonths,
          cutoff_at: result.cutoffAt,
          batches: result.batches,
          duration_ms: result.durationMs,
        })}::jsonb,
        NULL,
        now()
      )
    `);
  } catch (err) {
    // Self-audit failure must not abort; log loudly for ops visibility
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[audit-cleanup] failed to write retention-purge self-audit row',
    );
  }
}

// ---------------------------------------------------------------------------
// processAuditCleanupJob — main handler

export async function processAuditCleanupJob(
  job: Job<AuditCleanupJobData>,
): Promise<AuditCleanupResult> {
  const startMs = Date.now();
  const retentionMonths = getRetentionMonths();
  const db = getDb();

  // Compute cutoff timestamp once for consistent batch boundary
  const cutoffResult = await db.execute(sql`
    SELECT (now() - (${retentionMonths} || ' months')::interval) AS cutoff
  `);
  const cutoffAt = (cutoffResult as unknown as Array<{ cutoff: Date }>)[0]?.cutoff?.toISOString()
    ?? new Date(Date.now() - retentionMonths * 30 * 24 * 60 * 60 * 1000).toISOString();

  logger.info(
    { retentionMonths, cutoffAt, jobId: job.id },
    '[audit-cleanup] starting cleanup run',
  );

  let totalDeleted = 0;
  let batches = 0;

  // Small-batch delete loop — avoids full-table lock storm
  // Postgres does not support DELETE LIMIT N natively; use subquery pattern
  for (let i = 0; i < MAX_BATCHES; i++) {
    const batchResult = await db.execute(sql`
      DELETE FROM audit_events
      WHERE id IN (
        SELECT id FROM audit_events
        WHERE created_at < ${cutoffAt}::timestamptz
          AND action NOT LIKE 'audit.retention.%'
        LIMIT ${BATCH_SIZE}
      )
    `);

    // postgres-js returns rowCount on DML
    const rowsAffected = (batchResult as unknown as { count?: number }).count ?? 0;
    totalDeleted += rowsAffected;
    batches++;

    logger.debug(
      { batch: batches, rowsAffected, totalDeleted },
      '[audit-cleanup] batch complete',
    );

    if (rowsAffected < BATCH_SIZE) {
      // Last batch — no more rows to delete
      break;
    }

    await delay(BATCH_SLEEP_MS);
  }

  const durationMs = Date.now() - startMs;

  const result: AuditCleanupResult = {
    deleted: totalDeleted,
    retentionMonths,
    cutoffAt,
    batches,
    durationMs,
  };

  logger.info(result, '[audit-cleanup] cleanup run complete');

  // Self-audit row (fire-and-forget after logging result)
  await writeRetentionPurgeRow(result);

  return result;
}
