/**
 * get-source-outline.ts — material.get_source_outline MCP tool (P07)
 *
 * Returns a heading-based outline tree extracted from a material's text content.
 * Loads raw bytes from MinIO, extracts text per MIME type, then parses the outline.
 *
 * RBAC: evaluatePolicy(ctx, { resource: 'kb', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'materials') applied to query.
 *
 * Errors: MATERIAL_NOT_FOUND, SCOPE_DENIED, MATERIAL_NOT_READY, MIME_NOT_SUPPORTED
 *
 * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 */

import { z } from 'zod';
import { defineTool } from '@wiki-team/mcp/define-tool';
import { evaluatePolicy, compileScopeFilter } from '../../rbac/index.js';
import { throwIfDenied, wrapToolError } from '@wiki-team/mcp/error-mapper';
import { getDb, schema } from '../../storage/db.js';
import { getObjectStore } from '../../storage/object-store.js';
import { extractPdfText } from '@wiki-team/pdf-extract';
import { and, eq } from 'drizzle-orm';
import type { AuthContext } from '../../auth/auth-context.js';
import { extractOutline } from '../../services/source-outline-service.js';
import type { OutlineNode } from '../../services/source-outline-service.js';

// ---------------------------------------------------------------------------
// Schemas

const GetSourceOutlineInputSchema = z.object({
  materialId: z.string().uuid(),
  workspaceId: z.string().uuid(),
});

const OutlineNodeSchema: z.ZodType<OutlineNode> = z.lazy(() =>
  z.object({
    level: z.number().int().min(1).max(6),
    text: z.string(),
    charOffset: z.number().int(),
    pageNumber: z.number().int().nullable(),
    children: z.array(OutlineNodeSchema),
  }),
);

const GetSourceOutlineOutputSchema = z.object({
  outline: z.array(OutlineNodeSchema),
  materialId: z.string().uuid(),
  fileName: z.string(),
});

// ---------------------------------------------------------------------------
// Text extraction helper — reuses the same mime-type logic as material.read

async function extractTextFromBuffer(buf: Buffer, mimeType: string): Promise<string> {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    return buf.toString('utf-8');
  }

  if (mimeType === 'application/pdf') {
    return extractPdfText(buf);
  }

  if (mimeType === 'text/html') {
    return buf
      .toString('utf-8')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
  throw new McpError(
    ErrorCode.InvalidRequest,
    `MIME_NOT_SUPPORTED: get_source_outline supports text/plain, text/markdown, application/pdf, text/html. Got "${mimeType}".`,
  );
}

// ---------------------------------------------------------------------------
// Handler

async function getSourceOutlineHandler(
  input: z.infer<typeof GetSourceOutlineInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof GetSourceOutlineOutputSchema>> {
  // RBAC check — kb.view required
  const decision = evaluatePolicy(
    ctx,
    { resource: 'kb', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'material.get_source_outline');

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
      `MATERIAL_NOT_READY: status is "${row.status}"`,
    );
  }

  const store = getObjectStore();
  const buf = await store.download(row.storageKey);
  const text = await extractTextFromBuffer(buf, row.mimeType);
  const outline = extractOutline(text);

  return GetSourceOutlineOutputSchema.parse({
    outline,
    materialId: row.id,
    fileName: row.fileName,
  });
}

// ---------------------------------------------------------------------------
// Tool export

export function buildGetSourceOutlineTool(ctx: AuthContext) {
  return defineTool({
    name: 'material.get_source_outline',
    description:
      'Extract a heading-based outline tree from a source material (PDF, text, markdown, HTML). ' +
      'Returns a nested tree of OutlineNode entries with level (1–6), text, charOffset, and children. ' +
      'Use to navigate large documents before fetching specific page ranges via material.get_source_pages.',
    inputSchema: GetSourceOutlineInputSchema,
    handler: (input) =>
      getSourceOutlineHandler(input, ctx).catch((err) =>
        wrapToolError(err, 'material.get_source_outline'),
      ),
  });
}
