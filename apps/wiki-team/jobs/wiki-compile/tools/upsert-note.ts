/**
 * upsert-note.ts — upsertNote tool: create-or-update a wiki note page
 *
 * Combined create+update surface (single tool instead of two per phase-06 ADR).
 * On first call: INSERT with version=1.
 * On subsequent calls: UPDATE with version increment (optimistic concurrency per ADR 011).
 *
 * Slug must pass validateSlug() before any DB write.
 * Sentinel slugs (__catalog, __history) are FORBIDDEN for agent writes —
 * those are maintained exclusively by rebuildCatalog().
 *
 * RBAC gate: page.edit — required for any write.
 */

import { z } from 'zod';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { evaluatePolicy } from '../../../rbac/index.js';
import type { AuthContext } from '../../../auth/auth-context.js';
import { getDb, schema } from '../../../storage/db.js';
import { validateSlug, isSentinel } from '../slug-rules.js';
import { embedNote, getDimColumn } from '../../../services/embedding-router.js';
import type { EmbeddingDim } from '../../../services/embedding-router.js';
import { logger } from '../../../lib/logger.js';
import { pageTaxonomySchema } from '@wiki-team/schema';

// ---------------------------------------------------------------------------
// Schemas

export const upsertNoteInputSchema = z.object({
  workspaceId: z.string().uuid(),
  kbId: z.string().uuid(),
  slug: z.string().min(1).max(40),
  title: z.string().min(1).max(255),
  content: z.string().min(1),
  taxonomy: pageTaxonomySchema,
  tags: z.array(z.string().max(64)).default([]),
});

export type UpsertNoteInput = z.infer<typeof upsertNoteInputSchema>;

export const upsertNoteOutputSchema = z.object({
  slug: z.string(),
  version: z.number().int().min(1),
  /** 'created' if a new note was inserted; 'updated' if an existing note was modified */
  action: z.enum(['created', 'updated']),
});

export type UpsertNoteOutput = z.infer<typeof upsertNoteOutputSchema>;

// ---------------------------------------------------------------------------
// Tool handler

export async function handleUpsertNote(
  ctx: AuthContext,
  input: UpsertNoteInput,
): Promise<UpsertNoteOutput> {
  // Reject sentinel slugs — agent must never write __catalog or __history directly
  if (isSentinel(input.slug)) {
    throw new Error(
      `forbidden-slug: agent cannot write to sentinel page "${input.slug}" — managed by system`,
    );
  }

  // Validate slug format
  const slugCheck = validateSlug(input.slug);
  if (!slugCheck.ok) {
    throw new Error(`invalid-slug: ${slugCheck.reason}`);
  }

  // RBAC gate — page.edit required for any write
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'edit' },
  );
  if (!decision.allow) {
    throw Object.assign(
      new Error(`rbac-denied: ${decision.reason}`),
      { code: 'rbac-denied' },
    );
  }

  const db = getDb();

  // Compute embedding via provider abstraction (ADR 013 — no direct Gemini SDK calls).
  // Falls back gracefully if no provider configured; note is stored without embedding.
  let embedResult: Awaited<ReturnType<typeof embedNote>> | null = null;
  try {
    embedResult = await embedNote(input.workspaceId, `${input.title}\n${input.content}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'EMBEDDING_PROVIDER_NOT_CONFIGURED') {
      logger.debug({ workspaceId: input.workspaceId }, '[upsert-note] no embedding provider — storing without vector');
    } else {
      logger.warn({ err: msg }, '[upsert-note] embedding failed — storing without vector');
    }
  }

  // Build dim-column SQL fragment: null if no embedding, otherwise typed vector literal
  function buildEmbedSet(dim: EmbeddingDim | null, vector: number[] | null) {
    const colName = dim ? getDimColumn(dim) : null;
    const vec768  = (dim === 768  && vector) ? sql.raw(`'[${vector.join(',')}]'::vector`) : sql`NULL`;
    const vec1024 = (dim === 1024 && vector) ? sql.raw(`'[${vector.join(',')}]'::vector`) : sql`NULL`;
    const vec1536 = (dim === 1536 && vector) ? sql.raw(`'[${vector.join(',')}]'::vector`) : sql`NULL`;
    return { vec768, vec1024, vec1536, colName };
  }

  const { vec768, vec1024, vec1536 } = buildEmbedSet(
    embedResult?.dim ?? null,
    embedResult?.vector ?? null,
  );

  // Check for existing note (to decide insert vs update)
  const existing = await db
    .select({ id: schema.notes.id, version: schema.notes.version })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.workspaceId, input.workspaceId),
        eq(schema.notes.kbId, input.kbId),
        eq(schema.notes.slug, input.slug),
        isNull(schema.notes.deletedAt),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    // INSERT path — new note.
    // Multi-dim embedding columns written via raw SQL (Drizzle insert doesn't support
    // dynamic vector column names; all three dim columns are explicit).
    const noteId = crypto.randomUUID();
    await db.execute(sql`
      INSERT INTO notes (
        id, workspace_id, kb_id, slug, title, content, taxonomy, tags, links,
        embedding_768, embedding_1024, embedding_1536,
        embedding_provider, embedding_model, embedding_dimensions, embedding_updated_at,
        version, created_at, updated_at
      ) VALUES (
        ${noteId}, ${input.workspaceId}, ${input.kbId}, ${input.slug},
        ${input.title}, ${input.content}, ${input.taxonomy},
        ${JSON.stringify(input.tags)}::jsonb, '[]'::jsonb,
        ${vec768}, ${vec1024}, ${vec1536},
        ${embedResult?.provider ?? null}, ${embedResult?.model ?? null},
        ${embedResult?.dim ?? null},
        ${embedResult ? sql`now()` : sql`NULL`},
        1, now(), now()
      )
    `);
    return { slug: input.slug, version: 1, action: 'created' };
  }

  // UPDATE path — increment version (ADR 011 optimistic concurrency)
  const { id, version } = existing[0]!;
  const nextVersion = version + 1;

  // Atomic UPDATE WHERE version = :expected — no read-then-check race window (ADR 011)
  const updated = await db.execute(sql`
    UPDATE notes
    SET
      title               = ${input.title},
      content             = ${input.content},
      taxonomy            = ${input.taxonomy},
      tags                = ${JSON.stringify(input.tags)}::jsonb,
      embedding_768       = ${vec768},
      embedding_1024      = ${vec1024},
      embedding_1536      = ${vec1536},
      embedding_provider  = ${embedResult?.provider ?? null},
      embedding_model     = ${embedResult?.model ?? null},
      embedding_dimensions = ${embedResult?.dim ?? null},
      embedding_updated_at = ${embedResult ? sql`now()` : sql`NULL`},
      version             = ${nextVersion},
      updated_at          = now()
    WHERE id = ${id}
      AND version = ${version}
    RETURNING version
  `);

  if ((updated as unknown[]).length === 0) {
    throw Object.assign(
      new Error(`version-conflict: note "${input.slug}" was modified concurrently`),
      { code: 'version-conflict' },
    );
  }

  return { slug: input.slug, version: nextVersion, action: 'updated' };
}
