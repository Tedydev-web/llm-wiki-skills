/**
 * link-notes.ts — linkNotes tool: create a cross-reference between two notes
 *
 * Inserts a row into note_links (from → to) and updates the `links` JSONB
 * array on the source note so the agent's subsequent readNote calls see the
 * updated link list without a separate join query.
 *
 * Idempotent: re-linking the same pair is a no-op (unique index on from+to).
 *
 * RBAC gate: page.edit — write access required for link creation.
 */

import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { evaluatePolicy } from '../../rbac/index.js';
import type { AuthContext } from '../../auth/auth-context.js';
import { getDb, schema } from '../../storage/db.js';
import { validateSlug } from '../slug-rules.js';

// ---------------------------------------------------------------------------
// Schemas

export const linkNotesInputSchema = z.object({
  workspaceId: z.string().uuid(),
  kbId: z.string().uuid(),
  fromSlug: z.string().min(1).max(120),
  toSlug: z.string().min(1).max(120),
  /** Optional display text for the wikilink (e.g. "see also: Deployment") */
  linkText: z.string().max(255).optional(),
});

export type LinkNotesInput = z.infer<typeof linkNotesInputSchema>;

export const linkNotesOutputSchema = z.object({
  fromSlug: z.string(),
  toSlug: z.string(),
  /** 'created' if a new link row was inserted; 'exists' if already present */
  action: z.enum(['created', 'exists']),
});

export type LinkNotesOutput = z.infer<typeof linkNotesOutputSchema>;

// ---------------------------------------------------------------------------
// Tool handler

export async function handleLinkNotes(
  ctx: AuthContext,
  input: LinkNotesInput,
): Promise<LinkNotesOutput> {
  // Validate slugs before any DB work
  for (const [label, slug] of [['fromSlug', input.fromSlug], ['toSlug', input.toSlug]] as const) {
    const check = validateSlug(slug);
    if (!check.ok) {
      throw new Error(`invalid-slug: ${label} — ${check.reason}`);
    }
  }

  if (input.fromSlug === input.toSlug) {
    throw new Error('invalid-link: fromSlug and toSlug must be different pages');
  }

  // RBAC gate
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

  // Resolve both slugs to note IDs
  const [fromRows, toRows] = await Promise.all([
    db.select({ id: schema.notes.id })
      .from(schema.notes)
      .where(and(
        eq(schema.notes.workspaceId, input.workspaceId),
        eq(schema.notes.kbId, input.kbId),
        eq(schema.notes.slug, input.fromSlug),
        isNull(schema.notes.deletedAt),
      ))
      .limit(1),
    db.select({ id: schema.notes.id })
      .from(schema.notes)
      .where(and(
        eq(schema.notes.workspaceId, input.workspaceId),
        eq(schema.notes.kbId, input.kbId),
        eq(schema.notes.slug, input.toSlug),
        isNull(schema.notes.deletedAt),
      ))
      .limit(1),
  ]);

  if (fromRows.length === 0) {
    throw new Error(`note-not-found: fromSlug "${input.fromSlug}" does not exist`);
  }
  if (toRows.length === 0) {
    throw new Error(`note-not-found: toSlug "${input.toSlug}" does not exist`);
  }

  const fromNoteId = fromRows[0]!.id;
  const toNoteId = toRows[0]!.id;

  // Check if link already exists
  const existingLink = await db
    .select({ id: schema.noteLinks.id })
    .from(schema.noteLinks)
    .where(and(
      eq(schema.noteLinks.fromNoteId, fromNoteId),
      eq(schema.noteLinks.toNoteId, toNoteId),
    ))
    .limit(1);

  if (existingLink.length > 0) {
    return { fromSlug: input.fromSlug, toSlug: input.toSlug, action: 'exists' };
  }

  // Insert note_links row
  await db.insert(schema.noteLinks).values({
    fromNoteId,
    toNoteId,
    linkText: input.linkText ?? null,
  });

  // Update source note's links JSONB array (append toSlug if not already present)
  // Uses jsonb_set + array append pattern; sql`` escape hatch required for JSONB ops.
  await db
    .update(schema.notes)
    .set({
      links: sql`(
        CASE
          WHEN ${schema.notes.links} @> ${sql.raw(`'["${input.toSlug}"]'::jsonb`)}
          THEN ${schema.notes.links}
          ELSE ${schema.notes.links} || ${sql.raw(`'["${input.toSlug}"]'::jsonb`)}
        END
      )`,
      updatedAt: new Date(),
    })
    .where(eq(schema.notes.id, fromNoteId));

  return { fromSlug: input.fromSlug, toSlug: input.toSlug, action: 'created' };
}
