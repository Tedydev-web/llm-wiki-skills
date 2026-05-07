-- 0005-taxonomy-color.down.sql
-- Reverts the taxonomy-color extension added in 0005-up.
-- Note: seed rows and is_system_default marks NOT removed (data preservation).

ALTER TABLE note_kinds
  DROP COLUMN IF EXISTS color,
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS created_by_user_id,
  DROP COLUMN IF EXISTS is_system_default;
