/**
 * index.ts — re-exports for audit-cleanup job module
 *
 * Public surface: job handler, cron registration, worker factory, queue name.
 * Consumers (server.ts) import from here exclusively.
 */

export { processAuditCleanupJob } from './job-handler.js';
export type { AuditCleanupJobData, AuditCleanupResult } from './job-handler.js';

export {
  AUDIT_CLEANUP_QUEUE,
  registerAuditCleanupCron,
  createAuditCleanupWorker,
} from './cron.js';
