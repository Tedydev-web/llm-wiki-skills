/**
 * extract-images.ts — AGPL-boundary: PDF image extraction via MuPDF.js
 *
 * AGPL-3.0-only (ADR 009). This file MUST remain inside packages/wiki-pdf-extract/.
 * Never import from outside this package — AGPL obligation would propagate to importer.
 *
 * Returns a list of raw image buffers with page + positional metadata.
 * All MuPDF parser exceptions are caught per-image and returned as errors
 * (never crash the caller; sub-job skips on error).
 *
 * Caller (pdf-image-extractor.ts in apps/) is PolyForm-NC; it must not
 * call mupdf directly — only this exported function.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mupdf has no @types package
type MupdfModule = any;

// Lazily loaded mupdf — same singleton pattern as index.ts
let _mupdf: MupdfModule | null = null;

async function loadMupdf(): Promise<MupdfModule> {
  if (_mupdf !== null) return _mupdf;
  const mod = await import('mupdf');
  _mupdf = mod;
  return _mupdf;
}

// ---------------------------------------------------------------------------
// ExtractedImage — per-image result from a single PDF

export interface ExtractedImage {
  /** 0-based page index in the PDF */
  pageNumber: number;
  /** 0-based index of image within the page */
  imageIndex: number;
  /** Byte offset of image block in source buffer (approximate; used for dedup key) */
  imageOffsetBytes: number;
  /** MIME type: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' */
  mimeType: string;
  /** Raw image bytes */
  bytes: Buffer;
}

export interface ImageExtractionError {
  pageNumber: number;
  imageIndex: number;
  reason: string;
}

export interface ExtractImagesResult {
  images: ExtractedImage[];
  errors: ImageExtractionError[];
}

// ---------------------------------------------------------------------------
// Allowed MIME types (ADR 015 skip rules)

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// MuPDF colorspace → MIME type map (approximate; mupdf colorspace names vary)
function inferMimeType(image: MupdfModule): string {
  try {
    // mupdf v0.3 image API: image.getImageType() or image.colorspace.name
    const cs = image.colorspace;
    if (cs) {
      const name: string = cs.getName?.() ?? cs.name ?? '';
      if (name.toLowerCase().includes('cmyk')) return 'image/jpeg'; // CMYK → jpeg
    }
    // Try bps (bits per sample) — PNG tends to have alpha, JPEG doesn't
    const bps: number = image.getBPS?.() ?? 8;
    const n: number = image.getN?.() ?? 3;
    if (n === 4 && bps === 8) return 'image/png'; // RGBA → PNG
  } catch {
    // Fallback
  }
  return 'image/jpeg'; // Default — most PDF images are JPEG
}

// ---------------------------------------------------------------------------
// extractPdfImages — sole exported function

/**
 * Extract all images from a PDF buffer.
 *
 * Runs in BullMQ worker process only (never in API process).
 * Each page's image extraction is wrapped in try/catch — parse failures are
 * collected in errors[] and do NOT abort remaining images.
 *
 * @param buf  Raw PDF bytes (must be non-empty Buffer)
 * @returns    ExtractImagesResult — images + per-image errors (never throws)
 */
export async function extractPdfImages(buf: Buffer): Promise<ExtractImagesResult> {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    return {
      images: [],
      errors: [{ pageNumber: -1, imageIndex: -1, reason: 'empty or invalid buffer' }],
    };
  }

  const mupdf = await loadMupdf();
  const result: ExtractImagesResult = { images: [], errors: [] };

  let doc: MupdfModule;
  try {
    doc = mupdf.Document.openDocument(buf, 'application/pdf');
  } catch (err) {
    return {
      images: [],
      errors: [{
        pageNumber: -1,
        imageIndex: -1,
        reason: `open-failed: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }

  const pageCount: number = doc.countPages();
  // Cumulative byte offset tracker (approximation for stable ordering)
  let cumulativeOffset = 0;

  for (let pageIdx = 0; pageIdx < pageCount; pageIdx++) {
    try {
      const page = doc.loadPage(pageIdx);

      // mupdf v0.3: iterate image blocks via toStructuredText or getImageList
      // getImageList returns array of image xobject references
      const imageList: MupdfModule[] = page.getImages?.() ?? [];

      for (let imgIdx = 0; imgIdx < imageList.length; imgIdx++) {
        try {
          const imgRef = imageList[imgIdx];
          if (!imgRef) continue;

          // Attempt to load the pixmap / raw image data
          // mupdf v0.3 API: Pixmap from image
          const pixmap: MupdfModule = imgRef.toPixmap?.()
            ?? new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, imgRef.getBounds(), false);

          let rawBytes: Uint8Array;
          const mimeType = inferMimeType(imgRef);

          if (mimeType === 'image/png') {
            rawBytes = pixmap.asPNG();
          } else {
            // JPEG / default
            rawBytes = pixmap.asJPEG?.(90) ?? pixmap.asPNG();
          }

          if (!ALLOWED_MIME_TYPES.has(mimeType)) {
            result.errors.push({
              pageNumber: pageIdx,
              imageIndex: imgIdx,
              reason: `unsupported-mime: ${mimeType}`,
            });
            continue;
          }

          const imageBytes = Buffer.from(rawBytes);
          cumulativeOffset += imageBytes.length;

          result.images.push({
            pageNumber: pageIdx,
            imageIndex: imgIdx,
            imageOffsetBytes: cumulativeOffset - imageBytes.length,
            mimeType,
            bytes: imageBytes,
          });
        } catch (imgErr) {
          result.errors.push({
            pageNumber: pageIdx,
            imageIndex: imgIdx,
            reason: `image-extract-failed: ${imgErr instanceof Error ? imgErr.message : String(imgErr)}`,
          });
        }
      }
    } catch (pageErr) {
      result.errors.push({
        pageNumber: pageIdx,
        imageIndex: -1,
        reason: `page-load-failed: ${pageErr instanceof Error ? pageErr.message : String(pageErr)}`,
      });
    }
  }

  return result;
}
