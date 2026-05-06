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
import { and, eq, isNull } from 'drizzle-orm';
import { evaluatePolicy } from '../../rbac/index.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { getDb, schema } from '../../storage/db.js';
import { validateSlug, isSentinel } from '../slug-rules.js';
import { embed } from '../../storage/embedding.js';
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

  // Compute embedding for semantic search
  const embeddingVector = await embed(`${input.title}\n${input.content}`);

  const db = getDb();

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
    // INSERT path — new note
    await db.insert(schema.notes).values({
      workspaceId: input.workspaceId,
      kbId: input.kbId,
      slug: input.slug,
      title: input.title,
      content: input.content,
      taxonomy: input.taxonomy,
      tags: input.tags,
      links: [],        // links populated separately via linkNotes tool
      embedding: embeddingVector,
      version: 1,       // ADR 011: starts at 1
    });

    return { slug: input.slug, version: 1, action: 'created' };
  }

  // UPDATE path — increment version (ADR 011 optimistic concurrency)
  const { id, version } = existing[0]!;
  const nextVersion = version + 1;

  await db
    .update(schema.notes)
    .set({
      title: input.title,
      content: input.content,
      taxonomy: input.taxonomy,
      tags: input.tags,
      embedding: embeddingVector,
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.notes.id, id),
        eq(schema.notes.version, version), // optimistic lock
      ),
    );

  return { slug: input.slug, version: nextVersion, action: 'updated' };
}
