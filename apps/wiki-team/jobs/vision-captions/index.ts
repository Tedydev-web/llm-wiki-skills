/**
 * index.ts — public API for the vision-captions BullMQ queue module.
 *
 * Exports the queue name, job data types, and enqueue helper used by
 * wiki-compile/job-handler.ts to dispatch per-image sub-jobs.
 *
 * Worker bootstrap is in worker.ts (run as a separate Bun process).
 */

export { VISION_CAPTIONS_QUEUE } from './vision-caption-job.js';
export type { VisionCaptionJobData, VisionCaptionResult } from './vision-caption-job.js';
export { enqueueVisionCaptionJobs } from './enqueue-vision-jobs.js';
