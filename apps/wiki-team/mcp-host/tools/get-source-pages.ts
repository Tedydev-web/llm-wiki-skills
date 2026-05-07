/**
 * get-source-pages.ts — material.get_source_pages MCP tool (P07)
 *
 * Returns text content for specific page ranges of a source material.
 * For PDF: returns per-page text extracted via MuPDF.
 * For non-PDF (text/plain, text/markdown, text/html): single page = full text.
 *
 * pageRange format: "5", "5-7", "5,7,9", "1-3,7,10-12" (mixed forms).
 * DoS guard: rejects if resolved page count > 100 (PAGE_RANGE_TOO_LARGE).
 * Reverse range guard: rejects if start > end in any segment (PAGE_RANGE_INVALID).
 *
 * RBAC: evaluatePolicy(ctx, { resource: 'kb', workspaceId }, { verb: 'view' })
 * Scope: compileScopeFilter(ctx, 'materials') applied to query.
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

// ---------------------------------------------------------------------------
// Constants

/** Hard cap on pages per request — DoS guard */
const MAX_PAGES_PER_REQUEST = 100;

/** Max bytes per page response — truncation guard */
const MAX_BYTES_PER_PAGE = 50_000;

// ---------------------------------------------------------------------------
// Schemas

const GetSourcePagesInputSchema = z.object({
  materialId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  /** Supports: "5", "5-7", "5,7,9", "1-3,7,10-12" */
  pageRange: z.string().min(1).max(200),
});

const PageResultSchema = z.object({
  pageNumber: z.number().int(),
  text: z.string(),
  truncated: z.boolean(),
});

const GetSourcePagesOutputSchema = z.object({
  pages: z.array(PageResultSchema),
  totalPages: z.number().int(),
  materialId: z.string().uuid(),
  fileName: z.string(),
});

// ---------------------------------------------------------------------------
// Page range parser

/** Strict pageRange validation — only digits, hyphens, and commas allowed */
const RX_PAGE_RANGE_VALID = /^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$/;

/**
 * Parse a pageRange string into a sorted, deduplicated array of 1-based page numbers.
 * Throws a typed error on invalid format, reverse range, or DoS-guard breach.
 */
function parsePageRange(pageRange: string): number[] {
  const trimmed = pageRange.trim();

  if (!RX_PAGE_RANGE_VALID.test(trimmed)) {
    throw Object.assign(
      new Error('PAGE_RANGE_INVALID: pageRange must match pattern "N", "N-M", or "N,M-P,..."'),
      { code: 'PAGE_RANGE_INVALID' },
    );
  }

  const pageSet = new Set<number>();
  const segments = trimmed.split(',');

  for (const seg of segments) {
    if (seg.includes('-')) {
      const parts = seg.split('-');
      const start = parseInt(parts[0]!, 10);
      const end = parseInt(parts[1]!, 10);

      // Reject reverse ranges
      if (start > end) {
        throw Object.assign(
          new Error(`PAGE_RANGE_INVALID: reverse range "${seg}" (start > end)`),
          { code: 'PAGE_RANGE_INVALID' },
        );
      }

      // Reject zero-page numbers
      if (start < 1) {
        throw Object.assign(
          new Error(`PAGE_RANGE_INVALID: page numbers must be >= 1, got "${seg}"`),
          { code: 'PAGE_RANGE_INVALID' },
        );
      }

      for (let p = start; p <= end; p++) {
        pageSet.add(p);
      }
    } else {
      const p = parseInt(seg, 10);
      if (p < 1) {
        throw Object.assign(
          new Error(`PAGE_RANGE_INVALID: page numbers must be >= 1, got "${seg}"`),
          { code: 'PAGE_RANGE_INVALID' },
        );
      }
      pageSet.add(p);
    }
  }

  const pages = Array.from(pageSet).sort((a, b) => a - b);

  // DoS guard: reject if too many pages requested
  if (pages.length > MAX_PAGES_PER_REQUEST) {
    throw Object.assign(
      new Error(
        `PAGE_RANGE_TOO_LARGE: requested ${pages.length} pages, max is ${MAX_PAGES_PER_REQUEST}`,
      ),
      { code: 'PAGE_RANGE_TOO_LARGE' },
    );
  }

  return pages;
}

// ---------------------------------------------------------------------------
// PDF per-page text extraction using MuPDF

interface PageText {
  pageNumber: number;
  text: string;
  truncated: boolean;
}

