/**
 * list-knowledge-types.ts — wiki.list_knowledge_types MCP tool (ADR 014 / P02)
 *
 * Returns all NoteKind entries visible to the caller in a given workspace.
 * RBAC: evaluatePolicy(ctx, { resource: 'kb', workspaceId }, { verb: 'view' })
 *
 * Output: [{ slug, label, color, description }]
 * Limit: capped at 50 kinds (practical ceiling per ADR 014 §constraints).
 *
  * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 * surface requirement (user-facing tool name, not internal class name).
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb } from '../../storage/db.js';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

// ---------------------------------------------------------------------------
// Schemas

const ListKnowledgeTypesInputSchema = z.object({
  workspaceId: z.string().uuid(),
});

const KindItemSchema = z.object({
  slug: z.string(),
  label: z.string(),
  color: z.string(),
  description: z.string().nullable(),
});

const ListKnowledgeTypesOutputSchema = z.object({
  kinds: z.array(KindItemSchema),
  total: z.number().int(),
});

// ---------------------------------------------------------------------------
// Types

interface RawKindRow {
  slug: string;
  display_name: string;
  color: string;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Handler

async function listKnowledgeTypesHandler(
  input: z.infer<typeof ListKnowledgeTypesInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof ListKnowledgeTypesOutputSchema>> {
  // RBAC: caller must have kb.view on the workspace
  const decision = evaluatePolicy(
    ctx,
    { resource: 'kb', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'wiki.list_knowledge_types');

  const db = getDb();

  // Raw SQL: color + description added by migration 0005 (schema.ts merge pending coordinator)
  const result = await db.execute(
    sql`SELECT slug, display_name, color, description
        FROM note_kinds
        ORDER BY slug
        LIMIT 50`,
  );

  // Drizzle execute() returns RowList which is directly iterable (not .rows)
  const rows = result as unknown as RawKindRow[];

  const kinds = rows.map((r) => ({
    slug: r.slug,
    label: r.display_name,
    color: r.color ?? '#6b7280',
    description: r.description ?? null,
  }));

  return ListKnowledgeTypesOutputSchema.parse({ kinds, total: kinds.length });
}

// ---------------------------------------------------------------------------
// Tool export

export function buildListKnowledgeTypesTool(ctx: AuthContext) {
  return defineTool({
    name: 'wiki.list_knowledge_types',
    description:
      'List all NoteKind taxonomy entries available in the workspace. ' +
      'Returns slug, label, color, and description for each kind. ' +
      'Use this to discover valid taxonomy values before creating or filtering notes.',
    inputSchema: ListKnowledgeTypesInputSchema,
    handler: (input) =>
      listKnowledgeTypesHandler(input, ctx).catch((err) =>
        wrapToolError(err, 'wiki.list_knowledge_types'),
      ),
  });
}
