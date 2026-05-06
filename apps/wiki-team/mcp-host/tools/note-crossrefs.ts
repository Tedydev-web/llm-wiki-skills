/**
 * note-crossrefs.ts — note.crossrefs tool handler
 *
 * Returns outbound cross-references (wikilinks) for a note.
 * For each outbound slug, resolves title + taxonomy if visible to caller.
 *
 * RBAC: evaluatePolicy(ctx, { resource: 'page', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'notes') applied when resolving link targets.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

const NoteCrossrefsInputSchema = z.object({
  slug: z.string().min(1).max(120),
  workspaceId: z.string().uuid(),
});

const CrossrefSchema = z.object({
  slug: z.string(),
  title: z.string().nullable(),   // null if target not visible to caller
  taxonomy: z.string().nullable(),
  accessible: z.boolean(),
});

const NoteCrossrefsOutputSchema = z.object({
  sourceSlug: z.string(),
  crossrefs: z.array(CrossrefSchema),
  total: z.number().int(),
});

async function noteCrossrefsHandler(
  input: z.infer<typeof NoteCrossrefsInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof NoteCrossrefsOutputSchema>> {
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'note.crossrefs');

  const db = getDb();
  const scopeFilter = compileScopeFilter(ctx, 'notes');

  // Fetch the source note to get its links array
  const [sourceNote] = await db
    .select({ links: schema.notes.links })
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

  if (!sourceNote) {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    throw new McpError(ErrorCode.InvalidRequest, 'NOTE_NOT_FOUND');
  }

  // Drizzle types `links` (jsonb) as unknown; we ship string[] per schema invariant.
  const outboundSlugs = (sourceNote.links as string[] | null) ?? [];

  if (outboundSlugs.length === 0) {
    return NoteCrossrefsOutputSchema.parse({
      sourceSlug: input.slug,
      crossrefs: [],
      total: 0,
    });
  }

  // Resolve visible targets (apply scope filter so caller only sees accessible targets)
  const visibleTargets = await db
    .select({
      slug: schema.notes.slug,
      title: schema.notes.title,
      taxonomy: schema.notes.taxonomy,
    })
    .from(schema.notes)
    .where(
      and(
        eq(schema.notes.workspaceId, input.workspaceId),
        inArray(schema.notes.slug, outboundSlugs),
        sql`${schema.notes.deletedAt} IS NULL`,
        scopeFilter,
      ),
    );

  const visibleBySlug = new Map(visibleTargets.map((t) => [t.slug, t]));

  // Build crossrefs list preserving original link order
  const crossrefs = outboundSlugs.map((slug) => {
    const target = visibleBySlug.get(slug);
    return CrossrefSchema.parse({
      slug,
      title: target?.title ?? null,
      taxonomy: target?.taxonomy ?? null,
      accessible: target !== undefined,
    });
  });

  return NoteCrossrefsOutputSchema.parse({
    sourceSlug: input.slug,
    crossrefs,
    total: outboundSlugs.length,
  });
}

export function buildNoteCrossrefsTool(ctx: AuthContext) {
  return defineTool({
    name: 'note.crossrefs',
    description:
      'List outbound cross-references (wikilinks) from a note. ' +
      'Returns each linked slug with title and taxonomy when accessible. ' +
      'Use to traverse the knowledge graph between related notes.',
    inputSchema: NoteCrossrefsInputSchema,
    handler: (input) =>
      noteCrossrefsHandler(input, ctx).catch((err) => wrapToolError(err, 'note.crossrefs')),
  });
}
