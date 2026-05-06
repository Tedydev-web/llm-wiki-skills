/**
 * pdf-extractor.ts — PDF text extraction via AGPL-boundary package
 *
 * Imports ONLY from @wiki-team/pdf-extract (the AGPL isolation package).
 * Never import 'mupdf' directly here — that violates the AGPL boundary.
 *
 * AGPL boundary: mupdf is confined to packages/wiki-pdf-extract/
 * Verified by CI grep: `grep -r "from 'mupdf'" --include="*.ts"` must only
 * match files inside that package.
 */

import { extractPdfText } from '@wiki-team/pdf-extract';

// ---------------------------------------------------------------------------
// ExtractedMaterial — normalised output from any extractor

export interface ExtractedMaterial {
  /** Extracted plain text, potentially truncated (see truncated flag) */
  text: string;
  /** True if extraction hit MATERIAL_CHARS_CAP and was cut short */
  truncated: boolean;
  /** Byte size of source buffer */
  sourceSizeBytes: number;
}

// ---------------------------------------------------------------------------
// extractFromPdf — entry point for BullMQ job pipeline

/**
 * Extract text from a PDF Buffer using MuPDF.js (via AGPL boundary package).
 *
 * @param buf   Raw PDF bytes as a Node.js Buffer.
 * @returns     Normalised ExtractedMaterial.
 * @throws      On corrupt PDF, empty buffer, or mupdf internal error.
 */
export async function extractFromPdf(buf: Buffer): Promise<ExtractedMaterial> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('[pdf-extractor] Received empty or invalid buffer');
  }

  const raw = await extractPdfText(buf);
  const truncated = raw.endsWith('\n[TRUNCATED]');
  const text = truncated ? raw.slice(0, -'\n[TRUNCATED]'.length) : raw;

  return {
    text,
    truncated,
    sourceSizeBytes: buf.byteLength,
  };
}
