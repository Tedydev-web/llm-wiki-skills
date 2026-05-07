/**
 * pdf-image-extractor.ts — PDF image extraction + MinIO upload + DB row creation.
 *
 * PolyForm-NC boundary: imports from @wiki-team/pdf-extract (AGPL-bound);
 * never imports 'mupdf' directly (verified by CI grep).
 *
 * Responsibilities:
 *   1. Call extractPdfImages() from the AGPL-boundary package
 *   2. Filter by size cap (IMAGE_MAX_SIZE_MB, default 5MB)
 *   3. Upload accepted images to MinIO under materialImages/<materialId>/<page>-<idx>.<ext>
 *   4. INSERT material_images rows with status='pending' (upsert on conflict)
 *   5. Return ImageManifest: list of DB row IDs for the vision queue to process
 *
 * All errors are collected — never throws on partial image failure.
 */

import { eq, and } from 'drizzle-orm';
import { extractPdfImages } from '@wiki-team/pdf-extract';
import type { ExtractedImage } from '@wiki-team/pdf-extract';
import { getDb, schema } from '../../../storage/db.js';
import { getObjectStore } from '../../../storage/object-store.js';
import { logger } from '../../../lib/logger.js';

// ---------------------------------------------------------------------------
// Config

/** Default max image size in bytes (5 MB) */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function getMaxImageBytes(): number {
  const raw = process.env['IMAGE_MAX_SIZE_MB'];
  if (!raw) return DEFAULT_MAX_BYTES;
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1024 * 1024) : DEFAULT_MAX_BYTES;
}

// MIME → extension map
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};

// ---------------------------------------------------------------------------
// ImageManifestEntry — one extracted + stored image

export interface ImageManifestEntry {
  /** DB row id in material_images */
  rowId: string;
  /** MinIO storage key */
  storageKey: string;
  pageNumber: number;
  imageIndex: number;
  mimeType: string;
  sizeBytes: number;
}

export interface ImageManifest {
  entries: ImageManifestEntry[];
  /** Images skipped due to size cap or unsupported MIME */
  skippedCount: number;
  /** Parse errors from AGPL extractor */
  extractionErrors: number;
}

// ---------------------------------------------------------------------------
// extractAndStoreImages — main entry point

/**
 * Extract images from a PDF buffer, upload to MinIO, and insert material_images rows.
 *
 * @param materialId  UUID of the parent material
 * @param buf         Raw PDF bytes
 * @returns           ImageManifest — rowIds for vision queue
 */
export async function extractAndStoreImages(
  materialId: string,
  buf: Buffer,
): Promise<ImageManifest> {
  const maxBytes = getMaxImageBytes();
  const db = getDb();
  const store = getObjectStore();

  // Step 1: Extract images via AGPL-boundary package (never throws)
  const extracted = await extractPdfImages(buf);

  const manifest: ImageManifest = {
    entries: [],
    skippedCount: 0,
    extractionErrors: extracted.errors.length,
  };

  if (extracted.errors.length > 0) {
    logger.warn(
      { materialId, errorCount: extracted.errors.length, errors: extracted.errors.slice(0, 5) },
      '[pdf-image-extractor] some images failed to extract',
    );
  }

  // Step 2: Process each extracted image
  for (const img of extracted.images) {
    // Size cap check
    if (img.bytes.length > maxBytes) {
      manifest.skippedCount++;
      logger.debug(
        { materialId, page: img.pageNumber, idx: img.imageIndex, sizeBytes: img.bytes.length, maxBytes },
        '[pdf-image-extractor] skipping oversized image',
      );
      // Insert skipped row so vision job knows it was intentionally skipped
      await upsertMaterialImageRow(db, materialId, img, null, 'skipped', 'size_cap_exceeded');
      continue;
    }

    // Upload to MinIO
    const storageKey = buildStorageKey(materialId, img);
    try {
      await store.upload(storageKey, img.bytes, { contentType: img.mimeType });
    } catch (uploadErr) {
      logger.error(
        { materialId, storageKey, err: uploadErr instanceof Error ? uploadErr.message : String(uploadErr) },
        '[pdf-image-extractor] MinIO upload failed — skipping image',
      );
      manifest.skippedCount++;
      continue;
    }

    // Upsert DB row with status='pending'
    const rowId = await upsertMaterialImageRow(db, materialId, img, storageKey, 'pending', null);
    if (!rowId) {
      manifest.skippedCount++;
      continue;
    }

    manifest.entries.push({
      rowId,
      storageKey,
      pageNumber: img.pageNumber,
      imageIndex: img.imageIndex,
      mimeType: img.mimeType,
      sizeBytes: img.bytes.length,
    });
  }

  logger.info(
    {
      materialId,
      stored: manifest.entries.length,
      skipped: manifest.skippedCount,
      extractionErrors: manifest.extractionErrors,
    },
    '[pdf-image-extractor] image extraction complete',
  );

  return manifest;
}

// ---------------------------------------------------------------------------
// Helpers

function buildStorageKey(materialId: string, img: ExtractedImage): string {
  const ext = MIME_TO_EXT[img.mimeType] ?? 'bin';
  return `materialImages/${materialId}/p${img.pageNumber}-i${img.imageIndex}.${ext}`;
}

async function upsertMaterialImageRow(
  db: ReturnType<typeof getDb>,
  materialId: string,
  img: ExtractedImage,
  storageKey: string | null,
  status: string,
  skippedReason: string | null,
): Promise<string | null> {
  try {
    // Check for existing row (upsert pattern: unique on materialId + pageNumber + imageIndex)
    const existing = await db
      .select({ id: schema.materialImages.id })
      .from(schema.materialImages)
      .where(
        and(
          eq(schema.materialImages.materialId, materialId),
          eq(schema.materialImages.pageNumber, img.pageNumber),
          eq(schema.materialImages.imageIndex, img.imageIndex),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing row
      await db
        .update(schema.materialImages)
        .set({
          status,
          storageKey: storageKey ?? existing[0]!.id,
          sizeBytes: img.bytes.length,
          mimeType: img.mimeType,
          imageOffsetBytes: img.imageOffsetBytes,
          skippedReason,
          updatedAt: new Date(),
        })
        .where(eq(schema.materialImages.id, existing[0]!.id));
      return existing[0]!.id;
    }

    // Insert new row
    const inserted = await db
      .insert(schema.materialImages)
      .values({
        materialId,
        pageNumber: img.pageNumber,
        imageIndex: img.imageIndex,
        imageOffsetBytes: img.imageOffsetBytes,
        mimeType: img.mimeType,
        storageKey: storageKey ?? '',
        sizeBytes: img.bytes.length,
        status,
        skippedReason,
      })
      .returning({ id: schema.materialImages.id });

    return inserted[0]?.id ?? null;
  } catch (err) {
    logger.error(
      {
        materialId,
        page: img.pageNumber,
        idx: img.imageIndex,
        err: err instanceof Error ? err.message : String(err),
      },
      '[pdf-image-extractor] DB upsert failed',
    );
    return null;
  }
}
