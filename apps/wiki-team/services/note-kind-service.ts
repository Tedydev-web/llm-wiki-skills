/**
 * note-kind-service.ts — NoteKind CRUD business logic (ADR 014).
 *
 * Enforces: slug regex, color hex, system-default immutability, atomic delete.
 * Raw SQL used for 0005-migration columns (color, is_system_default, created_by_user_id)
 * until coordinator merges schema.ts after Wave 1.
 *
  * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 */

import { getDb, schema } from '../storage/db.js';
import { eq, sql } from 'drizzle-orm';

const SLUG_RE = /^[a-z0-9-]{1,32}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------------------
// Types

export interface NoteKindRow {
  id: string; slug: string; label: string;
  color: string; description: string | null;
  isSystemDefault: boolean; createdAt: Date;
}

export interface CreateNoteKindInput {
  slug: string; label: string;
  color?: string; description?: string; createdByUserId?: string;
}

export interface PatchNoteKindInput {
  color?: string; description?: string | null;
}

interface RawNoteKindRow {
  id: string; slug: string; display_name: string;
  color: string; description: string | null;
  is_system_default: boolean; created_at: Date;
}

// ---------------------------------------------------------------------------
// Validation

export function validateSlug(slug: string): string | null {
  return SLUG_RE.test(slug) ? null : 'slug must be 1–32 lowercase alphanumeric/hyphen characters';
}

export function validateColor(color: string): string | null {
  return COLOR_RE.test(color) ? null : 'color must be a 6-digit hex string (e.g. #3b82f6)';
}

// ---------------------------------------------------------------------------
// Helpers

function mapRow(r: RawNoteKindRow): NoteKindRow {
  return {
    id: r.id, slug: r.slug, label: r.display_name,
    color: r.color ?? '#6b7280',
    description: r.description ?? null,
    isSystemDefault: r.is_system_default ?? false,
    createdAt: r.created_at,
  };
}

function err(msg: string, status: number, code: string): never {
  throw Object.assign(new Error(msg), { status, code });
}

// ---------------------------------------------------------------------------
// Service functions

/** List all NoteKinds ordered by slug. */
export async function listNoteKinds(): Promise<NoteKindRow[]> {
  const db = getDb();
  const result = await db.execute(
    sql`SELECT id, slug, display_name, color, description, is_system_default, created_at
        FROM note_kinds ORDER BY slug`,
  );
  return (result as unknown as RawNoteKindRow[]).map(mapRow);
}

/** Create a custom NoteKind. RBAC (admin) enforced in route. */
export async function createNoteKind(input: CreateNoteKindInput): Promise<NoteKindRow> {
  const slugErr = validateSlug(input.slug);
  if (slugErr) err(slugErr, 400, 'invalid_slug');

  const color = input.color ?? '#6b7280';
  const colorErr = validateColor(color);
  if (colorErr) err(colorErr, 400, 'invalid_color');

  const db = getDb();
  const [existing] = await db
    .select({ slug: schema.noteKinds.slug })
    .from(schema.noteKinds)
    .where(eq(schema.noteKinds.slug, input.slug))
    .limit(1);

  if (existing) err(`NoteKind slug '${input.slug}' already exists`, 409, 'slug_conflict');

  const id = crypto.randomUUID();
  await db.execute(
    sql`INSERT INTO note_kinds
          (id, slug, display_name, color, description, created_by_user_id, is_system_default, created_at)
        VALUES (${id}, ${input.slug}, ${input.label}, ${color},
                ${input.description ?? null}, ${input.createdByUserId ?? null}, false, now())`,
  );

  const result = await db.execute(
    sql`SELECT id, slug, display_name, color, description, is_system_default, created_at
        FROM note_kinds WHERE id = ${id}`,
  );
  const row = (result as unknown as RawNoteKindRow[])[0];
  if (!row) err('NoteKind insert failed', 500, 'insert_failed');
  return mapRow(row);
}

/** Patch color and/or description. slug + label immutable per ADR 014. */
export async function patchNoteKind(slug: string, patch: PatchNoteKindInput): Promise<NoteKindRow> {
  if (patch.color !== undefined) {
    const colorErr = validateColor(patch.color);
    if (colorErr) err(colorErr, 400, 'invalid_color');
  }

  const db = getDb();
  const [existing] = await db
    .select({ slug: schema.noteKinds.slug })
    .from(schema.noteKinds)
    .where(eq(schema.noteKinds.slug, slug))
    .limit(1);

  if (!existing) err(`NoteKind '${slug}' not found`, 404, 'not_found');

  const setClauses: ReturnType<typeof sql>[] = [];
  if (patch.color !== undefined) setClauses.push(sql`color = ${patch.color}`);
  if (patch.description !== undefined) setClauses.push(sql`description = ${patch.description}`);

  if (setClauses.length > 0) {
    await db.execute(
      sql`UPDATE note_kinds SET ${sql.join(setClauses, sql`, `)} WHERE slug = ${slug}`,
    );
  }

  const result = await db.execute(
    sql`SELECT id, slug, display_name, color, description, is_system_default, created_at
        FROM note_kinds WHERE slug = ${slug}`,
  );
  const row = (result as unknown as RawNoteKindRow[])[0];
  if (!row) err(`NoteKind '${slug}' not found after patch`, 404, 'not_found');
  return mapRow(row);
}

/**
 * Delete a custom NoteKind.
 * Blocked: system defaults, or when active notes reference the slug.
 * Atomic: single DELETE WHERE NOT EXISTS ensures no race window.
 */
export async function deleteNoteKind(slug: string): Promise<void> {
  const db = getDb();
  const result = await db.execute(
    sql`SELECT is_system_default FROM note_kinds WHERE slug = ${slug}`,
  );
  const existing = (result as unknown as Array<{ is_system_default: boolean }>)[0];
  if (!existing) err(`NoteKind '${slug}' not found`, 404, 'not_found');
  if (existing.is_system_default) {
    err(`Cannot delete system-default NoteKind '${slug}'`, 409, 'system_default_protected');
  }

  const deleted = await db.execute(
    sql`DELETE FROM note_kinds
        WHERE slug = ${slug}
          AND NOT EXISTS (
            SELECT 1 FROM notes WHERE taxonomy = ${slug} AND deleted_at IS NULL
          )
        RETURNING slug`,
  );
  if ((deleted as unknown as unknown[]).length === 0) {
    err(`Cannot delete NoteKind '${slug}': active notes are still attached`, 409, 'notes_attached');
  }
}
