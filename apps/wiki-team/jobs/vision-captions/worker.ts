/**
 * worker.ts — BullMQ Worker for the vision-captions queue.
 *
 * Separate process from wiki-compile worker (ADR 015: vision is async, best-effort).
 * Concurrency: 5 (vision API calls are I/O-bound; higher concurrency is safe).
 * Retry: 2 attempts with 5s backoff (vision errors are usually transient API issues).
 *
 * Bun-specific connection config (mirrors wiki-compile/worker.ts):
 *   maxRetriesPerRequest: null  — required for BullMQ blocking commands
 *   enableReadyCheck: false     — Bun + ioredis silent hang prevention
 *
 * VISION_ENABLED_DEFAULT=false — worker only runs sub-jobs that were enqueued
 * by wiki-compile/job-handler.ts after checking workspace vision_enabled flag.
 * Worker itself does not gate on the flag (enqueue-time check is sufficient).
 */

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../../lib/logger.js';
import { processVisionCaptionJob } from './job-handler.js';
import { VISION_CAPTIONS_QUEUE, type VisionCaptionJobData } from './vision-caption-job.js';

// ---------------------------------------------------------------------------
// parseRedisUrl — mirrors wiki-compile/worker.ts (no shared util to avoid coupling)

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[vision-worker] Invalid REDIS_URL: "${url}"`);
  }
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.pathname && parsed.pathname !== '/' ? { db: parseInt(parsed.pathname.slice(1), 10) } : {}),
  };
}

// ---------------------------------------------------------------------------
// createVisionCaptionsWorker — factory exported for testability

export function createVisionCaptionsWorker(): Worker {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('[vision-worker] REDIS_URL env var is required');
  }

  const concurrency = parseInt(process.env['VISION_CONCURRENCY'] ?? '5', 10);
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error('[vision-worker] VISION_CONCURRENCY must be a positive integer');
  }

  // Shared Redis client for cost-cap INCR operations
  const sharedRedis = new Redis({
    ...parseRedisUrl(redisUrl),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });

  sharedRedis.on('error', (err) => {
    logger.error({ err: err.message }, '[vision-worker] Redis connection error');
  });

  const worker = new Worker<VisionCaptionJobData>(
    VISION_CAPTIONS_QUEUE,
    async (job) => {
      await processVisionCaptionJob(job, sharedRedis);
    },
    {
      connection: {
        ...parseRedisUrl(redisUrl),
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      concurrency,
      settings: {
        backoffStrategy: (attemptsMade: number): number => {
          // 2 attempts: 5s, 15s
          const delays = [5_000, 15_000];
          return delays[Math.min(attemptsMade - 1, delays.length - 1)] ?? 15_000;
        },
      },
    },
  );

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, imageRowId: job.data.imageRowId, materialId: job.data.materialId },
      '[vision-worker] job completed',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        imageRowId: job?.data?.imageRowId,
        err: err instanceof Error ? err.message : String(err),
      },
      '[vision-worker] job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[vision-worker] BullMQ error');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, '[vision-worker] signal received — closing gracefully');
    try {
      await worker.close();
      await sharedRedis.quit();
      logger.info('[vision-worker] shutdown complete');
    } catch (err) {
      logger.error({ err }, '[vision-worker] error during shutdown');
      process.exit(1);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT',  () => { void shutdown('SIGINT'); });

  logger.info(
    { concurrency, queue: VISION_CAPTIONS_QUEUE, redis: redisUrl.replace(/:[^:@]+@/, ':***@') },
    '[vision-worker] vision-captions worker started',
  );

  return worker;
}

// ---------------------------------------------------------------------------
// Auto-start when run directly (Bun entry point)

if (import.meta.main) {
  createVisionCaptionsWorker();
}
