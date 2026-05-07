-- 0009-embedding-multi-dim.down.sql
-- Rollback: remove multi-dimension embedding columns added in 0009 up.
-- Restores original `embedding` column name (vector(768)) and drops metadata cols.

-- Step 1: Drop partial indexes
DROP INDEX IF EXISTS notes_embedding_1536_nn_idx;
DROP INDEX IF EXISTS notes_embedding_1024_nn_idx;
DROP INDEX IF EXISTS notes_embedding_768_nn_idx;
DROP INDEX IF EXISTS notes_embedding_provider_idx;

-- Step 2: Drop metadata columns
ALTER TABLE notes
  DROP COLUMN IF EXISTS embedding_updated_at,
  DROP COLUMN IF EXISTS embedding_dimensions,
  DROP COLUMN IF EXISTS embedding_model,
  DROP COLUMN IF EXISTS embedding_provider;

-- Step 3: Drop new dim columns
ALTER TABLE notes
  DROP COLUMN IF EXISTS embedding_1536,
  DROP COLUMN IF EXISTS embedding_1024;

-- Step 4: Rename embedding_768 back to embedding
ALTER TABLE notes RENAME COLUMN embedding_768 TO embedding;
