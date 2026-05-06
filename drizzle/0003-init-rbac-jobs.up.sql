-- 0003-init-rbac-jobs.up.sql
-- RBAC + operational tables: mcp_tokens, jobs, audit_events
-- Requires: 0001-init-core.up.sql (workspaces, users), 0002-init-content.up.sql (materials)
-- Down: drizzle/0003-init-rbac-jobs.down.sql

-- mcp_tokens — MCP bearer token storage (ADR 012)
-- SECURITY: tokenHash is argon2id at rest. prefixLookup is HMAC-SHA256(fullToken, secret) truncated 16 hex.
-- NEVER store plaintext token. P04 inserts/queries; P03 authors schema only.
-- Columns coordinated with P04 (auth phase):
--   id, prefix_lookup, token_hash, user_id, workspace_id, scopes, expires_at, revoked_at, created_at
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id                  TEXT         PRIMARY KEY,         -- "wkt_<32+ alphanumeric>"
  prefix_lookup       VARCHAR(64)  NOT NULL,            -- HMAC-SHA256(fullToken, secret) truncated 16 hex; no plaintext bits
  token_hash          TEXT         NOT NULL,            -- argon2id hash of full token
  user_id             UUID         NOT NULL,            -- FK → users.id (token owner)
  workspace_id        UUID         NOT NULL,            -- FK → workspaces.id
  scopes              JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- PermissionGrant[] per ADR 010
  granted_kb_ids      JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- UUID[] of accessible KB IDs
  granted_page_types  JSONB        NOT NULL DEFAULT '[]'::jsonb,  -- taxonomy string[]
  expires_at          TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_mcp_tokens_user      FOREIGN KEY (user_id)      REFERENCES users (id),
  CONSTRAINT fk_mcp_tokens_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT mcp_tokens_id_format    CHECK (id LIKE 'wkt_%')
);

CREATE UNIQUE INDEX IF NOT EXISTS mcp_tokens_prefix_lookup_uidx ON mcp_tokens (prefix_lookup);
CREATE        INDEX IF NOT EXISTS mcp_tokens_user_id_idx        ON mcp_tokens (user_id);
CREATE        INDEX IF NOT EXISTS mcp_tokens_workspace_id_idx   ON mcp_tokens (workspace_id);

-- jobs — BullMQ job tracking rows (HTTP polling mirror of BullMQ state)
-- Retry policy per ADR 011: max_attempts = 3, exponential backoff 1s/5s/25s
CREATE TABLE IF NOT EXISTS jobs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name    VARCHAR(64)  NOT NULL,                  -- "ingest" | "recompile"
  bull_job_id   TEXT         NOT NULL,                  -- BullMQ external job ID
  material_id   UUID         NOT NULL,
  workspace_id  UUID         NOT NULL,
  state         VARCHAR(20)  NOT NULL DEFAULT 'waiting',
  progress      INTEGER      NOT NULL DEFAULT 0,
  attempts_made INTEGER      NOT NULL DEFAULT 0,
  max_attempts  INTEGER      NOT NULL DEFAULT 3,
  failed_reason TEXT,
  enqueued_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  CONSTRAINT fk_jobs_material  FOREIGN KEY (material_id)  REFERENCES materials (id)  ON DELETE CASCADE,
  CONSTRAINT fk_jobs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT jobs_state_check   CHECK (state IN ('waiting','active','completed','failed','delayed','paused')),
  CONSTRAINT jobs_progress_check CHECK (progress >= 0 AND progress <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_bull_job_id_uidx  ON jobs (bull_job_id);
CREATE        INDEX IF NOT EXISTS jobs_material_id_idx   ON jobs (material_id);
CREATE        INDEX IF NOT EXISTS jobs_workspace_id_idx  ON jobs (workspace_id);
CREATE        INDEX IF NOT EXISTS jobs_state_idx         ON jobs (state);

-- audit_events — immutable append-only audit trail (v2 name; replaces forbidden "audit_log")
-- NO UPDATE/DELETE on this table — append only.
CREATE TABLE IF NOT EXISTS audit_events (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID         NOT NULL,
  actor_id      UUID,                                   -- null for system/worker events
  action        VARCHAR(60)  NOT NULL,                  -- e.g. "note.created", "mcp_token.issued"
  resource_type VARCHAR(30)  NOT NULL,
  resource_id   UUID         NOT NULL,
  payload       JSONB,                                  -- before/after state JSON
  ip_address    VARCHAR(45),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_audit_events_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_audit_events_actor     FOREIGN KEY (actor_id)     REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS audit_events_workspace_id_idx ON audit_events (workspace_id);
CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx     ON audit_events (actor_id);
CREATE INDEX IF NOT EXISTS audit_events_resource_idx     ON audit_events (resource_type, resource_id);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx   ON audit_events (created_at);
