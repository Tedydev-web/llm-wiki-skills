/**
 * job-status.ts — JobStatus Zod schema (compile/ingest job progress)
 *
 * Vocabulary per ADR 011 / phase-02:
 *   - JobStatus: compile/ingest job progress (v2 name)
 *
 * Progress semantics per ADR 011:
 *   - BullMQ updates progress (0–100) on active jobs
 *   - Frontend polls GET /sources/:id/progress at 2s intervals while state = "active"
 *   - Retry policy: 3 attempts with exponential backoff (1s, 5s, 25s)
 *   - After 3 failures: state = "failed", moved to DLQ
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// JobState — BullMQ job lifecycle states

export const jobStateSchema = z.enum([
  'waiting',    // queued, no worker claimed it yet
  'active',     // worker processing; progress 0–99
  'completed',  // success; progress = 100
  'failed',     // exceeded retries; in DLQ
  'delayed',    // scheduled for future or in backoff
  'paused',     // queue paused by operator
]);

export type JobState = z.infer<typeof jobStateSchema>;

// ---------------------------------------------------------------------------
// JobStatus

export const jobStatusSchema = z.object({
  jobId:       z.string().min(1),
  /** BullMQ queue name (e.g. "ingest", "recompile") */
  queueName:   z.string().min(1),
  /** Source material ID this job processes */
  materialId:  z.string().uuid(),
  workspaceId: z.string().uuid(),
  state:       jobStateSchema,
  /** 0–100 progress integer; meaningful when state = "active" */
  progress:    z.number().int().min(0).max(100),
  /** Attempt count (1-indexed) */
  attemptsMade: z.number().int().min(0),
  /** Max attempts before DLQ (ADR 011: 3) */
  maxAttempts:  z.number().int().min(1).default(3),
  /** Last error message from BullMQ job.failedReason */
  failedReason: z.string().nullable(),
  /** ISO datetime when job was enqueued */
  enqueuedAt:   z.string().datetime(),
  /** ISO datetime when job completed or failed; null if still active */
  finishedAt:   z.string().datetime().nullable(),
}).strict();

export type JobStatus = z.infer<typeof jobStatusSchema>;

// ---------------------------------------------------------------------------
// JobProgress response DTO — returned by GET /sources/:id/progress

export const jobProgressResponseSchema = z.object({
  materialId: z.string().uuid(),
  state:      jobStateSchema,
  progress:   z.number().int().min(0).max(100),
  failedReason: z.string().nullable(),
}).strict();

export type JobProgressResponse = z.infer<typeof jobProgressResponseSchema>;
