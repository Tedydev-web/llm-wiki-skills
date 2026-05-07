/**
 * handler.ts — BullMQ job handler for embedding-rebuild queue.
 *
 * Triggered when admin switches embedding provider in Settings.
 * Re-embeds workspace notes and writes vectors to the new dim column.
 * Mid-switch abort: checks provider_settings.updated_at per batch.
 * Idempotent: skips notes already at current provider + model.
 * Rate-limited: Google 30 RPM, OpenAI 5000 RPM, Voyage per tier.
 * Anti-trace: embedAndStore() | embedding_provider column.
 */

import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '../../storage/db.js';
import { logger } from '../../lib/logger.js';
import { embedNote, getDimColumn, getActiveEmbeddingConfig } from '../../services/embedding-router.js';
import type { EmbeddingDim } from '../../services/embedding-router.js';

// ---------------------------------------------------------------------------
// Job data shape

export interface EmbeddingRebuildJobData {
  workspaceId: string;
  /** ISO timestamp of provider_settings.updated_at when job was enqueued */
  providerUpdatedAt: string;
  /** Target vendor at enqueue time (for logging) */
  targetVendor: string;
  /** Batch size per DB query (default 50) */
  batchSize?: number;
}

// ---------------------------------------------------------------------------
// Rate-limit delays per vendor (ms per request)

const RATE_LIMIT_DELAY_MS: Record<string, number> = {
  google:    2_000,   // 30 RPM → 2s between requests
  openai:    12,      // 5000 RPM tier-1 → ~12ms between requests
  voyage:    500,     // conservative default for Voyage tier
  anthropic: 1_000,   // no embedding capability; fallback
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// embedAndStore — own naming (see plan §Anti-Trace Discipline)

async function embedAndStore(
  noteId: string,
  workspaceId: string,
  text: string,
  dim: EmbeddingDim,
): Promise<void> {
  const db = getDb();
  const colName = getDimColumn(dim);
  const { vector, provider, model } = await embedNote(workspaceId, text);
  const vectorLiteral = `[${vector.join(',')}]`;

  // Build per-column SQL: active dim gets vector, others get NULL
  // colName is one of 3 static strings — safe from injection
  const set768  = dim === 768  ? sql.raw(`'${vectorLiteral}'::vector`) : sql`NULL`;
  const set1024 = dim === 1024 ? sql.raw(`'${vectorLiteral}'::vector`) : sql`NULL`;
  const set1536 = dim === 1536 ? sql.raw(`'${vectorLiteral}'::vector`) : sql`NULL`;

  await db.execute(sql`
    UPDATE notes
    SET
      embedding_768         = ${set768},
      embedding_1024        = ${set1024},
      embedding_1536        = ${set1536},
      embedding_provider    = ${provider},
      embedding_model       = ${model},
      embedding_dimensions  = ${dim},
      embedding_updated_at  = now(),
      updated_at            = now()
    WHERE id = ${noteId}
  `);
}

// ---------------------------------------------------------------------------
// checkMidSwitchAbort — returns true if provider config has changed since job start

async function checkMidSwitchAbort(
  workspaceId: string,
  originalUpdatedAt: string,
): Promise<boolean> {
  const config = await getActiveEmbeddingConfig(workspaceId);
  if (!config) return true; // provider removed — abort
  const currentUpdatedAt = config.updatedAt instanceof Date
    ? config.updatedAt.toISOString()
    : String(config.updatedAt);
  return currentUpdatedAt !== originalUpdatedAt;
}

// ---------------------------------------------------------------------------
// processEmbeddingRebuildJob — main handler

export async function processEmbeddingRebuildJob(
  job: Job<EmbeddingRebuildJobData>,
): Promise<{ rebuilt: number; skipped: number; aborted: boolean }> {
  const { workspaceId, providerUpdatedAt, batchSize = 50 } = job.data;

  logger.info(
    { workspaceId, targetVendor: job.data.targetVendor },
    '[embedding-rebuild] job started',
  );

  // Get the current active config at job start
  const config = await getActiveEmbeddingConfig(workspaceId);
  if (!config) {
    logger.warn({ workspaceId }, '[embedding-rebuild] no embedding provider configured — aborting');
    return { rebuilt: 0, skipped: 0, aborted: true };
  }

  const targetDim = (
    config.vendor === 'openai'  ? 1536 :
    config.vendor === 'voyage'  ? 1024 : 768
  ) as EmbeddingDim;

  const rateLimitMs = RATE_LIMIT_DELAY_MS[config.vendor] ?? 1_000;
  const db = getDb();

  let offset = 0;
  let rebuilt = 0;
  let skipped = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Mid-switch abort check per batch
    const aborted = await checkMidSwitchAbort(workspaceId, providerUpdatedAt);
    if (aborted) {
      logger.warn(
        { workspaceId, rebuilt, skipped },
        '[embedding-rebuild] mid-switch abort — provider config changed during rebuild',
      );
      return { rebuilt, skipped, aborted: true };
    }

    // Fetch next batch — include notes not yet at current provider+model.
    // Use raw SQL for nullable column comparison (IS NULL OR != active) to avoid
    // Drizzle type issues with nullable varchar columns.
    const batch = await db.execute(sql`
      SELECT id, title, content, embedding_provider, embedding_dimensions, embedding_model
      FROM notes
      WHERE workspace_id = ${workspaceId}
        AND deleted_at IS NULL
        AND (
          embedding_provider IS NULL
          OR embedding_provider != ${config.vendor}
          OR embedding_model != ${config.model}
        )
      ORDER BY created_at ASC
      LIMIT ${batchSize} OFFSET ${offset}
    `) as Array<{
      id: string;
      title: string;
      content: string;
      embedding_provider: string | null;
      embedding_dimensions: number | null;
      embedding_model: string | null;
    }>;

    if (batch.length === 0) break;

    for (const note of batch) {
      // Per-note mid-switch check for large workspaces
      const abortedMid = await checkMidSwitchAbort(workspaceId, providerUpdatedAt);
      if (abortedMid) {
        logger.warn({ workspaceId, noteId: note['id'] }, '[embedding-rebuild] mid-note abort');
        return { rebuilt, skipped, aborted: true };
      }

      try {
        const text = `${note['title']}\n${note['content']}`;
        await embedAndStore(note['id'], workspaceId, text, targetDim);
        rebuilt++;
        logger.debug({ noteId: note.id, dim: targetDim }, '[embedding-rebuild] note re-embedded');
      } catch (err) {
        logger.error(
          { noteId: note['id'], err: err instanceof Error ? err.message : String(err) },
          '[embedding-rebuild] failed to embed note — skipping',
        );
        skipped++;
      }

      await delay(rateLimitMs);
    }

    offset += batchSize;
    await job.updateProgress(Math.min(99, Math.round((rebuilt + skipped) / Math.max(1, rebuilt + skipped + batchSize) * 100)));
  }

  logger.info(
    { workspaceId, rebuilt, skipped, dim: targetDim },
    '[embedding-rebuild] job complete',
  );

  return { rebuilt, skipped, aborted: false };
}

