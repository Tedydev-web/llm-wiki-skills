-- 0002-init-content.up.sql
-- Content tables: note_kinds, notes, note_links, materials, material_tags, workspace_materials
-- Requires: 0000-init-extensions.sql (vector extension), 0001-init-core.up.sql (workspaces, users)
-- Down: drizzle/0002-init-content.down.sql

-- note_kinds — page-type taxonomy (v2 name; replaces forbidden "knowledge_types")
-- Canonical 4-tuple per ADR 010: fact | analysis | procedure | reference
CREATE TABLE IF NOT EXISTS note_kinds (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         VARCHAR(32) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT note_kinds_slug_check CHECK (slug IN ('fact','analysis','procedure','reference'))
);

CREATE UNIQUE INDEX IF NOT EXISTS note_kinds_slug_uidx ON note_kinds (slug);

-- Seed the 4 canonical kinds (idempotent)
INSERT INTO note_kinds (slug, display_name, description)
VALUES
  ('fact',      'Fact',      'Factual reference: definitions, specifications, data'),
  ('analysis',  'Analysis',  'Analysis and reasoning artifacts'),
  ('procedure', 'Procedure', 'How-to guides, runbooks, step-by-step instructions'),
  ('reference', 'Reference', 'External references and bibliography')
ON CONFLICT (slug) DO NOTHING;

-- notes — compiled wiki pages (v2 name; replaces forbidden "wiki_pages")
-- embedding: vector(768) for Gemini text-embedding-004 (ADR 011 / P03 spike confirmed)
-- version: starts at 1, incremented on each content write, never resets (ADR 011)
-- tags/links: stored as JSONB; ARRAY && overlap ops require sql`` escape hatch in Drizzle (P05 note)
CREATE TABLE IF NOT EXISTS notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  kb_id        UUID NOT NULL,
  slug         VARCHAR(120) NOT NULL,
  title        VARCHAR(255) NOT NULL,
  content      TEXT NOT NULL DEFAULT '',
  taxonomy     VARCHAR(20)  NOT NULL DEFAULT 'fact',
  tags         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  links        JSONB        NOT NULL DEFAULT '[]'::jsonb,
  embedding    vector(768),
  version      INTEGER      NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT fk_notes_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT notes_version_check CHECK (version >= 1),
  CONSTRAINT notes_taxonomy_check CHECK (taxonomy IN ('fact','analysis','procedure','reference'))
);

CREATE UNIQUE INDEX IF NOT EXISTS notes_workspace_kb_slug_uidx ON notes (workspace_id, kb_id, slug);
CREATE        INDEX IF NOT EXISTS notes_workspace_id_idx       ON notes (workspace_id);
CREATE        INDEX IF NOT EXISTS notes_kb_id_idx              ON notes (kb_id);
CREATE        INDEX IF NOT EXISTS notes_taxonomy_idx           ON notes (taxonomy);

-- Vector similarity index (IVFFlat cosine) — created after table is populated with data.
-- Run manually or in a post-migration step once > 1000 rows exist:
--   CREATE INDEX notes_embedding_ivfflat_idx
--     ON notes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- For smoke test / dev: exact scan (no index) is sufficient.

-- note_links — cross-references between notes (v2 name; replaces forbidden "wiki_links")
CREATE TABLE IF NOT EXISTS note_links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_note_id UUID         NOT NULL,
  to_note_id   UUID         NOT NULL,
  link_text    VARCHAR(255),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_note_links_from FOREIGN KEY (from_note_id) REFERENCES notes (id) ON DELETE CASCADE,
  CONSTRAINT fk_note_links_to   FOREIGN KEY (to_note_id)   REFERENCES notes (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS note_links_from_to_uidx ON note_links (from_note_id, to_note_id);
CREATE        INDEX IF NOT EXISTS note_links_from_idx     ON note_links (from_note_id);
CREATE        INDEX IF NOT EXISTS note_links_to_idx       ON note_links (to_note_id);

-- materials — raw uploaded source documents (v2 name; replaces forbidden "sources")
CREATE TABLE IF NOT EXISTS materials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID         NOT NULL,
  kb_id        UUID         NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  mime_type    VARCHAR(100) NOT NULL,
  storage_key  TEXT         NOT NULL,
  size_bytes   INTEGER      NOT NULL DEFAULT 0,
  status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
  dedupe_key   TEXT         NOT NULL,
  progress     INTEGER      NOT NULL DEFAULT 0,
  page_count   INTEGER      NOT NULL DEFAULT 0,
  failed_reason TEXT,
  uploaded_by  UUID         NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_materials_workspace  FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_materials_uploader   FOREIGN KEY (uploaded_by)  REFERENCES users (id),
  CONSTRAINT materials_status_check  CHECK (status IN ('pending','processing','completed','failed')),
  CONSTRAINT materials_progress_check CHECK (progress >= 0 AND progress <= 100)
);

CREATE        INDEX IF NOT EXISTS materials_workspace_id_idx  ON materials (workspace_id);
CREATE        INDEX IF NOT EXISTS materials_kb_id_idx         ON materials (kb_id);
CREATE        INDEX IF NOT EXISTS materials_status_idx        ON materials (status);
CREATE UNIQUE INDEX IF NOT EXISTS materials_dedupe_key_uidx   ON materials (dedupe_key);

-- material_tags — material scope/tag assignments (v2 name; replaces forbidden "source_departments")
CREATE TABLE IF NOT EXISTS material_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID        NOT NULL,
  tag         VARCHAR(64) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_material_tags_material FOREIGN KEY (material_id) REFERENCES materials (id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS material_tags_material_tag_uidx ON material_tags (material_id, tag);
CREATE        INDEX IF NOT EXISTS material_tags_tag_idx           ON material_tags (tag);

-- workspace_materials — many-to-many: workspaces ↔ materials (v2 name; replaces "project_sources")
CREATE TABLE IF NOT EXISTS workspace_materials (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID        NOT NULL,
  material_id  UUID        NOT NULL,
  added_by     UUID        NOT NULL,
  added_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ws_materials_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
  CONSTRAINT fk_ws_materials_material  FOREIGN KEY (material_id)  REFERENCES materials (id)  ON DELETE CASCADE,
  CONSTRAINT fk_ws_materials_adder     FOREIGN KEY (added_by)     REFERENCES users (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_materials_ws_mat_uidx ON workspace_materials (workspace_id, material_id);
CREATE        INDEX IF NOT EXISTS workspace_materials_ws_idx      ON workspace_materials (workspace_id);
