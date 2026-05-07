---
adr: 014
title: Knowledge-type taxonomy — admin CRUD, color schema, MCP tools
status: accepted
date: 2026-05-07
depends-on: [010, 012]
---

# 014 — Knowledge-type taxonomy (admin CRUD + color)

## Context

v2.0 ships a fixed set of note kinds baked into the seed migration with no admin surface
for customisation. Three gaps block parity:

1. Admins cannot add organisation-specific note categories without a code change.
2. Kind display in UI has no color differentiation — all kinds render identically.
3. MCP clients cannot enumerate available kinds or query notes filtered by kind.

P02 implementers rely on this ADR alone; no scout report is required. The token `NoteKind`
(already in v2.0 schema) is the canonical code identifier. The upstream class name for this
concept is a forbidden trace token and must not appear in scaffold code (see §Anti-trace in
phase-00).

## Decision

### Schema delta — `note_kinds` table extensions

P02 owns migration 0005:

```sql
ALTER TABLE note_kinds
  ADD COLUMN color_hex    VARCHAR(7)   NOT NULL DEFAULT '#6b7280',  -- gray-500
  ADD COLUMN description  TEXT         NULL,
  ADD COLUMN is_system_default BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN created_by_user_id UUID   NULL REFERENCES users(id) ON DELETE SET NULL;
```

`is_system_default = true` rows are immutable — API rejects DELETE and UPDATE on slug/label
for system rows. Color and description may be edited even on system rows (admin preference).

### Default seed (idempotent — runs on migration 0005)

The **4 system defaults from ADR 010 remain immutable** in v2.1 (already in production via v2.0.0 tag); ADR 014 only ADDS CRUD capability + color metadata, it does NOT redefine the canonical taxonomy. Admin may add custom kinds with any name (including enterprise vocabulary like "policy", "sop", "product") — those are user-data, not system defaults.

| slug | label | color_hex | is_system_default | source |
|---|---|---|---|---|
| `fact` | Fact | `#ef4444` | true | ADR 010 (v2.0 locked) |
| `analysis` | Analysis | `#3b82f6` | true | ADR 010 (v2.0 locked) |
| `procedure` | Procedure | `#22c55e` | true | ADR 010 (v2.0 locked) |
| `reference` | Reference | `#a855f7` | true | ADR 010 (v2.0 locked) |

4 system defaults — same as v2.0 ADR 010. Admin can ADD custom kinds (e.g., `policy`, `sop`, `product`, `hr-policy`) via Settings UI; admin can edit any kind's `color_hex` and `description`; admin can delete custom kinds only when 0 notes are attached (enforced at API layer before DB delete, not via FK cascade).

**Anti-trace constraint:** custom kind slugs created by admin are user-data and may collide with upstream vocabulary (e.g., `entity`, `concept`, `topic`) — anti-trace audit script excludes runtime user-data from forbidden-token grep. Code-level system-default seed list MUST avoid forbidden tokens (only the 4 ADR 010 names).

### RBAC

- **Mutate (add/edit/delete):** requires global permission `kb.manage.all` (tenant admin).
- **Read (list):** requires `kb.view.own` or higher — honors existing scope evaluator per
  ADR 010.
- Workspace-level enforcement: `steward` and `owner` roles may read; only tenant admin may
  mutate.

### API surface (P02 implements)

```
GET    /api/note-kinds              → list all kinds (RBAC: kb.view.own+)
POST   /api/note-kinds              → create custom kind (RBAC: kb.manage.all)
PATCH  /api/note-kinds/:slug        → update label/color/description (RBAC: kb.manage.all)
DELETE /api/note-kinds/:slug        → delete if 0 notes attached (RBAC: kb.manage.all)
```

All inputs validated with Zod: `slug` regex `/^[a-z][a-z0-9-]{1,39}$/`; `color_hex`
regex `/^#[0-9a-f]{6}$/i`; `label` max 60 chars.

### `group_note_kinds` join table

