/**
 * group-service.ts — Group CRUD + group_note_kinds management (P08 / ADR 010).
 *
 * Enforces:
 *   - Slug regex (1–64 lowercase alphanumeric/hyphen)
 *   - DELETE rejects with 409 if workspace members are assigned to the group
 *   - group_note_kinds: unique (group_id, note_kind_id); idempotent assign
 *
 * Anti-trace: generic "group" naming (not department/dept).
 */

import { getDb, schema } from '../storage/db.js';
import { eq, sql } from 'drizzle-orm';

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

// ---------------------------------------------------------------------------
// Types

export interface GroupRow {
  id: string;
  slug: string;
  displayName: string;
  createdAt: Date;
}

export interface GroupNoteKindRow {
  id: string;
  groupId: string;
  noteKindId: string;
  noteKindSlug: string;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers

function err(msg: string, status: number, code: string): never {
  throw Object.assign(new Error(msg), { status, code });
}

export function validateGroupSlug(slug: string): string | null {
  return SLUG_RE.test(slug) ? null : 'slug must be 1–64 lowercase alphanumeric/hyphen characters';
}

// ---------------------------------------------------------------------------
// Group CRUD

/** List all non-deleted groups ordered by slug. */
export async function listGroups(): Promise<GroupRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id:          schema.groups.id,
      slug:        schema.groups.slug,
      displayName: schema.groups.displayName,
      createdAt:   schema.groups.createdAt,
    })
    .from(schema.groups)
    .where(sql`${schema.groups.deletedAt} IS NULL`)
    .orderBy(schema.groups.slug);
  return rows;
}

/** Create a new group. Slug must be unique. */
export async function createGroup(input: { slug: string; displayName: string }): Promise<GroupRow> {
  const slugErr = validateGroupSlug(input.slug);
  if (slugErr) err(slugErr, 400, 'invalid_slug');
  if (!input.displayName.trim()) err('displayName is required', 400, 'invalid_display_name');

  const db = getDb();
  const [existing] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, input.slug))
    .limit(1);

  if (existing) err(`Group slug '${input.slug}' already exists`, 409, 'slug_conflict');

  const id = crypto.randomUUID();
  await db.insert(schema.groups).values({
    id,
    slug: input.slug,
    displayName: input.displayName.trim(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const [row] = await db
    .select({ id: schema.groups.id, slug: schema.groups.slug, displayName: schema.groups.displayName, createdAt: schema.groups.createdAt })
    .from(schema.groups)
    .where(eq(schema.groups.id, id))
    .limit(1);
  if (!row) err('Group insert failed', 500, 'insert_failed');
  return row;
}

/** Patch group displayName by slug. */
export async function patchGroup(slug: string, displayName: string): Promise<GroupRow> {
  if (!displayName.trim()) err('displayName is required', 400, 'invalid_display_name');
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);

  if (!existing) err(`Group '${slug}' not found`, 404, 'not_found');

  await db
    .update(schema.groups)
    .set({ displayName: displayName.trim(), updatedAt: new Date() })
    .where(eq(schema.groups.slug, slug));

  const [row] = await db
    .select({ id: schema.groups.id, slug: schema.groups.slug, displayName: schema.groups.displayName, createdAt: schema.groups.createdAt })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);
  if (!row) err(`Group '${slug}' not found after patch`, 404, 'not_found');
  return row;
}

/**
 * Delete group by slug.
 * Rejects with 409 if any workspace member has groupId pointing to this group
 * (via users.group_id) to prevent orphaning access control assignments.
 */
export async function deleteGroup(slug: string): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, slug))
    .limit(1);

  if (!existing) err(`Group '${slug}' not found`, 404, 'not_found');

  // Check if any user still belongs to this group
  const [member] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.groupId, existing.id))
    .limit(1);

  if (member) {
    err(`Cannot delete group '${slug}': users are still assigned to it`, 409, 'members_exist');
  }

  await db.delete(schema.groups).where(eq(schema.groups.id, existing.id));
}

// ---------------------------------------------------------------------------
// group_note_kinds management

/** List note kinds assigned to a group (by group slug). */
export async function listGroupNoteKinds(groupSlug: string): Promise<GroupNoteKindRow[]> {
  const db = getDb();
  const [group] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, groupSlug))
    .limit(1);

  if (!group) err(`Group '${groupSlug}' not found`, 404, 'not_found');

  const rows = await db.execute(
    sql`SELECT gnk.id, gnk.group_id, gnk.note_kind_id, nk.slug AS note_kind_slug, gnk.created_at
        FROM group_note_kinds gnk
        JOIN note_kinds nk ON nk.id = gnk.note_kind_id
        WHERE gnk.group_id = ${group.id}
        ORDER BY nk.slug`,
  );

  return (rows as unknown as Array<{
    id: string; group_id: string; note_kind_id: string; note_kind_slug: string; created_at: Date;
  }>).map((r) => ({
    id: r.id,
    groupId: r.group_id,
    noteKindId: r.note_kind_id,
    noteKindSlug: r.note_kind_slug,
    createdAt: r.created_at,
  }));
}

/** Assign a note kind (by slug) to a group (by slug). Idempotent. */
export async function assignNoteKindToGroup(groupSlug: string, noteKindSlug: string): Promise<GroupNoteKindRow> {
  const db = getDb();
  const [group] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, groupSlug))
    .limit(1);
  if (!group) err(`Group '${groupSlug}' not found`, 404, 'not_found');

  const [kind] = await db
    .select({ id: schema.noteKinds.id })
    .from(schema.noteKinds)
    .where(eq(schema.noteKinds.slug, noteKindSlug))
    .limit(1);
  if (!kind) err(`NoteKind '${noteKindSlug}' not found`, 404, 'not_found');

  // Idempotent: return existing row if already assigned
  const [existing] = await db.execute(
    sql`SELECT id, group_id, note_kind_id, created_at
        FROM group_note_kinds
        WHERE group_id = ${group.id} AND note_kind_id = ${kind.id}
        LIMIT 1`,
  ) as unknown as Array<{ id: string; group_id: string; note_kind_id: string; created_at: Date }>;

  if (existing) {
    return {
      id: existing.id, groupId: existing.group_id, noteKindId: existing.note_kind_id,
      noteKindSlug, createdAt: existing.created_at,
    };
  }

  const id = crypto.randomUUID();
  await db.execute(
    sql`INSERT INTO group_note_kinds (id, group_id, note_kind_id, created_at)
        VALUES (${id}, ${group.id}, ${kind.id}, now())`,
  );

  return { id, groupId: group.id, noteKindId: kind.id, noteKindSlug, createdAt: new Date() };
}

/** Remove a note kind (by slug) from a group (by slug). */
export async function removeNoteKindFromGroup(groupSlug: string, noteKindSlug: string): Promise<void> {
  const db = getDb();
  const [group] = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(eq(schema.groups.slug, groupSlug))
    .limit(1);
  if (!group) err(`Group '${groupSlug}' not found`, 404, 'not_found');

  const [kind] = await db
    .select({ id: schema.noteKinds.id })
    .from(schema.noteKinds)
    .where(eq(schema.noteKinds.slug, noteKindSlug))
    .limit(1);
  if (!kind) err(`NoteKind '${noteKindSlug}' not found`, 404, 'not_found');

  await db.execute(
    sql`DELETE FROM group_note_kinds WHERE group_id = ${group.id} AND note_kind_id = ${kind.id}`,
  );
}
