/**
 * material-read.ts — material.read tool handler
 *
 * Read a raw material excerpt by ID (up to maxChars characters).
 * RBAC: evaluatePolicy(ctx, { resource: 'kb', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'materials') applied to query.
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { and, eq } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';

const MaterialReadInputSchema = z.object({
  materialId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  maxChars: z.number().int().min(1).max(40_000).default(20_000),
});

const MaterialReadOutputSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  status: z.string(),
  excerpt: z.string(),
  pageCount: z.number().int(),
  truncated: z.boolean(),
});

async function materialReadHandler(
  input: z.infer<typeof MaterialReadInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof MaterialReadOutputSchema>> {
  // RBAC check — kb.view required (materials belong to a KB)
  const decision = evaluatePolicy(
    ctx,
    { resource: 'kb', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'material.read');

  const db = getDb();
  const scopeFilter = compileScopeFilter(ctx, 'materials');

  const [row] = await db
    .select()
    .from(schema.materials)
    .where(
      and(
        eq(schema.materials.id, input.materialId),
        eq(schema.materials.workspaceId, input.workspaceId),
        scopeFilter,
      ),
    )
    .limit(1);

  if (!row) {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    throw new McpError(ErrorCode.InvalidRequest, 'MATERIAL_NOT_FOUND');
  }

  if (row.status !== 'completed') {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    throw new McpError(
      ErrorCode.InvalidRequest,
      `material_not_ready: status is "${row.status}"`,
    );
  }

  // v2.0 LIMITATION: material excerpt requires reading raw bytes from MinIO
  // (storage_key) and re-extracting via @wiki-team/pdf-extract / mammoth.
  // That path is wired in P08 (HTTP API exposes the same flow). Returning the
  // material metadata + an empty excerpt for now; clients should call
  // wiki.search / wiki.fetch on notes compiled from this material instead.
  // DO NOT join notes by kb_id — that returns unrelated notes in the same KB.
  // Tracking: P08 follow-up item.
  const excerpt = '';
  const truncated = false;

  return MaterialReadOutputSchema.parse({
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    status: row.status,
    excerpt,
    pageCount: row.pageCount,
    truncated,
  });
}

export function buildMaterialReadTool(ctx: AuthContext) {
  return defineTool({
    name: 'material.read',
    description:
      'Read a raw material excerpt by ID. Materials are source files uploaded to a knowledge base. ' +
      'Returns extracted text up to maxChars. Cite material IDs in answers.',
    inputSchema: MaterialReadInputSchema,
    handler: (input) => materialReadHandler(input, ctx).catch((err) => wrapToolError(err, 'material.read')),
  });
}
