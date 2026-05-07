-- 0007-material-images.down.sql
-- Rollback: drop material_images table and its indexes.

DROP INDEX IF EXISTS material_images_status_idx;
DROP INDEX IF EXISTS material_images_material_id_idx;
DROP TABLE IF EXISTS material_images;
