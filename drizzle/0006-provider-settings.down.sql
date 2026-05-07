-- 0006-provider-settings.down.sql
-- Rollback: drop provider_settings table and associated indexes.

DROP INDEX IF EXISTS provider_settings_ws_cap_idx;
DROP INDEX IF EXISTS provider_settings_workspace_idx;
DROP INDEX IF EXISTS provider_settings_ws_cap_vendor_uidx;
DROP TABLE IF EXISTS provider_settings;
