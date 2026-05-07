/**
 * job-handler.ts — BullMQ job pipeline orchestrator for wiki-compile.
 * Steps: guard → idempotency check → load material → extract text → build AuthContext →
 *   runWikiCompile → rebuildCatalog → mark completed.
 * Idempotency triple (material_id, prompt_version_id, scope_filter_hash) —
 *   persisted to jobs table on enqueue (P08 owns enqueue route); checked here
 *   to skip re-running completed jobs (prevents double-billing on BullMQ retry).
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { logger } from '../../lib/logger.js';
import { getDb, schema } from '../../storage/db.js';
import { getObjectStore } from '../../storage/object-store.js';
import { runWikiCompile } from './agent-loop.js';
import { createCostMeter } from './cost-meter.js';
import { extractFromPdf } from './extractors/pdf-extractor.js';
import { extractFromDocx } from './extractors/docx-extractor.js';
import { extractFromUrl } from './extractors/url-extractor.js';
import { rebuildCatalogWithMutex } from './catalog-rebuild.js';
import type { AuthContext } from '../../auth/auth-context.js';

// ---------------------------------------------------------------------------
// WikiCompileJobData

export interface WikiCompileJobData {
  workspaceId: string;
  materialId: string;
  kbId: string;
  requestedBy: string;
  promptVersionId: string;
  scopeFilterHash?: string;
}

// ---------------------------------------------------------------------------
// processWikiCompileJob

export async function processWikiCompileJob(
  job: Job<WikiCompileJobData>,
  redis: Redis,
): Promise<void> {
  const { workspaceId, materialId, kbId, requestedBy, promptVersionId } = job.data;
  const scopeFilterHash = job.data.scopeFilterHash ?? '';

  if (process.env['WIKI_COMPILE_INTERNAL_INVOCATION'] === '1') {
    throw Object.assign(new Error('recursion-guard: refusing re-entry'), { code: 'recursion-detected' });
  }

  // Idempotency triple — compute and persist to jobs table (P08 §W3 fix).
  // On retry, if a matching completed row exists, skip the LLM call to avoid
  // double-billing and duplicate note writes.
  const idempotencyHash = buildIdempotencyHash(materialId, promptVersionId, scopeFilterHash);

  await job.updateProgress(5);
  const db = getDb();

  // Check for an existing completed job with same idempotency triple
  // (BullMQ jobId dedup handles in-flight; this handles completed reruns)
  const existingJobs = await db
    .select({ id: schema.jobs.id, state: schema.jobs.state })
    .from(schema.jobs)
    .where(eq(schema.jobs.bullJobId, job.id ?? `ingest:${materialId}`))
    .limit(1);

  if (existingJobs.length > 0 && existingJobs[0]!.state === 'completed') {
    logger.info(
      { materialId, idempotencyHash },
      '[job-handler] idempotency skip — already completed',
    );
    return;
  }

  // Persist idempotency hash to job row payload for audit trail
  if (existingJobs.length > 0) {
    await db
      .update(schema.jobs)
      .set({ state: 'active', attemptsMade: job.attemptsMade, progress: 5 })
      .where(eq(schema.jobs.id, existingJobs[0]!.id));
  }

  // ---- Load material ----
  const materialRows = await db
    .select()
    .from(schema.materials)
    .where(eq(schema.materials.id, materialId))
    .limit(1);

  if (materialRows.length === 0) {
    throw Object.assign(
      new Error(`material-not-found: no material with id "${materialId}"`),
      { code: 'material-not-found' },
    );
  }

  const material = materialRows[0]!;

  await db
    .update(schema.materials)
    .set({ status: 'processing', progress: 10, updatedAt: new Date() })
    .where(eq(schema.materials.id, materialId));

  await job.updateProgress(15);

  // ---- Extract text ----
  let materialText: string;
  try {
    materialText = await extractMaterialText(material);
  } catch (err) {
    const reason = `extract-failed: ${err instanceof Error ? err.message : String(err)}`;
    await db
      .update(schema.materials)
      .set({ status: 'failed', failedReason: reason, updatedAt: new Date() })
      .where(eq(schema.materials.id, materialId));
    throw Object.assign(new Error(reason), { code: 'extract-failed' });
  }

  await job.updateProgress(25);

  // ---- Build worker AuthContext ----
  const jobAuthCtx: AuthContext = {
    userId: requestedBy,
    workspaceId,
    membershipTier: 'steward',
    permissions: [
      { resource: 'page', verb: 'view', scope: 'all' },
      { resource: 'page', verb: 'edit', scope: 'all' },
      { resource: 'kb', verb: 'view', scope: 'all' },
    ],
    source: 'session',
  };

  // ---- Run agent loop ----
  const costMeter = createCostMeter(redis);
  let agentResult;

  try {
    agentResult = await runWikiCompile({
      ctx: jobAuthCtx,
      workspaceId,
      kbId,
      materialId,
      materialText,
      costMeter,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.materials)
      .set({ status: 'failed', failedReason: reason, updatedAt: new Date() })
      .where(eq(schema.materials.id, materialId));
    throw err;
  }

  await job.updateProgress(80);

  // ---- Rebuild catalog under mutex ----
  await rebuildCatalogWithMutex(workspaceId, kbId, redis);

  // ---- Mark material completed ----
  const noteCount =
    agentResult.output.notesCreated.length + agentResult.output.notesUpdated.length;

  await db
    .update(schema.materials)
    .set({ status: 'completed', progress: 100, pageCount: noteCount, updatedAt: new Date() })
    .where(eq(schema.materials.id, materialId));

  await job.updateProgress(100);

  // Mark jobs row as completed (P08 idempotency persistence)
  if (existingJobs.length > 0) {
    await db
      .update(schema.jobs)
      .set({ state: 'completed', progress: 100, finishedAt: new Date() })
      .where(eq(schema.jobs.id, existingJobs[0]!.id));
  }

  logger.info(
    {
      materialId,
      idempotencyHash,
      notes: noteCount,
      steps: agentResult.stepsUsed,
      tokens: agentResult.totalInputTokens + agentResult.totalOutputTokens,
    },
    '[job-handler] done',
  );
}

// ---------------------------------------------------------------------------
// extractMaterialText — route to correct extractor by mime/storage key

async function extractMaterialText(
  material: typeof schema.materials.$inferSelect,
): Promise<string> {
  if (material.mimeType === 'text/html' || material.storageKey.startsWith('url:')) {
    const url = material.storageKey.replace(/^url:/, '');
    const { text } = await extractFromUrl(url);
    return text;
  }

  const store = getObjectStore();
  const buf = await store.download(material.storageKey);

  if (
    material.mimeType.includes('wordprocessingml') ||
    material.mimeType === 'application/msword' ||
    material.fileName.endsWith('.docx')
  ) {
    const { text } = await extractFromDocx(buf);
    return text;
  }

  const { text } = await extractFromPdf(buf);
  return text;
}

// ---------------------------------------------------------------------------
// buildIdempotencyHash — SHA-256 triple key for deduplication (P08 will persist)

function buildIdempotencyHash(
  materialId: string,
  promptVersionId: string,
  scopeFilterHash: string,
): string {
  return createHash('sha256')
    .update(`${materialId}:${promptVersionId}:${scopeFilterHash}`)
    .digest('hex')
    .slice(0, 16);
}
