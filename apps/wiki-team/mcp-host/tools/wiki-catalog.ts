/**
 * wiki-catalog.ts — wiki.catalog tool handler
 *
 * Paginated list of all accessible notes in a workspace.
 * RBAC: evaluatePolicy(ctx, { resource: 'page', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'notes') restricts to caller-visible rows.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq, gt, sql, asc } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

const WikiCatalogInputSchema = z.object({
  workspaceId: z.string().uuid(),
  cursor: z.string().optional(),   // slug of last item from previous page
  limit: z.number().int().min(1).max(100).default(50),
});

const WikiCatalogOutputSchema = z.object({
  notes: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      taxonomy: z.string(),
      updatedAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});

async function wikiCatalogHandler(
  input: z.infer<typeof WikiCatalogInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof WikiCatalogOutputSchema>> {
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'wiki.catalog');

  const db = getDb();
  const scopeFilter = compileScopeFilter(ctx, 'notes');

  const baseWhere = and(
    eq(schema.notes.workspaceId, input.workspaceId),
    sql`${schema.notes.deletedAt} IS NULL`,
    scopeFilter,
  );

  // Cursor-based pagination (keyset on slug — stable, index-friendly)
  const pageWhere = input.cursor
    ? and(baseWhere, gt(schema.notes.slug, input.cursor))
    : baseWhere;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        slug: schema.notes.slug,
        title: schema.notes.title,
        taxonomy: schema.notes.taxonomy,
        updatedAt: schema.notes.updatedAt,
      })
      .from(schema.notes)
      .where(pageWhere)
      .orderBy(asc(schema.notes.slug))
      .limit(input.limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.notes)
      .where(baseWhere),
  ]);

  const nextCursor =
    rows.length === input.limit ? (rows[rows.length - 1]?.slug ?? null) : null;

  return WikiCatalogOutputSchema.parse({
    notes: rows,
    nextCursor,
    total: count,
  });
}

export function buildWikiCatalogTool(ctx: AuthContext) {
  return defineTool({
    name: 'wiki.catalog',
    description:
      'List all accessible notes in a workspace with pagination. ' +
      'Returns slug, title, taxonomy, updatedAt. Use cursor for subsequent pages.',
    inputSchema: WikiCatalogInputSchema,
    handler: (input) => wikiCatalogHandler(input, ctx).catch((err) => wrapToolError(err, 'wiki.catalog')),
  });
}
