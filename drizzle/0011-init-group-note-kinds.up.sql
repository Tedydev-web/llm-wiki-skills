-- 0011-init-group-note-kinds.up.sql
-- Migration: group_note_kinds join table — assigns allowed NoteKind slugs to groups.
-- P08 §Schema — group-scoped knowledge type filtering.
--
-- Groups WITHOUT rows in this table: see all note kinds (legacy behavior, no restriction).
-- Groups WITH rows: members see ONLY notes whose taxonomy IN assigned kind slugs.
--
-- References: groups(id) ON DELETE CASCADE, note_kinds(id) ON DELETE CASCADE.

CREATE TABLE IF NOT EXISTS group_note_kinds (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  note_kind_id   UUID NOT NULL REFERENCES note_kinds(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS group_note_kinds_uniq
  ON group_note_kinds (group_id, note_kind_id);

CREATE INDEX IF NOT EXISTS group_note_kinds_group_idx
  ON group_note_kinds (group_id);

CREATE INDEX IF NOT EXISTS group_note_kinds_note_kind_idx
  ON group_note_kinds (note_kind_id);
