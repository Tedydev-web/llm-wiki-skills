/**
 * pdf-extractor.ts — PDF text extraction via AGPL-boundary package.
 * Also calls image extraction and returns an image manifest for the vision queue.
 *
 * Imports ONLY from @wiki-team/pdf-extract (the AGPL isolation package).
 * Never import 'mupdf' directly here — that violates the AGPL boundary.
 *
 * AGPL boundary: mupdf is confined to packages/wiki-pdf-extract/
 * Verified by CI grep: `grep -r "from 'mupdf'" --include="*.ts"` must only
 * match files inside that package.
 */

import { extractPdfText } from '@wiki-team/pdf-extract';
import { extractAndStoreImages } from './pdf-image-extractor.js';
import type { ImageManifest } from './pdf-image-extractor.js';

// ---------------------------------------------------------------------------
// ExtractedMaterial — normalised output from any extractor

export interface ExtractedMaterial {
  /** Extracted plain text, potentially truncated (see truncated flag) */
  text: string;
  /** True if extraction hit MATERIAL_CHARS_CAP and was cut short */
  truncated: boolean;
  /** Byte size of source buffer */
  sourceSizeBytes: number;
  /**
   * Image manifest populated when materialId is provided and vision extraction
   * succeeds. Undefined/null when not applicable (URL materials, DOCX, or error).
   */
  imageManifest?: ImageManifest | null;
}

// ---------------------------------------------------------------------------
// extractFromPdf — entry point for BullMQ job pipeline

/**
 * Extract text (and optionally images) from a PDF Buffer via AGPL boundary package.
 *
 * When materialId is provided, images are extracted and stored to MinIO so the
 * vision-captions queue can process them asynchronously. Image extraction failure
 * never fails text extraction — imageManifest will be null on error.
 *
 * @param buf         Raw PDF bytes as a Node.js Buffer.
 * @param materialId  Optional material UUID — when present, triggers image extraction.
 * @returns           Normalised ExtractedMaterial (with imageManifest if applicable).
 * @throws            On corrupt PDF, empty buffer, or mupdf internal error (text path only).
 */
export async function extractFromPdf(
  buf: Buffer,
  materialId?: string,
): Promise<ExtractedMaterial> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('[pdf-extractor] Received empty or invalid buffer');
  }

  const raw = await extractPdfText(buf);
  const truncated = raw.endsWith('\n[TRUNCATED]');
  const text = truncated ? raw.slice(0, -'\n[TRUNCATED]'.length) : raw;

  // Image extraction — best-effort, never fails the text pipeline
  let imageManifest: ImageManifest | null = null;
  if (materialId) {
    try {
      imageManifest = await extractAndStoreImages(materialId, buf);
    } catch {
      // Non-fatal: text extraction already succeeded; vision is best-effort
      imageManifest = null;
    }
  }

  return {
    text,
    truncated,
    sourceSizeBytes: buf.byteLength,
    imageManifest,
  };
}
