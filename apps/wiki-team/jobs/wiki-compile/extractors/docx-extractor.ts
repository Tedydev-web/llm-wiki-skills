/**
 * docx-extractor.ts — DOCX text extraction via mammoth
 *
 * Uses mammoth (MIT) to convert .docx to plain text.
 * No AGPL concern — mammoth is MIT-licensed.
 */

import mammoth from 'mammoth';
import type { ExtractedMaterial } from './pdf-extractor.js';

// Shared cap constant — own value per phase-06 spec
const MATERIAL_CHARS_CAP = 150_000;

// ---------------------------------------------------------------------------
// extractFromDocx

/**
 * Extract plain text from a DOCX Buffer using mammoth.
 *
 * mammoth.extractRawText strips all formatting and returns clean plain text.
 * extractToHtml is avoided — agent loop needs text, not markup.
 *
 * @param buf   Raw DOCX bytes as a Node.js Buffer.
 * @returns     Normalised ExtractedMaterial.
 * @throws      On corrupt/unreadable DOCX.
 */
export async function extractFromDocx(buf: Buffer): Promise<ExtractedMaterial> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('[docx-extractor] Received empty or invalid buffer');
  }

  let result: { value: string; messages: Array<{ type: string; message: string }> };
  try {
    result = await mammoth.extractRawText({ buffer: buf });
  } catch (err) {
    throw new Error(
      `[docx-extractor] mammoth failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Log non-fatal mammoth warnings (e.g. unrecognised elements) without crashing
  for (const msg of result.messages) {
    if (msg.type === 'error') {
      // Rethrow hard mammoth errors
      throw new Error(`[docx-extractor] mammoth error: ${msg.message}`);
    }
    // Warnings are informational — log only in non-test envs
    if (process.env['NODE_ENV'] !== 'test') {
      console.warn('[docx-extractor] mammoth warning:', msg.message);
    }
  }

  const raw = result.value;
  const truncated = raw.length > MATERIAL_CHARS_CAP;
  const text = truncated ? raw.slice(0, MATERIAL_CHARS_CAP) : raw;

  return {
    text,
    truncated,
    sourceSizeBytes: buf.byteLength,
  };
}
