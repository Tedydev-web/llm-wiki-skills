/**
 * embedding-router.ts — dim router + provider lookup per workspace.
 *
 * ADR 013 §Vector dimension routing:
 *   768d  → notes.embedding_768   (Google text-embedding-004)
 *   1024d → notes.embedding_1024  (Voyage voyage-3-large)
 *   1536d → notes.embedding_1536  (OpenAI text-embedding-3-small)
 *
 * Calls ProviderFactory.getEmbedding() with decrypted config from provider_settings.
 * Never calls Gemini SDK directly — all embedding goes through the factory.
 *
 * Anti-trace: own naming throughout (see plan §Anti-Trace Discipline).
 */

import { eq, and, isNull, sql } from 'drizzle-orm';
import { ProviderFactory } from '@wiki-team/shared/providers';
import type { Vendor } from '@wiki-team/shared/providers';
import { decryptApiKey } from './provider-key-encryption.js';
import { getDb, schema } from '../storage/db.js';
import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types

export type EmbeddingDim = 768 | 1024 | 1536;

export interface EmbedResult {
  vector: number[];
  dim: EmbeddingDim;
  provider: Vendor;
  model: string;
}

export interface SearchResult {
  id: string;
  slug: string;
  title: string;
  content: string;
  taxonomy: string;
  score: number;
  embeddingProvider: string | null;
  embeddingDimensions: number | null;
}

// Column name per dim — avoids string interpolation in hot path
const DIM_COLUMN: Record<EmbeddingDim, string> = {
  768: 'embedding_768',
  1024: 'embedding_1024',
  1536: 'embedding_1536',
};

// ---------------------------------------------------------------------------
// getProviderConfig — fetch + decrypt active embedding config for workspace

async function getProviderConfig(workspaceId: string) {
  const db = getDb();

  const rows = await db
    .select()
    .from(schema.providerSettings)
    .where(
      and(
        eq(schema.providerSettings.workspaceId, workspaceId),
        eq(schema.providerSettings.capability, 'embedding'),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0]!;
  const apiKey = await decryptApiKey(
    row.apiKeyEncrypted,
    row.encryptionMetadata as Parameters<typeof decryptApiKey>[1],
    workspaceId,
  );

  return {
    vendor: row.vendor as Vendor,
    model: row.model,
    apiKey,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// embedNote — public API: embed text via workspace's configured provider

export async function embedNote(workspaceId: string, text: string): Promise<EmbedResult> {
  const config = await getProviderConfig(workspaceId);
  if (!config) {
    throw Object.assign(
      new Error('EMBEDDING_PROVIDER_NOT_CONFIGURED'),
      { code: 'EMBEDDING_PROVIDER_NOT_CONFIGURED' },
    );
  }

  const embedder = ProviderFactory.getEmbedding(config.vendor, {
    apiKey: config.apiKey,
    model: config.model,
  });

  const result = await embedder.embed([text]);
  const vector = result.vectors[0];

  if (!vector || vector.length === 0) {
    throw new Error(`[embedding-router] Empty vector returned by ${config.vendor}`);
  }

  const dim = vector.length as EmbeddingDim;
  if (dim !== 768 && dim !== 1024 && dim !== 1536) {
    throw new Error(
      `[embedding-router] Unexpected dimension ${dim} from ${config.vendor}/${config.model}. ` +
      'Expected 768 | 1024 | 1536.',
    );
  }

  logger.debug(
    { workspaceId, vendor: config.vendor, model: config.model, dim },
    '[embedding-router] embedNote complete',
  );

  return { vector, dim, provider: config.vendor, model: config.model };
}

// ---------------------------------------------------------------------------
// searchNotes — semantic search via cosine distance on the correct dim column

export async function searchNotes(
  workspaceId: string,
  query: string,
  topK = 25,
): Promise<SearchResult[]> {
  const { vector, dim } = await embedNote(workspaceId, query);
  const colName = DIM_COLUMN[dim];
  const vectorLiteral = `[${vector.join(',')}]`;

  const db = getDb();

  // Raw SQL for pgvector cosine distance (<=> operator) — Drizzle has no first-class support.
  // colName is one of three static strings (not user input) — safe from injection.
  const rows = await db.execute(sql`
    SELECT
      id,
      slug,
      title,
      content,
      taxonomy,
      embedding_provider,
      embedding_dimensions,
      ${sql.raw(colName)} <=> ${vectorLiteral}::vector AS score
    FROM notes
    WHERE workspace_id = ${workspaceId}
      AND deleted_at IS NULL
      AND ${sql.raw(colName)} IS NOT NULL
    ORDER BY score ASC
    LIMIT ${topK}
  `);

  return (rows as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row['id'] as string,
      slug: row['slug'] as string,
      title: row['title'] as string,
      content: row['content'] as string,
      taxonomy: row['taxonomy'] as string,
      score: Number(row['score']),
      embeddingProvider: (row['embedding_provider'] as string | null) ?? null,
      embeddingDimensions: row['embedding_dimensions'] != null
        ? Number(row['embedding_dimensions'])
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// escapeILike — keyword search injection guard (ADR §Search endpoint)
// Escapes: %, _, \ which have special meaning in SQL ILIKE patterns.

export function escapeILike(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ---------------------------------------------------------------------------
// getDimColumn — returns the Postgres column name for a given dim (used by rebuild job)

export function getDimColumn(dim: EmbeddingDim): string {
  return DIM_COLUMN[dim];
}

// ---------------------------------------------------------------------------
// getActiveEmbeddingConfig — exposes provider config for the rebuild job

export { getProviderConfig as getActiveEmbeddingConfig };
