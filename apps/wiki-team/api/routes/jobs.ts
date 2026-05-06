/**
 * jobs.ts — re-export jobs router fragment
 *
 * Job polling is co-located in materials.ts (GET /api/jobs/:jid) because it
 * shares the BullMQ Queue instance. This file exists as a thin re-export to
 * satisfy the 8-file ownership contract while keeping the router in one place.
 *
 * If job routes grow beyond GET /api/jobs/:jid, extract them here.
 */

export { buildMaterialsRouter as buildJobsRouter } from './materials.js';
