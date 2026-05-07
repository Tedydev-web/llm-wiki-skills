# Changelog (v2.0+ team-mode + v1.2 personal mode)

All notable changes to the **monorepo root** are documented here.
For v1.2 personal-mode history (frozen), see [`apps/wiki-skills/CHANGELOG-pre-v2.md`](apps/wiki-skills/CHANGELOG-pre-v2.md).

## Branching contract

- `main` = release branch (tagged). `feat/v2-team-mode` = working branch (PR'd to main on release).
- `npx skills update -g` tracks `main` — always pulls latest release tag.

## Migration note

**v1.2 personal users:** nothing changes. `npx skills add Tedydev-web/llm-wiki-skills` still works exactly as before.
**Team users (v2.0 new):** see [`apps/wiki-team/README.md`](apps/wiki-team/README.md) for quickstart.

---

## [2.1.0] — 2026-05-07

**Feature release.** Closes 9 user-facing parity gaps + 12 v2.1 tech-debt items vs v2.0.1. Feature catalog: 81% → 93%; workflow parity vs arkon: 56% → 85%. Clean-room hygiene preserved (Mode A — no source read; ADR 009 holds). Anti-trace: 0 hits across 152 v2.1 files.

> `directory.lookup` ≡ arkon's `find_contacts` tool (same surface, distinct naming per anti-trace).
> Graph visualization deferred v2.2; backlinks/outlinks panel ships as substitute.

### Added

#### ADRs
- **ADR 013**: Multi-provider LLM/embedding/vision abstraction (9-cell adapter matrix: 3 LLM × 3 embed × 3 vision)
- **ADR 014**: Knowledge-type taxonomy CRUD with color schema + admin-extensible kinds
- **ADR 015**: Image extraction + vision captions (async BullMQ sub-jobs; opt-in; cost-capped)

#### Multi-provider AI (P01)
- Multi-provider LLM/embedding/vision: 9-cell adapter matrix (3 LLM × 3 embed × 3 vision)
  - Embedding: OpenAI `text-embedding-3-small` (1536d) / Google `text-embedding-004` (768d) / Voyage AI `voyage-3-large` (1024d)
  - LLM: Anthropic `claude-sonnet-4-5` / OpenAI `gpt-4o` / Google `gemini-2.5-pro`
  - Vision: OpenAI `gpt-4o-vision` / Google `gemini-vision` / Anthropic claude-vision (LLM + image blocks)
- Provider Settings admin UI with HKDF + AES-GCM-256 encrypted API keys (per-row salt; rotation epoch)

#### Knowledge-type taxonomy (P02)
- Knowledge-type taxonomy CRUD admin UI (color schema; 4 ADR 010 system defaults preserved: fact/analysis/procedure/reference)
- 2 new MCP tools: `list_knowledge_types` + `get_knowledge_type_docs`
- Admins add custom knowledge kinds with color labels without touching code

#### Image extraction + vision captions (P03)
- Image extraction during PDF ingestion via separate BullMQ queue (per-image sub-jobs; never blocks compile)
- Vision caption generation on extracted images; captions stored + embedded
- Per-material vision cost cap ($0.50 default) + per-workspace daily cap
- Vision opt-in default OFF (PII disclosure flag); opt-in per workspace

#### Embedding write-path + search (P04)
- Embedding write-path wired with multi-dim router (768d/1024d/1536d columns)
- Embedding rebuild job: mid-switch abort + pre-flight cost estimate
- Semantic search admin UI (embedding results surfaced in frontend)
- ivfflat auto-create per dimension (768/1024/1536) at ≥1000-row threshold

#### Three-panel wiki browser (P05)
- Three-panel wiki browser FE: page tree | content | backlinks/outlinks panel
- Keyboard navigation: `j`/`k` (prev/next note), `b` (backlinks toggle), `Esc` (close panel), `/` (search focus)
- Graph visualization deferred to v2.2 (backlinks/outlinks panel is functional substitute)

#### DEFAULT_ADMIN_EMAIL bootstrap (P06)
- `DEFAULT_ADMIN_EMAIL` + `DEFAULT_ADMIN_PASSWORD` env-based admin bootstrap on first boot
- `WIKI_ENV` env var (`staging`/`prod`) for environment distinction
- Password deleted from `process.env` after first-boot bootstrap (security hygiene S-2)
- Idempotent: no-op on subsequent boots if admin already exists

#### Source outline + MCP expansion (P07)
- Source outline tree MCP tool: hierarchical document outline from PDF TOC / heading scan
- Page-range fetch MCP tool: extract specific page ranges from stored materials
- MCP tool count: 8 → 12 (= arkon parity; 4 new tools across P02 + P07)

#### Department admin UI (P08)
- Department admin UI: groups CRUD + group_note_kinds RBAC scope assignment
- `group_note_kinds` scope filter extends `compileScopeFilter` for per-group note-kind visibility
- Department-level taxonomy assignment without code changes

#### Structured logger + observability (P09)
- Structured logger (pino) replaces all `console.*` calls in `apps/wiki-team/*` (38 → 0)
- 14 redact paths: `*.api_key`, `*.api_key_plaintext`, `*.password`, `*.secret`, and 10 more
- Optional Sentry init (Bun-compat spike; log-only fallback if init fails)
- Audit log retention auto-cleanup cron: 12-month retention; small-batch DELETE; self-audit row carve-out

#### Better Auth + email-password (P10)
- Better Auth email-password adapter: `minPasswordLength 12`; `accountLinking` off
- OAuth email collision warning + no privilege escalation (S-6)

#### Test infrastructure expansion (P11)
- 5 middleware unit tests: auth, rbac-guard, audit-log, error-handler, if-match
- drizzle-zod single-source-of-truth CI assertion (12 tables covered)
- `@vitest/coverage-v8` wired with thresholds: rbac ≥ 70%, jobs ≥ 60%, mcp-host ≥ 60%, api ≥ 60%
- 7 new migrations (0005–0011): taxonomy color, provider_settings, material_images, audit cleanup metadata, embedding multi-dim, group_note_kinds (full sequence locked W1)

### Changed

- `console.*` → pino structured logger throughout server-side (`apps/wiki-team/*`): 38 → 0 calls
- `material.read` MCP tool: text extraction per MIME type (v2.0.1 fix preserved + vision caption append)
- Schema source-of-truth: Drizzle tables → drizzle-zod base → hand refinements (CI-enforced via assertion)
- pgvector column upgraded: single 768d `notes.embedding` → multi-dim router (768/1024/1536 columns)

### Fixed

- (none — additive release)

### Security

- HKDF + AES-GCM-256 provider key encryption (per-row HKDF salt; rotation epoch; keys never stored plaintext)
- `DEFAULT_ADMIN_PASSWORD` deleted from `process.env` after bootstrap (S-2)
- OAuth email collision: warning logged + no privilege escalation (S-6)
- Audit log: `actor_email_hmac` (HMAC-SHA256; raw email PII never stored)
- Vision opt-in default OFF globally (PII disclosure risk; opt-in per workspace)
- 14-path pino redact list: `*.api_key`, `*.api_key_plaintext`, `*.secret`, `*.password`, etc.

### Migration

- Run `bun run db:migrate` to apply migrations 0005–0011 (7 new migrations)
- Existing 768d Gemini embeddings preserved in `notes.embedding`; new materials use configured provider + correct dim column
- `DEFAULT_ADMIN_EMAIL` triggers only on first boot; idempotent thereafter; clears from process env after bootstrap
- New required env vars: `BETTER_AUTH_SECRET` (was optional placeholder), `WIKI_ENV` (staging/prod), `HKDF_SALT` (provider key encryption); see `docs/operations.md`
- Production logs are JSON; dev logs pretty-print (was stringified `console.log`)

### Notes

- v2.1 closes 9 user-facing parity gaps + 12 v2.1 tech-debt items vs v2.0.1
- Honest parity: 81% → 93% feature catalog / 56% → 85% workflow vs arkon
- Clean-room hygiene preserved (Mode A — no source read; ADR 009 holds)
- Anti-trace audit: 0 hits across 152 v2.1 files
- 222 unit/integration tests (post-W3) + 39 W4 tests = 261 total
- License: PolyForm-NC inherited; AGPL boundary at `packages/wiki-pdf-extract`
- Out of scope (deferred v2.2): graph viz, real-time websocket, drag-drop upload, full mobile UX, single-binary release, audit log viewer UI, K8s manifests

---

## [2.0.1] — 2026-05-06

**Patch release** addressing top-3 HIGH tech-debt items from the v2.0.0 release audit (`plans/reports/tech-debt-audit-260506-1646-v2-0-release.md`).

### Fixed

- **`material.read` MCP tool**: previously returned an empty excerpt despite being advertised as functional. Now reads raw bytes from MinIO via `storage_key` and extracts text per MIME type:
  - `text/plain`, `text/markdown` → UTF-8 decode
  - `application/pdf` → `@wiki-team/pdf-extract` (mupdf, AGPL boundary)
  - `text/html` → lightweight tag-strip + entity decode
  - other (DOCX, etc.) → `MIME_NOT_SUPPORTED` with pointer to `wiki.search`/`wiki.fetch`
- **wiki.recent performance**: added composite index `notes_workspace_updated_idx ON notes(workspace_id, updated_at DESC)` (migration 0004) so the per-workspace recency feed stays cheap as note count grows. Single-column `workspace_id` index alone forced an in-memory sort.

### Notes

- Migration 0004 is additive and reversible (`0004-perf-indexes.down.sql`); no data touched.
- Stale SQL comment in `drizzle/0003-init-rbac-jobs.up.sql:7` ("first 8 chars") was already corrected during W1 review (HMAC-SHA256 truncated 16 hex). Audit flagged it as residual; verified resolved.
- Remaining v2.1 backlog (29 items) tracked in tech-debt audit report; items are operational/observability/migration tooling, not correctness.

---

## [2.0.0] — 2026-05-06

**Two-product monorepo release.** Ships `apps/wiki-team/` (TS+Bun team wiki with RBAC + MCP) alongside frozen `apps/wiki-skills/` (v1.2 personal mode, MIT). Monorepo managed by Bun workspaces. 13 phases (P00–P12), ~409 files, ~21k LoC net additions.

> `apps/wiki-team/` and `packages/wiki-{schema,mcp,shared,pdf-extract}/` are licensed under **PolyForm Noncommercial 1.0.0**. See `LICENSE-NOTICE.md` and ADR 009.

### P00 — ADRs 007–012 (architecture decisions)

- **ADR 007**: TypeScript + Bun runtime for team mode; no Python in runtime path
- **ADR 008**: Monorepo structure with Bun workspaces (`apps/*` + `packages/*` + `apps/wiki-team/frontend-admin`)
- **ADR 009**: Arkon-derivative status under PolyForm Noncommercial 1.0.0; clean-room hygiene policy; AGPL boundary for `packages/wiki-pdf-extract` (MuPDF.js)
- **ADR 010**: RBAC dual-realm model — `<resource>.<verb>.<scope>` dot-format permission strings; 4-tier MembershipTier (observer/contributor/steward/owner); `kb`, `page`, `tenant`, `mcp` resources
- **ADR 011**: Sync architecture — optimistic concurrency with `version` column + 409 semantics; no CRDT in v2.0
- **ADR 012**: MCP exposure protocol — dual-transport (Streamable HTTP primary + SSE legacy 501 stub deferred v2.1); 8-tool surface with hardened Bearer auth

### P01 — Monorepo conversion + scaffold

- Bun workspaces root with `apps/*`, `packages/*`, `apps/wiki-team/frontend-admin` as named workspaces
- v1.2 personal mode relocated to `apps/wiki-skills/` (frozen; MIT license unchanged)
- `skills/` symlink at repo root preserves `npx skills add` backward compatibility
- `tsconfig.base.json` shared TypeScript configuration
- Anti-trace integration test: `tests/wiki-team/integration/test-anti-trace.sh` (canonical gate)

### P02 — `packages/wiki-schema/` shared types

- 8 Zod schema modules: workspace, note, material, mcp-token, job-status, audit, permission, group
- Permission parser enforcing `<resource>.<verb>.<scope>` dot-format
- 4-tier `MembershipTier` enum (observer / contributor / steward / owner)
- JSON Schema export via `bun run schema:export`

### P03 — Storage layer (Drizzle + Postgres + pgvector + MinIO)

- 14 Drizzle ORM tables: notes, materials, workspaces, members, users, groups, role_definitions, mcp_tokens, jobs, audit_events, and support tables
- Postgres 16 + pgvector(768) for semantic search (cosine distance + JSONB `?|` overlap)
- 3 migration pairs (0001–0003) with up/down scripts + `init-extensions.sql` (uuid-ossp, pgvector)
- `docker-compose.yml`: Postgres + Redis + MinIO services
- pgvector spike: PASS (cosine distance + JSONB array overlap verified)

### P04 — Auth + identity

- Better Auth wired with Drizzle adapter + Google OAuth + GitHub OAuth providers
- MCP token format: `wkt_<32 base62 chars>`; argon2id at rest; HMAC-SHA256 `prefix_lookup` column (16 hex chars) for O(1) lookup without exposing plaintext
- Constant-time verify path on prefix-miss / revoked / expired / format-invalid (no timing oracle)
- Rate limit: 10 token issuances per 24h per user via Redis `INCR` + step-up reauth ≤ 15 min window
- `Retry-After` header on 429 responses

### P05 — RBAC engine (dual-realm)

- Pure-function `evaluatePolicy` + DB-backed permission loaders
- Dual-realm evaluator: global permission strings + workspace-tier matrix
- `compileScopeFilter` returns typed Drizzle SQL fragment for use in queries (no N+1 policy checks)
- Both session-cookie and Bearer-token auth paths populate `AuthContext.permissions`
- 28 contract tests: permission matrix coverage + scope filter variants + pure-function purity

### P06 — Wiki-compile worker (BullMQ agent loop)

- BullMQ worker with agent loop: `STEP_BUDGET=30`, `MATERIAL_EXCERPT_CAP=20000` chars
- 7 tools: `listCatalog`, `searchNotes`, `readNote`, `excerptMaterial` (XML-wrapped untrusted content), `upsertNote`, `linkNotes`, `complete`
- 3 material extractors: PDF (MuPDF.js via `packages/wiki-pdf-extract` AGPL boundary), DOCX (mammoth), URL (Mozilla Readability)
- Cost meter: Redis `INCR` atomic per-workspace daily UTC key (multi-container safe)
- Recursion guard: `WIKI_COMPILE_INTERNAL_INVOCATION=1` env var (prevents re-entrant compile)
- `__catalog` rebuild mutex: Redis `SETNX` pattern
- Idempotency triple-key: `material_id × prompt_version_id × scope_filter_hash`
- System prompt v1.md: fresh-authored via clean-room protocol (user review gate signed off)

### P07 — MCP exposure (`packages/wiki-mcp/`)

- `packages/wiki-mcp/` primitives: `defineTool`, `mcpAuthMiddleware`, `errorMapper`
- Dual-transport: Streamable HTTP (primary, current MCP spec) + SSE legacy fallback (501 stub; full SSE deferred to v2.1)
- 8 tools: `wiki.search`, `wiki.fetch`, `wiki.catalog`, `wiki.recent`, `material.read`, `directory.lookup`, `workspace.info`, `note.crossrefs`
- Every tool calls `evaluatePolicy` + `compileScopeFilter` — no tool bypasses RBAC
- `directory.lookup` gated to admin-tier email allowlist
- Bearer token redacted from error context before surface to MCP client
- `apps/wiki-team/mcp-host/` — MCP HTTP server runtime wiring
- MCP system instructions: `system-instructions.md` fresh-authored (clean-room protocol; user review gate signed off)

### P08 — HTTP API + sync (Hono)

- Hono on Bun + `@hono/zod-openapi` + Swagger UI at `/docs` + OpenAPI spec at `/openapi.json`
- 25 endpoints across 8 route groups: workspaces, members, materials, notes, jobs, tokens, me, health
- Optimistic concurrency: atomic `UPDATE WHERE version = :expected` → 409 with `currentVersion` in response body
- Material upload sequence: Redis health-check FIRST → MinIO put → DB INSERT (no partial state)
- Token issuance: rate limit + step-up reauth enforcement + `Retry-After` header
- Audit log: `actor_email_hmac` (HMAC-SHA256 of email; no raw PII stored)
- `sanitizeObjectKey()` helper with 14 adversarial unit tests (path traversal, null bytes, unicode normalization)

### P09 — Next.js 15 admin frontend

- Next.js 15 App Router + shadcn/ui + Tailwind CSS + Better Auth client
- 10 routes: dashboard, workspace detail, members, materials, notes, MCP tokens, account settings, signin, OAuth callback, error
- 17 typed API client methods with ETag plumbing + `OptimisticConflictError`
- Token plaintext one-time display modal (copy-to-clipboard; shown once on issuance only)
- 409 conflict UX: reload-or-keep-editing choice presented to user
- Step-up reauth redirect + rate-limit feedback UI
- axe-core CLI accessibility check integrated

### P10 — Bridge integration (personal → team)

- `apps/wiki-skills/integrations/team-bridge/README.md`: zero-code wiring guide
- `apps/wiki-skills/integrations/team-bridge/example-claude-desktop.json`: annotated Claude Desktop config for `wkt_` bearer token
- `apps/wiki-skills/skills/wiki/references/team-bridge.md`: pointer from personal wiki skill
- Extended TypeScript bridge path deferred to v2.1

### P11 — Test infrastructure + CI

- Vitest harness: `vitest.config.ts` (unit) + `vitest.integration.config.ts` (integration with Postgres/Redis/MinIO)
- Coverage thresholds: rbac ≥ 70%, jobs ≥ 60%, mcp-host ≥ 60%
- 4 unit tests: cost-meter, prompt-loader, role-hierarchy, excerpt-material-injection
- Prompt regression test: SHA-256 hash pin on `system-prompt-v1.md` (detects accidental prompt drift)
- Test helpers: `createTestUser`, `createTestWorkspace`, `createTestMcpToken`, `mockLlmResponse`, `cleanupAll`
- 2 fixtures: `sample-material-shortest.md` (4 KB) + `sample-material-medium.md` (19 KB) — fictional content only
- 2 GitHub Actions CI workflows: `anti-trace.yml` (runs on every push) + `wiki-team-test.yml` (Postgres + Redis + MinIO service containers)
- Test totals: 28 RBAC + 6 wiki-compile/MCP contracts + 4 API + 14 unit + 1 prompt-regression = **53 tests**

---

## [1.2.0] — 2026-05-05

Last release of personal-mode-only era. v1.2 personal mode (`apps/wiki-skills/`) is **frozen** as of v2.0.0 monorepo conversion. Future personal-mode bug fixes go to `v1.2.x` patch tags only.

Full v1.2.0 entry in [`apps/wiki-skills/CHANGELOG-pre-v2.md`](apps/wiki-skills/CHANGELOG-pre-v2.md).
