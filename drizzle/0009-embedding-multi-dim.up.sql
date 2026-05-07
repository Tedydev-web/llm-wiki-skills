-- 0009-embedding-multi-dim.up.sql
-- Migration: multi-dimension embedding columns for P04 vector dimension router.
-- ADR 013 §Vector dimension routing:
--   768d  → notes.embedding        (existing column; renamed embedding_768 via alias view)
--   1024d → notes.embedding_1024   (NEW; Voyage voyage-3-large)
--   1536d → notes.embedding_1536   (NEW; OpenAI text-embedding-3-small)
--
-- The original `embedding` column (vector(768)) is KEPT as-is for backwards compat.
-- We add an alias column `embedding_768` pointing semantically to the same data via:
--   RENAME existing `embedding` → `embedding_768`
-- Then re-add `embedding` as GENERATED ALWAYS ... STORED is NOT supported for vector types,
-- so we simply rename and patch all callers via embedding-router.
--
-- P10 owns ivfflat index creation (conditional on >1000 rows per workspace).
-- This migration adds the columns + metadata + a B-tree index for dim routing.

-- Step 1: Rename the existing embedding column to embedding_768
ALTER TABLE notes RENAME COLUMN embedding TO embedding_768;

-- Step 2: Add OpenAI 1536-dim column
ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding_1536 vector(1536) NULL;

-- Step 3: Add Voyage 1024-dim column
ALTER TABLE notes ADD COLUMN IF NOT EXISTS embedding_1024 vector(1024) NULL;

-- Step 4: Metadata columns for per-note provider tracking
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS embedding_provider VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS embedding_model    VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER   NULL,
  ADD COLUMN IF NOT EXISTS embedding_updated_at TIMESTAMPTZ NULL;

-- Step 5: Index for dimension router queries (workspace + provider + dims)
CREATE INDEX IF NOT EXISTS notes_embedding_provider_idx
  ON notes (workspace_id, embedding_provider, embedding_dimensions);

-- Step 6: Partial index on embedding_768 IS NOT NULL (for 768-dim workspace searches)
CREATE INDEX IF NOT EXISTS notes_embedding_768_nn_idx
  ON notes (workspace_id, embedding_updated_at)
  WHERE embedding_768 IS NOT NULL;

-- Step 7: Partial index on embedding_1024 IS NOT NULL (Voyage workspace searches)
CREATE INDEX IF NOT EXISTS notes_embedding_1024_nn_idx
  ON notes (workspace_id, embedding_updated_at)
  WHERE embedding_1024 IS NOT NULL;

-- Step 8: Partial index on embedding_1536 IS NOT NULL (OpenAI workspace searches)
CREATE INDEX IF NOT EXISTS notes_embedding_1536_nn_idx
  ON notes (workspace_id, embedding_updated_at)
  WHERE embedding_1536 IS NOT NULL;
