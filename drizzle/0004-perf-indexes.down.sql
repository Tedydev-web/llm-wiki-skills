-- Migration 0004 rollback — drops the composite index added for wiki.recent.
-- Safe to run independently; no data touched.

DROP INDEX IF EXISTS notes_workspace_updated_idx;
