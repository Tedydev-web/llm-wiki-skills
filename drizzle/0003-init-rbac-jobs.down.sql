-- 0003-init-rbac-jobs.down.sql
-- Rollback for 0003-init-rbac-jobs.up.sql
-- Drop in reverse dependency order.

DROP TABLE IF EXISTS audit_events CASCADE;
DROP TABLE IF EXISTS jobs         CASCADE;
DROP TABLE IF EXISTS mcp_tokens   CASCADE;
