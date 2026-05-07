/**
 * vision-caption-job.ts — BullMQ job data types and queue name for vision-captions queue.
 *
 * Separate from wiki-compile queue (ADR 015: vision is best-effort, async, independent).
 * Vision job failure NEVER propagates back to compile job — sub-jobs are isolated.
 */

// ---------------------------------------------------------------------------
// Queue name

export const VISION_CAPTIONS_QUEUE = 'vision-captions';

// ---------------------------------------------------------------------------
// VisionCaptionJobData — payload for each per-image sub-job

export interface VisionCaptionJobData {
  /** material_images row id to process */
  imageRowId: string;
  /** Parent material UUID (used for cost-cap Redis key) */
  materialId: string;
  /** Workspace UUID (used for per-workspace daily cost cap) */
  workspaceId: string;
  /** MinIO storage key for the image bytes */
  storageKey: string;
  /** MIME type of the image */
  mimeType: string;
  /** Image size in bytes (pre-fetched to skip before downloading) */
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// VisionCaptionResult — returned by job handler on success

export interface VisionCaptionResult {
  imageRowId: string;
  caption: string;
  provider: string;
  costUsd: number;
}
