/**
 * worker.ts — BullMQ Worker entrypoint for wiki-compile queue
 *
 * Bun-specific connection config (phase-06 step 8):
 *   maxRetriesPerRequest: null  — required for BullMQ blocking commands (BRPOP)
 *   enableReadyCheck: false     — Bun + ioredis silently hangs without this
 *
 * Concurrency: read from WIKI_COMPILE_CONCURRENCY env (default: 3).
 *
 * Recursion guard: checked at both worker entry AND job-handler entry
 * (belt-and-suspenders) using WIKI_COMPILE_INTERNAL_INVOCATION=1 env var.
 *
 * Graceful shutdown: SIGTERM/SIGINT → worker.close() → drain in-flight jobs.
 */

import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { processWikiCompileJob, type WikiCompileJobData } from './job-handler.js';

// ---------------------------------------------------------------------------
// parseRedisUrl — extract ioredis connection options from a Redis URL

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[worker] Invalid REDIS_URL: "${url}"`);
  }

  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.pathname && parsed.pathname !== '/' ? { db: parseInt(parsed.pathname.slice(1), 10) } : {}),
  };
}

// ---------------------------------------------------------------------------
// createWikiCompileWorker — factory exported for testability

export function createWikiCompileWorker(): Worker {
  // Recursion guard at worker level — refuse to start if inside an internal invocation
  if (process.env['WIKI_COMPILE_INTERNAL_INVOCATION'] === '1') {
    throw new Error(
      '[worker] WIKI_COMPILE_INTERNAL_INVOCATION=1 is set — refusing to start worker in recursive context',
    );
  }

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('[worker] REDIS_URL env var is required');
  }

  const concurrency = parseInt(process.env['WIKI_COMPILE_CONCURRENCY'] ?? '3', 10);
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error(
      `[worker] WIKI_COMPILE_CONCURRENCY must be a positive integer (got "${process.env['WIKI_COMPILE_CONCURRENCY']}")`,
    );
  }

  // Shared Redis client for cost-meter and catalog mutex
  // Separate from BullMQ's internal connection — prevents command interference
  const sharedRedis = new Redis({
    ...parseRedisUrl(redisUrl),
    maxRetriesPerRequest: null,  // required for BullMQ compatibility
    enableReadyCheck: false,     // required for Bun + ioredis
    lazyConnect: false,
  });

  sharedRedis.on('error', (err) => {
    console.error('[worker] Redis connection error:', err.message);
  });

  const worker = new Worker<WikiCompileJobData>(
    'wiki-compile',
    async (job) => {
      await processWikiCompileJob(job, sharedRedis);
    },
    {
      connection: {
        ...parseRedisUrl(redisUrl),
        maxRetriesPerRequest: null, // BullMQ blocking command requirement
        enableReadyCheck: false,    // Bun + ioredis: prevents silent hang on disconnect
      },
      concurrency,
      // Retry policy: 3 attempts with exponential backoff (ADR 011: 1s / 5s / 25s)
      settings: {
        backoffStrategy: (attemptsMade: number): number => {
          // attemptsMade is 1-indexed
          const delays = [1000, 5000, 25000];
          return delays[Math.min(attemptsMade - 1, delays.length - 1)] ?? 25000;
        },
      },
    },
  );

  worker.on('completed', (job) => {
    console.info(`[worker] job ${job.id} completed (materialId=${job.data.materialId})`);
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[worker] job ${job?.id} failed (materialId=${job?.data?.materialId}): ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  });

  worker.on('error', (err) => {
    console.error('[worker] BullMQ worker error:', err instanceof Error ? err.message : String(err));
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.info(`[worker] ${signal} received — closing worker gracefully`);
    try {
      await worker.close();
      await sharedRedis.quit();
      console.info('[worker] shutdown complete');
    } catch (err) {
      console.error('[worker] error during shutdown:', err);
      process.exit(1);
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  console.info(
    `[worker] wiki-compile worker started (concurrency=${concurrency}, redis=${redisUrl.replace(/:[^:@]+@/, ':***@')})`,
  );

  return worker;
}

// ---------------------------------------------------------------------------
// Auto-start when this file is run directly (not imported)
// Bun: import.meta.main is true when executed as entry point

if (import.meta.main) {
  createWikiCompileWorker();
}
