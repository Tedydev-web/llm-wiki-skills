-- 0006-provider-settings.up.sql
-- Migration: provider_settings table for multi-provider LLM/embedding/vision config.
-- ADR 013 §Storage — per-workspace, per-capability provider selection with encrypted keys.
--
-- Security: api_key_encrypted stores AES-GCM-256 ciphertext (hex); encryption_metadata
-- stores HKDF derivation params (saltHex, ivHex, rotationEpoch, info). Key never stored
-- in plaintext. See apps/wiki-team/services/provider-key-encryption.ts.

CREATE TABLE IF NOT EXISTS provider_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  capability          VARCHAR(16) NOT NULL CHECK (capability IN ('llm', 'embedding', 'vision')),
  vendor              VARCHAR(16) NOT NULL CHECK (vendor IN ('openai', 'google', 'anthropic', 'voyage')),
  model               VARCHAR(64) NOT NULL,
  -- AES-GCM-256 ciphertext (hex-encoded; includes 16-byte auth tag appended by SubtleCrypto)
  api_key_encrypted   TEXT NOT NULL,
  -- HKDF derivation params: { saltHex, ivHex, rotationEpoch, info }
  encryption_metadata JSONB NOT NULL,
  -- Per-provider per-workspace daily USD cost cap (tracked via Redis millicents)
  daily_cost_cap_usd  NUMERIC(8, 2) NOT NULL DEFAULT 5.00,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique: one active config per workspace × capability × vendor
-- (allows switching vendor while keeping old row for rollback reference)
CREATE UNIQUE INDEX IF NOT EXISTS provider_settings_ws_cap_vendor_uidx
  ON provider_settings (workspace_id, capability, vendor);

-- Lookup index for workspace-scoped queries
CREATE INDEX IF NOT EXISTS provider_settings_workspace_idx
  ON provider_settings (workspace_id);

-- Partial index: fast lookup for the active (most-recently updated) row per capability
CREATE INDEX IF NOT EXISTS provider_settings_ws_cap_idx
  ON provider_settings (workspace_id, capability);
