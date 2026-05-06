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
