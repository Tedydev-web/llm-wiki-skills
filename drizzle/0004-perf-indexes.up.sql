-- Migration 0004 — performance indexes (v2.0.1 patch)
--
-- Added per tech-debt audit (plans/reports/tech-debt-audit-260506-1646-v2-0-release.md):
-- wiki.recent tool ORDER BY updated_at requires a composite index to stay cheap
-- as workspaces accumulate notes. Single-column workspace_id index existed but
-- forced an in-memory sort.
--
-- This migration is independent of 0001-0003 (additive only); rollback drops
-- the index without touching data.

CREATE INDEX IF NOT EXISTS notes_workspace_updated_idx
  ON notes (workspace_id, updated_at DESC);