P08 owns migration 0011. Groups can be restricted to a subset of kinds.
This ADR documents the intent; P08 phase owns the implementation.

```sql
CREATE TABLE group_note_kinds (
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  kind_slug  VARCHAR(50) NOT NULL REFERENCES note_kinds(slug) ON DELETE CASCADE,
  PRIMARY KEY (group_id, kind_slug)
);
```

MCP scope resolution (ADR 010) applies the group's allowed kind set as an additional
AND filter when `McpAccessContext.allowedPageTypes` is set.

### MCP tools (P02 ships, extends ADR 012 tool surface)

**`list_knowledge_types`**

```
Input:  { workspaceId: uuid }
Output: [{ slug: string, label: string, color_hex: string, description: string | null }]
Auth:   kb.view.own+ or valid MCP token scoped to workspaceId
```

Returns all kinds visible to the caller's RBAC scope. MCP tokens with
`allowedPageTypes` restriction see only their permitted subset.

**`get_knowledge_type_docs`**

```
Input:  { workspaceId: uuid, slug: string, cursor?: string, limit?: int(1–50)=20 }
Output: { kind: { slug, label, color_hex }, notes: [{ slug, title, excerpt, updatedAt }], nextCursor: string | null }
Auth:   kb.view.own+ or valid MCP token; honors policy evaluator (ADR 010)
Errors: KIND_NOT_FOUND, SCOPE_DENIED, KIND_NOT_IN_MCP_SCOPE
```

### UX

Admin Settings → "Knowledge Types" tab: table with inline-edit for label, color (hex
input + color swatch preview), and description. Delete button shown only when note count
for that kind is 0; tooltip explains why delete is disabled for system defaults and
kinds with attached notes.

## Consequences

**Positive:**
- Admins extend taxonomy without code deploys; supports domain-specific knowledge modelling.
- Color differentiation improves visual scanning in note lists and MCP responses.
- MCP clients can enumerate kinds and query kind-filtered note sets — closes gap with
  target feature's kind-aware retrieval.

**Negative:**
- System-default immutability requires explicit guard at API layer (not enforced by DB
  alone — a motivated DBA could UPDATE, accepted risk for v2.1).
- `group_note_kinds` join (P08) means kind availability is context-dependent; MCP callers
  must re-list kinds when group context changes.

**Neutral:**
- 4 system defaults (per ADR 010) provide the canonical taxonomy; admins layer
  organisation-specific kinds via CRUD without violating clean-room hygiene at the
  code-seed level.

## Alternatives rejected

- **Hard-coded kinds (v2.0 approach):** Cannot express org-specific categories without code
  changes. Rejected.
- **Free-text kind field on notes:** Loses type safety, prevents color association, prevents
  RBAC scoping by kind. Rejected.
- **Separate `kind_colors` table:** Unnecessary indirection for a single column. Rejected.
- **6 system defaults including upstream-style enterprise vocabulary:** Initial draft proposed
  6 defaults (`policy`/`sop`/`product`/`concept`/`entity`/`topic`); however three of those
  slugs (`concept`/`entity`/`topic`) are in the anti-trace forbidden-token set (scout report
  §Anti-trace forbidden 4-tuple). Hard-coding them in seed data violates ADR 001/009
  clean-room hygiene. Rejected. v2.1 keeps the 4 ADR 010 defaults at code level; admins
  layer enterprise vocabulary via CRUD as user-data.
- **Admin-editable system kind slugs:** Slug is a stable FK target and MCP identifier;
  allowing slug mutation would break existing notes and MCP token scopes. Rejected.

## References

- ADR 010: RBAC — `kb.manage.all` permission; `McpAccessContext.allowedPageTypes`
- ADR 012: MCP tool surface — `list_knowledge_types` and `get_knowledge_type_docs` extend it
- P02 phase: implementation owns `apps/wiki-team/src/note-kinds/`
- P08 phase: `group_note_kinds` migration 0011
