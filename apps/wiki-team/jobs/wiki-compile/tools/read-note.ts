/**
 * read-note.ts — readNote tool: fetch full content of a note by slug
 *
 * Returns the complete content of an existing note page. Agent uses this
 * when the excerpt from searchNotes is insufficient for its task.
 *
 * RBAC gate: page.view — evaluated before DB access.
 */

import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { evaluatePolicy } from '../../../rbac/index.js';
import type { AuthContext } from '../../../auth/auth-context.js';
import { getDb, schema } from '../../../storage/db.js';
import { validateSlug } from '../slug-rules.js';

// ---------------------------------------------------------------------------
// Schemas

export const readNoteInputSchema = z.object({
  workspaceId: z.string().uuid(),
  kbId: z.string().uuid(),
  slug: z.string().min(1).max(120),
});

export type ReadNoteInput = z.infer<typeof readNoteInputSchema>;

export const readNoteOutputSchema = z.object({
  slug: z.string(),
  title: z.string(),
  taxonomy: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  links: z.array(z.string()),
  version: z.number().int().min(1),
  updatedAt: z.string().datetime(),
});

export type ReadNoteOutput = z.infer<typeof readNoteOutputSchema>;

// ---------------------------------------------------------------------------
// Tool handler

export async function handleReadNote(
  ctx: AuthContext,
  input: ReadNoteInput,
): Promise<ReadNoteOutput> {
  // Validate slug before touching DB
  const slugCheck = validateSlug(input.slug);
  if (!slugCheck.ok) {
    throw new Error(`invalid-slug: ${slugCheck.reason}`);
  }

  // RBAC gate
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  if (!decision.allow) {
    throw Object.assign(
      new Error(`rbac-denied: ${decision.reason}`),
      { code: 'rbac-denied' },
    );
  }

  const db = getDb();
  const rows = await db
    .select()
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

  if (rows.length === 0) {
    throw Object.assign(
      new Error(`note-not-found: slug "${input.slug}" does not exist in this KB`),
      { code: 'note-not-found' },
    );
  }

  const row = rows[0]!;
  return {
    slug: row.slug,
    title: row.title,
    taxonomy: row.taxonomy,
    content: row.content,
    tags: Array.isArray(row.tags) ? row.tags as string[] : [],
    links: Array.isArray(row.links) ? row.links as string[] : [],
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}
