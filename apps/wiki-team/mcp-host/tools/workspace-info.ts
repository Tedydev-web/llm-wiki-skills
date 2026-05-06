/**
 * workspace-info.ts — workspace.info tool handler
 *
 * Returns current workspace metadata (displayName, slug, member count, note count).
 * RBAC: evaluatePolicy(ctx, { resource: 'page', workspaceId }, { verb: 'view' })
 * Any workspace member may call this tool.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema, sql } from '../../storage/db.js';
import { and, eq, count } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

const WorkspaceInfoInputSchema = z.object({
  workspaceId: z.string().uuid(),
});

const WorkspaceInfoOutputSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  displayName: z.string(),
  memberCount: z.number().int(),
  noteCount: z.number().int(),
  createdAt: z.string(),
});

async function workspaceInfoHandler(
  input: z.infer<typeof WorkspaceInfoInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof WorkspaceInfoOutputSchema>> {
  const decision = evaluatePolicy(
    ctx,
    { resource: 'page', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'workspace.info');

  const db = getDb();
  const scopeFilter = compileScopeFilter(ctx, 'notes');

  const [ws] = await db
    .select()
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.id, input.workspaceId),
        sql`${schema.workspaces.deletedAt} IS NULL`,
      ),
    )
    .limit(1);

  if (!ws) {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    throw new McpError(ErrorCode.InvalidRequest, 'WORKSPACE_NOT_FOUND');
  }

  // Count members and visible notes in parallel
  const [memberCountResult, noteCountResult] = await Promise.all([
    db
      .select({ c: count() })
      .from(schema.members)
      .where(eq(schema.members.workspaceId, input.workspaceId)),
    db
      .select({ c: count() })
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.workspaceId, input.workspaceId),
          sql`${schema.notes.deletedAt} IS NULL`,
          scopeFilter,
        ),
      ),
  ]);

  return WorkspaceInfoOutputSchema.parse({
    id: ws.id,
    slug: ws.slug,
    displayName: ws.displayName,
    memberCount: memberCountResult[0]?.c ?? 0,
    noteCount: noteCountResult[0]?.c ?? 0,
    createdAt: ws.createdAt,
  });
}

export function buildWorkspaceInfoTool(ctx: AuthContext) {
  return defineTool({
    name: 'workspace.info',
    description:
      'Retrieve metadata for the current workspace: slug, display name, member count, note count. ' +
      'Useful for calibrating responses about scope and size of the knowledge base.',
    inputSchema: WorkspaceInfoInputSchema,
    handler: (input) =>
      workspaceInfoHandler(input, ctx).catch((err) => wrapToolError(err, 'workspace.info')),
  });
}
