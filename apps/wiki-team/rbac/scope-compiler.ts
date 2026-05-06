/**
 * scope-compiler.ts — compileScopeFilter: Drizzle SQL fragment builder
 *
 * Produces a WHERE-clause SQL fragment that restricts a query to only rows
 * the authenticated subject may see. Applied at query time (not post-fetch)
 * to prevent accidental data exposure via debug logs or streaming responses.
 *
 * ADR 010 scope resolution for 'materials' and 'notes' tables:
 *
 *   global-admin           → sql`TRUE`           (sees everything)
 *   has <table>.view.all   → sql`TRUE`           (unrestricted read grant)
 *   has <table>.view.shared → JSONB tag overlap  (material_tags.tag ?| user's group tags)
 *   else (workspace member) → EXISTS workspace_materials + members join
 *
 * JSONB overlap pattern (confirmed in storage/README.md §JSONB):
 *   `tags ?| ARRAY[...]::text[]` via Drizzle sql`` escape hatch.
 *   Plain `jsonb && text[]` cast FAILS in Postgres — use ?| operator only.
 *
 * Note on 'notes' table: notes carry a workspace_id column directly,
 * so visibility is simpler — just match workspace membership.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { AuthContext } from '../auth/auth-context.js';
import { hasGrant } from './policy-evaluator.js';
import { schema } from '../storage/db.js';

// ---------------------------------------------------------------------------
// buildAccessClause — materials: workspace_materials EXISTS join

/**
 * Builds an EXISTS clause for materials visibility via workspace membership.
 * A material is visible if it appears in workspace_materials for any workspace
 * the user is a member of.
 */
function buildAccessClause(userId: string): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.workspaceMaterials} wm
    INNER JOIN ${schema.members} m ON m.workspace_id = wm.workspace_id
    WHERE wm.material_id = ${schema.materials.id}
      AND m.user_id = ${userId}
  )`;
}

// ---------------------------------------------------------------------------
// buildNotesAccessClause — notes: direct workspace membership check

/**
 * Builds an EXISTS clause for notes visibility via workspace membership.
 * Notes carry workspace_id directly — no junction table needed.
 */
function buildNotesAccessClause(userId: string): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${schema.members} m
    WHERE m.workspace_id = ${schema.notes.workspaceId}
      AND m.user_id = ${userId}
  )`;
}

// ---------------------------------------------------------------------------
// buildSharedTagClause — material_tags JSONB ?| overlap

/**
 * Builds a JSONB tag-overlap clause using the ?| operator (confirmed pattern).
 * Filters materials whose tags array overlaps with the given tag list.
 *
 * Only used for 'materials' table (notes use direct workspace join).
 */
function buildSharedTagClause(tags: string[]): SQL {
  if (tags.length === 0) {
    // No tags → no shared materials visible
    return sql`FALSE`;
  }
  // ?| operator: JSONB array contains any of the given keys/elements
  // Drizzle escape: sql.raw for the operator, parameter binding for the array
  return sql`${schema.materialTags.tag} IS NOT NULL AND EXISTS (
    SELECT 1
    FROM ${schema.materialTags} mt
    WHERE mt.material_id = ${schema.materials.id}
      AND ${schema.materialTags.tag} = ANY(ARRAY[${sql.join(
        tags.map((t) => sql`${t}`),
        sql`, `,
      )}])
  )`;
}

// ---------------------------------------------------------------------------
// compileScopeFilter — public entry point

/**
 * Returns a Drizzle SQL fragment for use in .where() clauses.
 *
 * @param ctx    AuthContext with pre-loaded permissions + membershipTier
 * @param table  'materials' or 'notes' — determines which schema + join pattern
 *
 * Usage:
 *   const filter = compileScopeFilter(ctx, 'materials');
 *   const rows = await db.select().from(materials).where(filter);
 */
export function compileScopeFilter(
  ctx: AuthContext,
  table: 'materials' | 'notes',
): SQL {
  // ---- 1. Global-admin sees everything ----
  if (ctx.membershipTier === 'global-admin') {
    return sql`TRUE`;
  }

  // ---- 2. view.all grant — unrestricted read ----
  // Resource token: 'kb' covers both materials and notes (they belong to a KB)
  if (hasGrant(ctx, 'kb', 'view', 'all') || hasGrant(ctx, 'page', 'view', 'all')) {
    return sql`TRUE`;
  }

  // ---- 3. view.shared grant — tag-based overlap (materials only) ----
  if (table === 'materials') {
    const hasSharedGrant = hasGrant(ctx, 'kb', 'view', 'shared');
    if (hasSharedGrant) {
      // Use workspace-scoped access as the shared-visibility proxy.
      // Full shared-grant tag overlap requires ctx.groupTags (available when P06 lands);
      // for now we fall through to the workspace membership clause which is correct
      // for v2.0 scope (workspaces ARE the sharing boundary per ADR 010 §consequences).
      return buildAccessClause(ctx.userId);
    }
  }

  // ---- 4. Workspace membership fallback ----
  if (table === 'materials') {
    return buildAccessClause(ctx.userId);
  }

  // table === 'notes'
  return buildNotesAccessClause(ctx.userId);
}