async function extractPdfPageRange(buf: Buffer, requestedPages: number[]): Promise<{
  pages: PageText[];
  totalPages: number;
}> {
  // Uses static import of extractPdfText (AGPL boundary satisfied: @wiki-team/pdf-extract is the only
  // package that imports mupdf directly; this file imports the public API only).
  // Strategy: extract full text, split on \f (form-feed) page separators emitted by mupdf.
  const fullText = await extractPdfText(buf);
  const rawPages = fullText.split('\f');
  const totalPages = rawPages.length;

  const pages: PageText[] = [];

  for (const pageNum of requestedPages) {
    if (pageNum > totalPages) {
      // Out-of-range: skip silently (caller can infer from totalPages)
      continue;
    }

    const rawText = rawPages[pageNum - 1] ?? '';
    const truncated = rawText.length > MAX_BYTES_PER_PAGE;
    pages.push({
      pageNumber: pageNum,
      text: truncated ? rawText.slice(0, MAX_BYTES_PER_PAGE) + '\n[TRUNCATED]' : rawText,
      truncated,
    });
  }

  return { pages, totalPages };
}

// ---------------------------------------------------------------------------
// Non-PDF: return full text as single page

async function extractNonPdfPage(
  buf: Buffer,
  mimeType: string,
  requestedPages: number[],
): Promise<{ pages: PageText[]; totalPages: number }> {
  let fullText: string;

  if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
    fullText = buf.toString('utf-8');
  } else if (mimeType === 'text/html') {
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
      `MIME_NOT_SUPPORTED: get_source_pages supports text/plain, text/markdown, application/pdf, text/html. Got "${mimeType}".`,
    );
  }

  // Non-PDF materials are always a single page (page 1)
  const totalPages = 1;
  const pages: PageText[] = [];

  if (requestedPages.includes(1)) {
    const truncated = fullText.length > MAX_BYTES_PER_PAGE;
    pages.push({
      pageNumber: 1,
      text: truncated ? fullText.slice(0, MAX_BYTES_PER_PAGE) + '\n[TRUNCATED]' : fullText,
      truncated,
    });
  }
  // Pages > 1 are silently omitted; caller sees totalPages=1 and knows to adjust.

  return { pages, totalPages };
}

// ---------------------------------------------------------------------------
// Handler

async function getSourcePagesHandler(
  input: z.infer<typeof GetSourcePagesInputSchema>,
  ctx: AuthContext,
): Promise<z.infer<typeof GetSourcePagesOutputSchema>> {
  // RBAC check — kb.view required
  const decision = evaluatePolicy(
    ctx,
    { resource: 'kb', workspaceId: input.workspaceId },
    { verb: 'view' },
  );
  throwIfDenied(decision, 'material.get_source_pages');

  // Parse page range before hitting DB — fast-fail on bad input
  let requestedPages: number[];
  try {
    requestedPages = parsePageRange(input.pageRange);
  } catch (err) {
    const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
    const e = err as Error & { code?: string };
    const errorCode = e.code === 'PAGE_RANGE_TOO_LARGE'
      ? ErrorCode.InvalidRequest
      : ErrorCode.InvalidRequest;
    throw new McpError(errorCode, e.message);
  }

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

  const { pages, totalPages } =
    row.mimeType === 'application/pdf'
      ? await extractPdfPageRange(buf, requestedPages)
      : await extractNonPdfPage(buf, row.mimeType, requestedPages);

  return GetSourcePagesOutputSchema.parse({
    pages,
    totalPages,
    materialId: row.id,
    fileName: row.fileName,
  });
}

// ---------------------------------------------------------------------------
// Tool export

export function buildGetSourcePagesTool(ctx: AuthContext) {
  return defineTool({
    name: 'material.get_source_pages',
    description:
      'Fetch text content for specific pages of a source material. ' +
      'pageRange supports: "5" (single page), "5-7" (range), "5,7,9" (discrete), or mixed "1-3,7,10-12". ' +
      'For non-PDF materials (text, markdown, HTML), the entire content is treated as a single page (page 1). ' +
      'Max 100 pages per request. Each page is capped at 50 KB. ' +
      'Use material.get_source_outline first to identify relevant sections.',
    inputSchema: GetSourcePagesInputSchema,
    handler: (input) =>
      getSourcePagesHandler(input, ctx).catch((err) =>
        wrapToolError(err, 'material.get_source_pages'),
      ),
  });
}

// ---------------------------------------------------------------------------
// parsePageRange exported for unit testing

export { parsePageRange };
