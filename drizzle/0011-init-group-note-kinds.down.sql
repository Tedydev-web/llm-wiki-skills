-- 0011-init-group-note-kinds.down.sql
-- Rollback: drop group_note_kinds table and all its indexes (CASCADE handles indexes).

DROP TABLE IF EXISTS group_note_kinds CASCADE;
