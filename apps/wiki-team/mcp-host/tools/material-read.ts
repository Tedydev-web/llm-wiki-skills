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
import { getObjectStore } from '../../storage/object-store.js';
import { extractPdfText } from '@wiki-team/pdf-extract';
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

  // v2.0.1: read raw bytes from MinIO and extract text per mime type.
  // - text/plain, text/markdown: decode UTF-8 directly
  // - application/pdf: @wiki-team/pdf-extract (mupdf-bound, AGPL boundary)
  // - text/html: simple strip (HTML preserved as-is for now; full readability
  //   is in jobs/wiki-compile/extractors/url-extractor.ts but that path
  //   pulls jsdom + readability which is heavy for an MCP tool call)
  // - other (DOCX, etc.): MIME_NOT_SUPPORTED — caller should use wiki.search
  //   on notes compiled from the material instead
  const store = getObjectStore();
  const buf = await store.download(row.storageKey);
  let fullText: string;
  if (row.mimeType === 'text/plain' || row.mimeType === 'text/markdown') {
    fullText = buf.toString('utf-8');
  } else if (row.mimeType === 'application/pdf') {
    fullText = await extractPdfText(buf);
  } else if (row.mimeType === 'text/html') {
    // Lightweight HTML strip: remove tags + decode common entities.
    // Full extraction (readability) belongs in the compile worker, not here.
    fullText = buf
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
  } else {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    throw new McpError(
      ErrorCode.InvalidRequest,
      `MIME_NOT_SUPPORTED: material.read v2.0 supports text/plain, text/markdown, application/pdf, text/html. ` +
      `Got "${row.mimeType}". Use wiki.search/wiki.fetch on notes compiled from this material instead.`,
    );
  }
  const excerpt = fullText.slice(0, input.maxChars);
  const truncated = fullText.length > input.maxChars;

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
