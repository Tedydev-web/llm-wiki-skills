-- 0002-init-content.down.sql
-- Rollback for 0002-init-content.up.sql
-- Drop in reverse dependency order.

DROP TABLE IF EXISTS workspace_materials CASCADE;
DROP TABLE IF EXISTS material_tags       CASCADE;
DROP TABLE IF EXISTS materials           CASCADE;
DROP TABLE IF EXISTS note_links          CASCADE;
DROP TABLE IF EXISTS notes               CASCADE;
DROP TABLE IF EXISTS note_kinds          CASCADE;
