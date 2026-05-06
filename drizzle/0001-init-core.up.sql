-- 0001-init-core.up.sql
-- Core identity + workspace tables.
-- Tables: users, groups, role_definitions, workspaces, members
-- Down: drizzle/0001-init-core.down.sql

-- users — authenticated identities (v2 name; replaces forbidden "employees")
CREATE TABLE IF NOT EXISTS users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(254) NOT NULL,
  display_name   VARCHAR(120) NOT NULL,
  avatar_url     TEXT,
  group_id       UUID,
  password_hash  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx   ON users (email);
CREATE        INDEX IF NOT EXISTS users_group_id_idx ON users (group_id);

-- groups — org-level grouping for RBAC scope (v2 name; replaces forbidden "departments")
CREATE TABLE IF NOT EXISTS groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(64) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS groups_slug_uidx ON groups (slug);

-- role_definitions — custom roles with permission JSON (v2 name; replaces forbidden "roles")
-- permissions: JSONB array of "<resource>.<verb>.<scope>" strings per ADR 010
CREATE TABLE IF NOT EXISTS role_definitions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(64) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  permissions  JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS role_definitions_slug_uidx ON role_definitions (slug);

-- workspaces — top-level multi-user project space (v2 name; replaces forbidden "projects")
CREATE TABLE IF NOT EXISTS workspaces (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(64) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  group_id     UUID,
  owner_id     UUID NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT fk_workspaces_owner FOREIGN KEY (owner_id) REFERENCES users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_uidx     ON workspaces (slug);
CREATE        INDEX IF NOT EXISTS workspaces_group_id_idx  ON workspaces (group_id);
CREATE        INDEX IF NOT EXISTS workspaces_owner_id_idx  ON workspaces (owner_id);

-- members — workspace membership (v2 name; replaces forbidden "project_members")
-- tier: observer | contributor | steward | owner (ADR 010 Realm 2)
CREATE TABLE IF NOT EXISTS members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  user_id      UUID NOT NULL,
  tier         VARCHAR(20) NOT NULL,
  invited_by   UUID,
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_members_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_members_user      FOREIGN KEY (user_id)      REFERENCES users (id),
  CONSTRAINT fk_members_invitedby FOREIGN KEY (invited_by)   REFERENCES users (id),
  CONSTRAINT members_tier_check   CHECK (tier IN ('observer','contributor','steward','owner'))
);

CREATE UNIQUE INDEX IF NOT EXISTS members_workspace_user_uidx ON members (workspace_id, user_id);
CREATE        INDEX IF NOT EXISTS members_user_id_idx         ON members (user_id);
