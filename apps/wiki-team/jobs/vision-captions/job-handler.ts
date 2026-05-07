/**
 * job-handler.ts — per-image vision caption handler for vision-captions BullMQ queue.
 *
 * Flow per sub-job:
 *   1. SELECT material_images row — skip if already captioned/failed
 *   2. Size cap check (IMAGE_MAX_SIZE_MB)
 *   3. Pre-flight material cost cap peek (vision-material-cost:<materialId>)
 *   4. Resolve VisionProvider via provider_settings capability='vision'
 *   5. Download image bytes from MinIO
 *   6. Load vision-v1.md prompt
 *   7. Call VisionProvider.caption() with 15s timeout
 *   8. Post-call cost increment + cap check (both material + workspace daily)
 *   9. UPDATE material_images: caption, provider, cost, status='captioned'
 *
 * Failure modes (sub-job isolation — never re-throw):
 *   cost cap hit   → status='skipped', skippedReason='cost_cap_hit'
 *   size exceeded  → status='skipped', skippedReason='size_cap_exceeded'
 *   vision API err → status='failed', failedReason=<message>
 *   MinIO error    → status='failed', failedReason=<message>
 *
 * ADR 015 §Anti-trace: field names use 'caption' only (not the upstream attribute name).
 */

import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Job } from 'bullmq';
import { getDb, schema } from '../../storage/db.js';
import { getObjectStore } from '../../storage/object-store.js';
import { logger } from '../../lib/logger.js';
import { ProviderFactory } from '@wiki-team/shared/providers';
import { loadVisionPrompt } from './vision-prompt-loader.js';
import { resolveVisionProviderConfig } from './provider-resolver.js';
import {
  getMaterialCapMicroUsd,
  getMaxImageBytes,
  buildDailyKey,
  buildMaterialKey,
  checkAndIncrCap,
  DAILY_TTL_SECONDS,
  MICRO_USD,
} from './vision-cost-cap.js';
import type { VisionCaptionJobData } from './vision-caption-job.js';

const VISION_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// processVisionCaptionJob — main handler (never throws; sub-job isolated)

export async function processVisionCaptionJob(
  job: Job<VisionCaptionJobData>,
  redis: Redis,
): Promise<void> {
  const { imageRowId, materialId, workspaceId, storageKey, mimeType, sizeBytes } = job.data;
  const db = getDb();

  // 1. Fetch row — skip if already processed
  const rows = await db
    .select()
    .from(schema.materialImages)
    .where(eq(schema.materialImages.id, imageRowId))
    .limit(1);

  if (rows.length === 0) {
    logger.warn({ imageRowId }, '[vision-job] row not found — skipping');
    return;
  }
  const row = rows[0]!;
  if (row.status === 'captioned' || row.status === 'failed') {
    logger.debug({ imageRowId, status: row.status }, '[vision-job] already processed');
    return;
  }

  // 2. Size cap check
  if (sizeBytes > getMaxImageBytes()) {
    await markSkipped(db, imageRowId, 'size_cap_exceeded');
    return;
  }

  // 3. Pre-flight material cost cap peek (no increment yet)
  const materialCapMicroUsd = getMaterialCapMicroUsd();
  const materialKey = buildMaterialKey(materialId);
  const materialCurrentRaw = await redis.get(materialKey);
  const materialCurrentMicroUsd = materialCurrentRaw === null ? 0 : parseInt(materialCurrentRaw, 10);
  if (materialCurrentMicroUsd >= materialCapMicroUsd) {
    await markSkipped(db, imageRowId, 'cost_cap_hit');
    logger.info({ imageRowId, materialId }, '[vision-job] material cost cap hit — skipping');
    return;
  }

  // 4. Resolve vision provider
  let providerConfig: Awaited<ReturnType<typeof resolveVisionProviderConfig>>;
  try {
    providerConfig = await resolveVisionProviderConfig(workspaceId);
  } catch (err) {
    await markFailed(db, imageRowId, `provider-resolve-failed: ${asMsg(err)}`);
    return;
  }

  // 5. Download image bytes
  let imageBytes: Buffer;
  try {
    imageBytes = await getObjectStore().download(storageKey);
  } catch (err) {
    await markFailed(db, imageRowId, `minio-download-failed: ${asMsg(err)}`);
    logger.error({ imageRowId, storageKey, err: asMsg(err) }, '[vision-job] MinIO download failed');
    return;
  }

  // 6. Load prompt
  let visionPrompt: string;
  try {
    visionPrompt = await loadVisionPrompt();
  } catch (err) {
    await markFailed(db, imageRowId, `prompt-load-failed: ${asMsg(err)}`);
    return;
  }

  // 7. Call VisionProvider.caption() with timeout
  let caption: string;
  let costUsd: number;
  try {
    const provider = ProviderFactory.getVision(
      providerConfig.vendor as 'openai' | 'google' | 'anthropic' | 'voyage',
      { apiKey: providerConfig.apiKey, model: providerConfig.model },
    );
    const result = await withTimeout(
      provider.caption({ imageBytes: new Uint8Array(imageBytes), mimeType, prompt: visionPrompt }),
      VISION_TIMEOUT_MS,
      'vision-api-timeout',
    );
    caption = result.caption;
    costUsd = result.costUsd;
  } catch (err) {
    await markFailed(db, imageRowId, `caption-failed: ${asMsg(err)}`);
    logger.warn({ imageRowId, err: asMsg(err) }, '[vision-job] vision API error — image skipped');
    return;
  }

  const costMicroUsd = Math.round(costUsd * MICRO_USD);

  // 8. Post-call cost cap increment + check (both caps)
  const dailyKey = buildDailyKey(workspaceId);
  const { allowed: dailyAllowed } = await checkAndIncrCap(
    redis, dailyKey, costMicroUsd, Infinity, DAILY_TTL_SECONDS,
  );
  const { allowed: materialAllowed } = await checkAndIncrCap(
    redis, materialKey, costMicroUsd, materialCapMicroUsd,
  );

  if (!materialAllowed || !dailyAllowed) {
    await markSkipped(db, imageRowId, 'cost_cap_hit');
    logger.info({ imageRowId, materialId, costUsd }, '[vision-job] cost cap exceeded post-call');
    return;
  }

  // 9. Persist caption
  await db
    .update(schema.materialImages)
    .set({
      caption,
      captionProvider: providerConfig.vendor,
      captionCostUsd: costUsd.toFixed(6),
      status: 'captioned',
      updatedAt: new Date(),
    })
    .where(eq(schema.materialImages.id, imageRowId));

  logger.info(
    { imageRowId, materialId, provider: providerConfig.vendor, costUsd },
    '[vision-job] caption stored',
  );
}

// ---------------------------------------------------------------------------
// Helpers

async function markSkipped(
  db: ReturnType<typeof getDb>,
  imageRowId: string,
  skippedReason: string,
): Promise<void> {
  await db
    .update(schema.materialImages)
    .set({ status: 'skipped', skippedReason, updatedAt: new Date() })
    .where(eq(schema.materialImages.id, imageRowId));
}

async function markFailed(
  db: ReturnType<typeof getDb>,
  imageRowId: string,
  failedReason: string,
): Promise<void> {
  await db
    .update(schema.materialImages)
    .set({ status: 'failed', failedReason, updatedAt: new Date() })
    .where(eq(schema.materialImages.id, imageRowId));
}

function asMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
