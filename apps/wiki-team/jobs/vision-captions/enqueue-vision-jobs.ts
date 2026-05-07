/**
 * enqueue-vision-jobs.ts — enqueue per-image vision-caption sub-jobs into BullMQ.
 *
 * Called by wiki-compile/job-handler.ts after text-only compile completes.
 * Each image in the manifest becomes one independent BullMQ sub-job.
 * Sub-job failure is fully isolated — compile job is already marked completed.
 *
 * Dedup key: `vision:<imageRowId>` — prevents double-enqueue on compile retry.
 */

import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../../lib/logger.js';
import { VISION_CAPTIONS_QUEUE, type VisionCaptionJobData } from './vision-caption-job.js';
import type { ImageManifestEntry } from '../wiki-compile/extractors/pdf-image-extractor.js';

// ---------------------------------------------------------------------------
// enqueueVisionCaptionJobs

/**
 * Enqueue one BullMQ sub-job per image manifest entry.
 *
 * @param entries      ImageManifestEntry[] from pdf-image-extractor
 * @param materialId   Parent material UUID
 * @param workspaceId  Workspace UUID (for cost-cap Redis key)
 * @param redis        Shared Redis client (BullMQ connection)
 * @returns            Number of jobs successfully enqueued
 */
export async function enqueueVisionCaptionJobs(
  entries: ImageManifestEntry[],
  materialId: string,
  workspaceId: string,
  redis: Redis,
): Promise<number> {
  if (entries.length === 0) return 0;

  // BullMQ Queue — uses same Redis connection options as the worker
  const queue = new Queue<VisionCaptionJobData>(VISION_CAPTIONS_QUEUE, {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 200 },
    },
  });

  let enqueued = 0;

  for (const entry of entries) {
    const jobData: VisionCaptionJobData = {
      imageRowId: entry.rowId,
      materialId,
      workspaceId,
      storageKey: entry.storageKey,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
    };

    try {
      // jobId dedup: prevents re-enqueue if compile retried
      const jobId = `vision:${entry.rowId}`;
      await queue.add('caption-image', jobData, { jobId });
      enqueued++;
    } catch (err) {
      logger.error(
        {
          imageRowId: entry.rowId,
          materialId,
          err: err instanceof Error ? err.message : String(err),
        },
        '[enqueue-vision] failed to enqueue sub-job — continuing',
      );
    }
  }

  // Close the queue client (do not close the shared redis connection)
  await queue.close();

  logger.info(
    { materialId, enqueued, total: entries.length },
    '[enqueue-vision] vision sub-jobs enqueued',
  );

  return enqueued;
}
