/**
 * index.ts — public surface for wiki-compile job module
 *
 * Consumers (P08 HTTP endpoint, P11 tests) import from this module.
 * Exposes the minimum surface needed: job data type + worker factory.
 * Internal modules (agent-loop, tools, extractors) are not re-exported.
 */

export { createWikiCompileWorker } from './worker.js';
export type { WikiCompileJobData } from './job-handler.js';
