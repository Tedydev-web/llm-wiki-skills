/**
 * cron.ts — BullMQ repeatable job registration for audit-cleanup (daily 02:00 UTC)
 *
 * BullMQ repeatable jobs are de-duplicated by jobId — safe to call at every boot.
 * Queue: "audit-cleanup"
 * Cron: "0 2 * * *" (daily at 02:00 UTC)
 *
 * Worker is created separately via createAuditCleanupWorker() in index.ts.
 */

import { Queue, Worker } from 'bullmq';
import { logger } from '../../lib/logger.js';
import { processAuditCleanupJob, type AuditCleanupJobData } from './job-handler.js';

// ---------------------------------------------------------------------------
// Constants

export const AUDIT_CLEANUP_QUEUE = 'audit-cleanup';
const AUDIT_CLEANUP_CRON = '0 2 * * *'; // daily at 02:00 UTC
const AUDIT_CLEANUP_JOB_ID = 'audit-cleanup-daily'; // stable ID → de-duplicated by BullMQ

// ---------------------------------------------------------------------------
// parseRedisUrl — mirrors other workers (no shared util — avoid coupling)

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[audit-cleanup/cron] Invalid REDIS_URL: "${url}"`);
  }
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.pathname && parsed.pathname !== '/' ? { db: parseInt(parsed.pathname.slice(1), 10) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Queue singleton

let _queue: Queue<AuditCleanupJobData> | null = null;

function getAuditCleanupQueue(): Queue<AuditCleanupJobData> {
  if (_queue) return _queue;
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('[audit-cleanup/cron] REDIS_URL env var is required');

  _queue = new Queue<AuditCleanupJobData>(AUDIT_CLEANUP_QUEUE, {
    connection: {
      ...parseRedisUrl(redisUrl),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    },
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'fixed', delay: 60_000 }, // 1 min retry (cron job, not time-critical)
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 10 },
    },
  });

  return _queue;
}

// ---------------------------------------------------------------------------
// registerAuditCleanupCron — idempotent repeatable job registration

export async function registerAuditCleanupCron(): Promise<void> {
  const queue = getAuditCleanupQueue();

  await queue.add(
    AUDIT_CLEANUP_JOB_ID,
    { enqueuedAt: new Date().toISOString() },
    {
      jobId: AUDIT_CLEANUP_JOB_ID, // stable ID ensures BullMQ de-duplicates on restart
      repeat: {
        pattern: AUDIT_CLEANUP_CRON,
        tz: 'UTC',
      },
    },
  );

  logger.info(
    { cron: AUDIT_CLEANUP_CRON, jobId: AUDIT_CLEANUP_JOB_ID, queue: AUDIT_CLEANUP_QUEUE },
    '[audit-cleanup/cron] repeatable job registered',
  );
}

// ---------------------------------------------------------------------------
// createAuditCleanupWorker — factory for the BullMQ worker

export function createAuditCleanupWorker(): Worker<AuditCleanupJobData> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('[audit-cleanup/cron] REDIS_URL env var is required');

  const connOpts = {
    ...parseRedisUrl(redisUrl),
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };

  const worker = new Worker<AuditCleanupJobData>(
    AUDIT_CLEANUP_QUEUE,
    async (job) => {
      const result = await processAuditCleanupJob(job);
      logger.info(result, '[audit-cleanup/cron] job handler returned');
    },
    {
      connection: connOpts,
      concurrency: 1, // single-concurrent: one cleanup run at a time
    },
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, '[audit-cleanup/cron] job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err instanceof Error ? err.message : String(err) },
      '[audit-cleanup/cron] job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      '[audit-cleanup/cron] worker BullMQ error',
    );
  });

  logger.info(
    { queue: AUDIT_CLEANUP_QUEUE, cron: AUDIT_CLEANUP_CRON },
    '[audit-cleanup/cron] worker started',
  );

  return worker;
}
