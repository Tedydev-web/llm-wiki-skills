-- 0007-material-images.up.sql
-- Migration: material_images table for PDF/DOCX image extraction + vision captioning.
-- ADR 015 (image extraction policy): VISION_ENABLED_DEFAULT=false; per-material cost cap.
-- ADR 015 §Anti-trace: caption field uses 'caption' (not the forbidden upstream attribute name).
--
-- Upsert-safe: UNIQUE (material_id, page_number, image_index) — recompile without duplicates.
-- Down: drizzle/0007-material-images.down.sql

CREATE TABLE IF NOT EXISTS material_images (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id       UUID         NOT NULL
    REFERENCES materials(id) ON DELETE CASCADE,
  -- 0-based page index in source document
  page_number       INTEGER      NOT NULL DEFAULT 0,
  -- 0-based index of image within the page
  image_index       INTEGER      NOT NULL DEFAULT 0,
  -- Byte offset of image in source buffer (approximate; stable ordering key)
  image_offset_bytes INTEGER     NOT NULL DEFAULT 0,
  -- MIME type: image/jpeg | image/png | image/webp | image/gif
  mime_type         VARCHAR(32)  NOT NULL,
  -- MinIO storage key for the raw image bytes
  storage_key       TEXT         NOT NULL,
  -- Raw image size in bytes
  size_bytes        INTEGER      NOT NULL,
  -- Caption text — NULL until vision job completes; ADR 015: named 'caption'
  caption           TEXT         NULL,
  -- Provider that produced caption: 'openai' | 'google' | 'anthropic'
  caption_provider  VARCHAR(16)  NULL,
  -- Cost of caption API call stored as decimal string (e.g. '0.000420')
  caption_cost_usd  VARCHAR(10)  NULL,
  -- Status lifecycle: pending → captioned | skipped | failed
  status            VARCHAR(16)  NOT NULL DEFAULT 'pending'
    CONSTRAINT material_images_status_check
      CHECK (status IN ('pending', 'captioned', 'skipped', 'failed')),
  -- Reason for skipped: 'cost_cap_hit' | 'size_cap_exceeded'
  skipped_reason    VARCHAR(64)  NULL,
  -- Reason for failed
  failed_reason     TEXT         NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Upsert-safe: recompile does not create duplicate rows
  CONSTRAINT material_images_mat_page_img_uq
    UNIQUE (material_id, page_number, image_index)
);

-- Fast lookup by parent material
CREATE INDEX IF NOT EXISTS material_images_material_id_idx
  ON material_images (material_id);

-- Fast lookup by status (vision queue polls pending rows)
CREATE INDEX IF NOT EXISTS material_images_status_idx
  ON material_images (status);
