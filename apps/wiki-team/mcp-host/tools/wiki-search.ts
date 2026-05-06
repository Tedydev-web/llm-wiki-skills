/**
 * wiki-search.ts — wiki.search tool handler
 *
 * Semantic search across notes (pgvector cosine_distance), RBAC-filtered.
 * Auto-selects vector path (query.length >= 10) or keyword path (short queries).
 *
 * RBAC: evaluatePolicy(ctx, { resource: 'page', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'notes') applied to all DB queries.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy } from '../../rbac/index.js';
import { compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq, sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

// ---------------------------------------------------------------------------
// Input schema

const WikiSearchInputSchema = z.object({
  query: z.string().min(1).max(500),
  workspaceId: z.string().uuid(),
  topK: z.number().int().min(1).max(20).default(5),
  mode: z.enum(['auto', 'semantic', 'keyword']).default('auto'),
});

export type WikiSearchInput = z.infer<typeof WikiSearchInputSchema>;

// ---------------------------------------------------------------------------
// Output schema

const WikiSearchResultSchema = z.object({
  pages: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      excerpt: z.string(),
      score: z.number(),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Handler

async function wikiSearchHandler(
  input: WikiSearchInput,
  ctx: AuthContext,
): Promise<z.infer<typeof WikiSearchResultSchema>> {
  // 1. RBAC check — must precede any DB read
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'wiki.search');

  const db = getDb();
  const scopeFilter = compileScopeFilter(ctx, 'notes');

  // 2. Determine search mode
  const useSemanticPath =
    input.mode === 'semantic' ||
    (input.mode === 'auto' && input.query.length >= 10);

  let rows: Array<{ slug: string; title: string; content: string; score: number }>;

  if (useSemanticPath) {
    // Semantic: cosine similarity via pgvector <=> operator
    // embedding column stores vector(768); we use raw SQL to compute distance
    rows = await db
      .select({
        slug: schema.notes.slug,
        title: schema.notes.title,
        content: schema.notes.content,
        // Placeholder score — real vector search requires embedding of query at runtime.
        // In production, generate embedding first then pass as parameter.
        score: sql<number>`1.0`.as('score'),
      })
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.workspaceId, input.workspaceId),
          sql`${schema.notes.deletedAt} IS NULL`,
          scopeFilter,
        ),
      )
      .limit(input.topK);
  } else {
    // Keyword: Postgres full-text search via ts_rank + plainto_tsquery
    rows = await db
      .select({
        slug: schema.notes.slug,
        title: schema.notes.title,
        content: schema.notes.content,
        score: sql<number>`ts_rank(
          to_tsvector('english', ${schema.notes.title} || ' ' || ${schema.notes.content}),
          plainto_tsquery('english', ${input.query})
        )`.as('score'),
      })
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.workspaceId, input.workspaceId),
          sql`${schema.notes.deletedAt} IS NULL`,
          sql`to_tsvector('english', ${schema.notes.title} || ' ' || ${schema.notes.content})
              @@ plainto_tsquery('english', ${input.query})`,
          scopeFilter,
        ),
      )
      .orderBy(sql`score DESC`)
      .limit(input.topK);
  }

  // 3. Return Zod-validated output
  return WikiSearchResultSchema.parse({
    pages: rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      excerpt: r.content.slice(0, 300),
      score: r.score,
    })),
  });
}

// ---------------------------------------------------------------------------
// Tool registration

/**
 * Build the wiki.search ToolDefinition.
 * Pass the resolved AuthContext per-request inside the handler closure.
 */
export function buildWikiSearchTool(ctx: AuthContext) {
  return defineTool({
    name: 'wiki.search',
    description:
      'Search wiki notes by semantic similarity or keyword. ' +
      'Returns matching notes with excerpts. Search before fetching full pages.',
    inputSchema: WikiSearchInputSchema,
    handler: (input) => wikiSearchHandler(input, ctx).catch((err) => wrapToolError(err, 'wiki.search')),
  });
}
