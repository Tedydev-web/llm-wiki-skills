/**
 * material.ts — Material (raw uploaded source) Zod schema
 *
 * Vocabulary per ADR 011 / phase-02:
 *   - Material: raw uploaded source file (v2 name per ADR vocabulary)
 *   - MaterialStatus: processing state machine for BullMQ ingest jobs (ADR 011)
 *
 * Retry policy per ADR 011: 3 attempts, exponential backoff (1s/5s/25s).
 * After 3 failures: status = "failed", failedReason populated from job.failedReason.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// MaterialStatus — ingest state machine

export const materialStatusSchema = z.enum([
  'pending',    // uploaded, awaiting queue slot
  'processing', // BullMQ worker active; progress 0-100
  'completed',  // pages compiled successfully
  'failed',     // exceeded retry limit; see failedReason
]);

export type MaterialStatus = z.infer<typeof materialStatusSchema>;

// ---------------------------------------------------------------------------
// Material

export const materialSchema = z.object({
  id:            z.string().uuid(),
  workspaceId:   z.string().uuid(),
  kbId:          z.string().uuid(),
  /** Original filename as provided by uploader */
  fileName:      z.string().min(1).max(255),
  /** MIME type of the uploaded file */
  mimeType:      z.string().max(100),
  /** Object storage key (MinIO/S3 path) */
  storageKey:    z.string().min(1),
  /** Bytes */
  sizeBytes:     z.number().int().min(0),
  status:        materialStatusSchema,
  /** BullMQ job dedup key: "ingest:<id>" (ADR 011) */
  dedupeKey:     z.string(),
  /** 0–100 progress reported by BullMQ worker */
  progress:      z.number().int().min(0).max(100),
  /** Number of Note pages compiled from this material */
  pageCount:     z.number().int().min(0),
  /** Last BullMQ failedReason if status = "failed" */
  failedReason:  z.string().nullable(),
  uploadedBy:    z.string().uuid(),
  createdAt:     z.string().datetime(),
  updatedAt:     z.string().datetime(),
}).strict();

export type Material = z.infer<typeof materialSchema>;
