-- 0005-taxonomy-color.up.sql
-- Extends note_kinds with color, description, audit fields (ADR 014).
-- Marks 4 ADR-010 system defaults as is_system_default=true.
-- Anti-trace: does NOT seed entity/concept/topic/policy/sop/product slugs.

-- description column already exists in v2.0 schema; idempotent ADD with IF NOT EXISTS
ALTER TABLE note_kinds
  ADD COLUMN IF NOT EXISTS color VARCHAR(7) NOT NULL DEFAULT '#6b7280',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS is_system_default BOOLEAN NOT NULL DEFAULT false;

-- Mark the 4 ADR-010 canonical defaults (fact | analysis | procedure | reference)
UPDATE note_kinds SET is_system_default = true, color = '#ef4444' WHERE slug = 'fact';
UPDATE note_kinds SET is_system_default = true, color = '#3b82f6' WHERE slug = 'analysis';
UPDATE note_kinds SET is_system_default = true, color = '#22c55e' WHERE slug = 'procedure';
UPDATE note_kinds SET is_system_default = true, color = '#a855f7' WHERE slug = 'reference';
