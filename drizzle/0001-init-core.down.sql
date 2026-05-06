-- 0001-init-core.down.sql
-- Rollback for 0001-init-core.up.sql
-- Drop in reverse dependency order.

DROP TABLE IF EXISTS members         CASCADE;
DROP TABLE IF EXISTS workspaces      CASCADE;
DROP TABLE IF EXISTS role_definitions CASCADE;
DROP TABLE IF EXISTS groups          CASCADE;
DROP TABLE IF EXISTS users           CASCADE;
