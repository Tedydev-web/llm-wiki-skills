/**
 * wiki-fetch.ts — wiki.fetch tool handler
 *
 * Read full note by slug. Returns content, version, tags, outbound links.
 * RBAC: evaluatePolicy(ctx, { resource: 'page', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'notes') applied to WHERE clause.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq, sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

const WikiFetchInputSchema = z.object({
  slug: z.string().min(1).max(120),
  workspaceId: z.string().uuid(),
  version: z.number().int().min(1).optional(),
});

const WikiFetchOutputSchema = z.object({
  slug: z.string(),
  title: z.string(),
  content: z.string(),
  version: z.number().int(),
  tags: z.array(z.string()),
  links: z.array(z.string()),
  taxonomy: z.string(),
  updatedAt: z.string(),
});

async function wikiFetchHandler(
  input: z.infer<typeof WikiFetchInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof WikiFetchOutputSchema>> {
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'wiki.fetch');

  const db = getDb();
  const scopeFilter = compileScopeFilter(ctx, 'notes');

  const [row] = await db
    .select()
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.slug, input.slug),
        eq(schema.notes.workspaceId, input.workspaceId),
        sql`${schema.notes.deletedAt} IS NULL`,
        scopeFilter,
      ),
    )
    .limit(1);

  if (!row) {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    throw new McpError(ErrorCode.InvalidRequest, 'PAGE_NOT_FOUND');
  }

  if (input.version !== undefined && row.version !== input.version) {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    throw new McpError(ErrorCode.InvalidRequest, 'VERSION_NOT_FOUND');
  }

  return WikiFetchOutputSchema.parse({
    slug: row.slug,
    title: row.title,
    content: row.content,
    version: row.version,
    tags: row.tags,
    links: row.links,
    taxonomy: row.taxonomy,
    updatedAt: row.updatedAt,
  });
}

export function buildWikiFetchTool(ctx: AuthContext) {
  return defineTool({
    name: 'wiki.fetch',
    description:
      'Read the full content of a wiki note by slug. ' +
      'Use wiki.search first; call this only when the excerpt is insufficient.',
    inputSchema: WikiFetchInputSchema,
    handler: (input) => wikiFetchHandler(input, ctx).catch((err) => wrapToolError(err, 'wiki.fetch')),
  });
}
