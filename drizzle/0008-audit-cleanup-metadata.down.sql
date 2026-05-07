-- 0008-audit-cleanup-metadata.down.sql
-- Reverse: drop all per-dimension ivfflat indexes created by 0008 up migration

DROP INDEX IF EXISTS notes_embedding_768_ivfflat_idx;
DROP INDEX IF EXISTS notes_embedding_1024_ivfflat_idx;
DROP INDEX IF EXISTS notes_embedding_1536_ivfflat_idx;
