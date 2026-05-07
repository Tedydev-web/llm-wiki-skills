/**
 * get-knowledge-type-docs.ts — wiki.get_knowledge_type_docs MCP tool (ADR 014 / P02)
 *
 * Returns paginated notes belonging to a specific NoteKind (taxonomy slug).
 * RBAC: evaluatePolicy(ctx, { resource: 'kb', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'notes') applied to restrict to caller-visible rows.
 *
 * Output: [{ slug, title, excerpt, kind }]
 * Default limit: 25; max: 50.
 *
  * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq, isNull } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

// ---------------------------------------------------------------------------
// Schemas

const GetKnowledgeTypeDocsInputSchema = z.object({
  workspaceId: z.string().uuid(),
  kindSlug: z.string().min(1).max(32),
  limit: z.number().int().min(1).max(50).default(25),
  offset: z.number().int().min(0).default(0),
});

const NoteExcerptSchema = z.object({
  slug: z.string(),
  title: z.string(),
  excerpt: z.string(),
  kind: z.string(),
});

const GetKnowledgeTypeDocsOutputSchema = z.object({
  docs: z.array(NoteExcerptSchema),
  total: z.number().int(),
  kindSlug: z.string(),
  hasMore: z.boolean(),
});

// ---------------------------------------------------------------------------
// Handler

async function getKnowledgeTypeDocsHandler(
  input: z.infer<typeof GetKnowledgeTypeDocsInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof GetKnowledgeTypeDocsOutputSchema>> {
  // RBAC check — must precede any DB read
  const decision = evaluatePolicy(
    ctx,
    { resource: 'kb', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'wiki.get_knowledge_type_docs');

  const db = getDb();
  // Scope filter restricts to rows caller can see (workspace membership)
  const scopeFilter = compileScopeFilter(ctx, 'notes');

  const baseWhere = and(
    eq(schema.notes.workspaceId, input.workspaceId),
    eq(schema.notes.taxonomy, input.kindSlug),
    isNull(schema.notes.deletedAt),
    scopeFilter,
  );

  // Fetch page + total in parallel
  const [rows, countResult] = await Promise.all([
    db
      .select({
        slug: schema.notes.slug,
        title: schema.notes.title,
        content: schema.notes.content,
        taxonomy: schema.notes.taxonomy,
      })
      .from(schema.notes)
      .where(baseWhere)
      .orderBy(schema.notes.updatedAt)
      .limit(input.limit)
      .offset(input.offset),

    db
      .select({ count: schema.notes.id })
      .from(schema.notes)
      .where(baseWhere),
  ]);

  const total = countResult.length;
  const hasMore = input.offset + rows.length < total;

  const docs = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    excerpt: (r.content ?? '').slice(0, 300),
    kind: r.taxonomy,
  }));

  return GetKnowledgeTypeDocsOutputSchema.parse({
    docs,
    total,
    kindSlug: input.kindSlug,
    hasMore,
  });
}

// ---------------------------------------------------------------------------
// Tool export

export function buildGetKnowledgeTypeDocsTool(ctx: AuthContext) {
  return defineTool({
    name: 'wiki.get_knowledge_type_docs',
    description:
      'Get notes belonging to a specific NoteKind taxonomy slug in a workspace. ' +
      'Returns slug, title, excerpt (first 300 chars), and kind for each note. ' +
      'Supports offset-based pagination via limit and offset parameters. ' +
      'Use wiki.list_knowledge_types first to discover available kind slugs.',
    inputSchema: GetKnowledgeTypeDocsInputSchema,
    handler: (input) =>
      getKnowledgeTypeDocsHandler(input, ctx).catch((err) =>
        wrapToolError(err, 'wiki.get_knowledge_type_docs'),
      ),
  });
}
