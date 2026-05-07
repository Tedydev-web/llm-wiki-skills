/**
 * worker.ts — BullMQ Worker for the embedding-rebuild queue.
 *
 * Queue name: "embedding-rebuild"
 * Triggered by: POST /api/admin/embedding-rebuild (provider switch in Settings)
 *
 * Single concurrent job per queue — embedding is sequential per workspace to
 * respect provider rate limits (Google 30 RPM, OpenAI 5000 RPM, Voyage tier).
 *
 * Graceful shutdown: SIGTERM/SIGINT → worker.close() drains in-flight jobs.
 */

import { Worker, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '../../lib/logger.js';
import { processEmbeddingRebuildJob, type EmbeddingRebuildJobData } from './handler.js';

// ---------------------------------------------------------------------------
// parseRedisUrl — extract ioredis connection options

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[embedding-rebuild/worker] Invalid REDIS_URL: "${url}"`);
  }
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.pathname && parsed.pathname !== '/' ? { db: parseInt(parsed.pathname.slice(1), 10) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Queue instance — exported for use by API route (enqueue trigger)

let _queue: Queue<EmbeddingRebuildJobData> | null = null;

export function getEmbeddingRebuildQueue(): Queue<EmbeddingRebuildJobData> {
  if (_queue) return _queue;

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('[embedding-rebuild/worker] REDIS_URL env var is required');

  _queue = new Queue<EmbeddingRebuildJobData>('embedding-rebuild', {
    connection: {
      ...parseRedisUrl(redisUrl),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    },
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5_000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 20 },
    },
  });

  return _queue;
}

// ---------------------------------------------------------------------------
// createEmbeddingRebuildWorker — factory

export function createEmbeddingRebuildWorker(): Worker<EmbeddingRebuildJobData> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('[embedding-rebuild/worker] REDIS_URL env var is required');

  const connOpts = {
    ...parseRedisUrl(redisUrl),
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
  };

  const worker = new Worker<EmbeddingRebuildJobData>(
    'embedding-rebuild',
    async (job) => {
      const result = await processEmbeddingRebuildJob(job);
      logger.info(result, '[embedding-rebuild/worker] job handler returned');
    },
    {
      connection: connOpts,
      concurrency: 1,           // sequential per worker process — rate-limit compliance
    },
  );

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, workspaceId: job.data.workspaceId },
      '[embedding-rebuild/worker] job completed',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        workspaceId: job?.data?.workspaceId,
        err: err instanceof Error ? err.message : String(err),
      },
      '[embedding-rebuild/worker] job failed',
    );
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('[embedding-rebuild/worker] shutdown signal received — draining');
    await worker.close();
    logger.info('[embedding-rebuild/worker] worker closed');
    process.exit(0);
  };

  process.once('SIGTERM', () => { shutdown().catch(() => process.exit(1)); });
  process.once('SIGINT',  () => { shutdown().catch(() => process.exit(1)); });

  logger.info('[embedding-rebuild/worker] worker started (concurrency: 1)');
  return worker;
}