// ---------------------------------------------------------------------------
// estimateRebuildCost — pre-flight cost estimate for Settings UI confirm modal

export async function estimateRebuildCost(
  workspaceId: string,
  vendor: string,
  model: string,
): Promise<{
  notesCount: number;
  estimatedTokens: number;
  estimatedUsd: number;
  perMillionTokensUsd: number;
}> {
  const db = getDb();

  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS count,
           AVG(LENGTH(title) + LENGTH(content)) AS avg_chars
    FROM notes
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
  `);

  const row = (countResult as unknown[])[0] as Record<string, unknown>;
  const notesCount = Number(row['count'] ?? 0);
  const avgChars   = Number(row['avg_chars'] ?? 500);

  // Approximate: 1 token ≈ 4 chars for English text
  const avgTokens = Math.ceil(avgChars / 4);
  const estimatedTokens = notesCount * avgTokens;

  // Cost per 1M tokens by vendor/model (USD, input embedding pricing as of 2026)
  const pricePerMillion: Record<string, number> = {
    'text-embedding-3-small': 0.02,    // OpenAI
    'text-embedding-004':     0.00,    // Google: free tier (Gemini)
    'voyage-3-large':         0.18,    // Voyage AI voyage-3-large
  };

  const perMillionTokensUsd = pricePerMillion[model] ?? 0.10;
  const estimatedUsd = (estimatedTokens / 1_000_000) * perMillionTokensUsd;

  return { notesCount, estimatedTokens, estimatedUsd, perMillionTokensUsd };
}
