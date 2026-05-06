/**
 * wiki-recent.ts — wiki.recent tool handler
 *
 * Returns recently updated notes in a workspace, newest first.
 * RBAC: evaluatePolicy(ctx, { resource: 'page', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'notes') applied to query.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq, desc, sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

const WikiRecentInputSchema = z.object({
  workspaceId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(10),
});

const WikiRecentOutputSchema = z.object({
  notes: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      taxonomy: z.string(),
      updatedAt: z.string(),
    }),
  ),
});

async function wikiRecentHandler(
  input: z.infer<typeof WikiRecentInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof WikiRecentOutputSchema>> {
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'wiki.recent');

  const db = getDb();
  const scopeFilter = compileScopeFilter(ctx, 'notes');

  const rows = await db
    .select({
      slug: schema.notes.slug,
      title: schema.notes.title,
      taxonomy: schema.notes.taxonomy,
      updatedAt: schema.notes.updatedAt,
    })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.workspaceId, input.workspaceId),
        sql`${schema.notes.deletedAt} IS NULL`,
        scopeFilter,
      ),
    )
    .orderBy(desc(schema.notes.updatedAt))
    .limit(input.limit);

  return WikiRecentOutputSchema.parse({ notes: rows });
}

export function buildWikiRecentTool(ctx: AuthContext) {
  return defineTool({
    name: 'wiki.recent',
    description:
      'Return the most recently updated notes in a workspace. ' +
      'Useful for surfacing recent activity or changes.',
    inputSchema: WikiRecentInputSchema,
    handler: (input) => wikiRecentHandler(input, ctx).catch((err) => wrapToolError(err, 'wiki.recent')),
  });
}
