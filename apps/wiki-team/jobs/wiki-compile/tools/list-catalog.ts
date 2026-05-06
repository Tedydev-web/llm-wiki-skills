/**
 * list-catalog.ts — listCatalog tool: read the __catalog sentinel page
 *
 * The __catalog page is the agent's index of all notes in a workspace/KB.
 * It is rebuilt by rebuildCatalog() after each compile run (agent-loop.ts).
 * Reading it gives the agent an overview of existing notes before writing.
 *
 * RBAC gate: page.view (any scope) — evaluated before DB access.
 */

import { z } from 'zod';
import { evaluatePolicy } from '../../../rbac/index.js';
import type { AuthContext } from '../../../auth/auth-context.js';
import { getDb, schema } from '../../../storage/db.js';
import { eq, and, isNull } from 'drizzle-orm';
import { SENTINEL_CATALOG } from '../slug-rules.js';

// ---------------------------------------------------------------------------
// Input / output schemas

export const listCatalogInputSchema = z.object({
  workspaceId: z.string().uuid(),
  kbId: z.string().uuid(),
});

export type ListCatalogInput = z.infer<typeof listCatalogInputSchema>;

export const listCatalogOutputSchema = z.object({
  content: z.string(),
  /** ISO datetime of last catalog rebuild */
  updatedAt: z.string().datetime(),
  /** True if the catalog page does not yet exist (first compile) */
  empty: z.boolean(),
});

export type ListCatalogOutput = z.infer<typeof listCatalogOutputSchema>;

// ---------------------------------------------------------------------------
// Tool handler

/**
 * Fetch the __catalog sentinel page for a workspace/KB.
 * Returns empty=true with placeholder content if the page has never been built.
 *
 * @param ctx    AuthContext of the requesting job (carries permissions + workspace binding)
 * @param input  Validated listCatalog input
 */
export async function handleListCatalog(
  ctx: AuthContext,
  input: ListCatalogInput,
): Promise<ListCatalogOutput> {
  // RBAC gate — must be able to view pages in this workspace
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
        eq(schema.notes.slug, SENTINEL_CATALOG),
        isNull(schema.notes.deletedAt),
      ),
    )
    .limit(1);

  if (rows.length === 0) {
    return {
      content: '(catalog not yet built — this is the first compile run for this KB)',
      updatedAt: new Date().toISOString(),
      empty: true,
    };
  }

  const row = rows[0]!;
  return {
    content: row.content,
    updatedAt: row.updatedAt.toISOString(),
    empty: false,
  };
}
