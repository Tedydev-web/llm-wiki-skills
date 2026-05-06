/**
 * index.ts — AGPL boundary: MuPDF.js PDF text extraction
 *
 * This package is the ONLY location in the monorepo that may import `mupdf`.
 * MuPDF.js is licensed under AGPL-3.0. Importing it outside this package
 * would spread the AGPL obligation to the importer's distribution boundary.
 *
 * See: LICENSE-NOTICE.md, ADR 009 (AGPL obligation documentation)
 *
 * Public API: extractPdfText(buf: Buffer): Promise<string>
 * All other MuPDF internals are private to this module.
 */

// Dynamic import defers AGPL surface until first call.
// This also prevents bundlers from statically inlining mupdf into non-AGPL packages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mupdf has no official @types package
type MupdfModule = any;

let _mupdf: MupdfModule | null = null;

/**
 * Lazily load the mupdf module. Isolated to this function so tree-shakers
 * and static analysis tools see the import only inside this AGPL-boundary package.
 */
async function loadMupdf(): Promise<MupdfModule> {
  if (_mupdf !== null) return _mupdf;
  // Dynamic import — keeps mupdf out of static dependency graph of callers
  const mod = await import('mupdf');
  _mupdf = mod;
  return _mupdf;
}

// ---------------------------------------------------------------------------
// MATERIAL_CHARS_CAP — max characters returned from a single PDF extraction.
// Own value derived per phase-06 spec (not from any upstream constant).

const MATERIAL_CHARS_CAP = 150_000;

// ---------------------------------------------------------------------------
// extractPdfText — sole exported function

/**
 * Extract plain text from a PDF buffer using MuPDF.js.
 *
 * Returns at most MATERIAL_CHARS_CAP characters. Truncation is indicated by
 * a trailing `[TRUNCATED]` marker so callers can detect incomplete extraction.
 *
 * @param buf   Raw PDF bytes as a Node.js Buffer.
 * @returns     Extracted plain text, potentially truncated.
 * @throws      On corrupt/unreadable PDF, password-protected files, or mupdf load failure.
 */
export async function extractPdfText(buf: Buffer): Promise<string> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('[pdf-extract] Input must be a non-empty Buffer');
  }

  const mupdf = await loadMupdf();

  // mupdf v0.3+ API: Document.openDocument(data, magic)
  // Magic string "application/pdf" tells mupdf to treat bytes as PDF.
  let doc: MupdfModule;
  try {
    doc = mupdf.Document.openDocument(buf, 'application/pdf');
  } catch (err) {
    throw new Error(
      `[pdf-extract] Failed to open PDF: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const pageCount: number = doc.countPages();
  const parts: string[] = [];
  let totalChars = 0;
  let truncated = false;

  for (let i = 0; i < pageCount; i++) {
    if (totalChars >= MATERIAL_CHARS_CAP) {
      truncated = true;
      break;
    }

    try {
      const page = doc.loadPage(i);
      // structuredText → paragraphs → lines → chars (mupdf v0.3 DOM API)
      const st = page.toStructuredText('preserve-whitespace');
      const pageText: string = st.asText();
      const remaining = MATERIAL_CHARS_CAP - totalChars;

      if (pageText.length > remaining) {
        parts.push(pageText.slice(0, remaining));
        totalChars += remaining;
        truncated = true;
        break;
      }

      parts.push(pageText);
      totalChars += pageText.length;
    } catch (pageErr) {
      // Non-fatal: skip unreadable page, continue with rest
      parts.push(`[PAGE ${i + 1} UNREADABLE]`);
    }
  }

  const text = parts.join('\n');
  return truncated ? `${text}\n[TRUNCATED]` : text;
}
