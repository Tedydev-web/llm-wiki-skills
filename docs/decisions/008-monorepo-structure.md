---
adr: 008
title: Monorepo structure with Bun workspaces
status: accepted
date: 2026-05-06
depends-on: [007]
---

# 008 — Monorepo structure (Bun workspaces)

## Context

v1.2 (`apps/wiki-skills/`) ships as a standalone folder — users install via a single directory
copy. Introducing team mode (`apps/wiki-team/`) requires shared TypeScript types, shared MCP
primitives, and a shared utility library without duplicating code across two apps.

Two structural choices were evaluated: (a) separate repo for team mode, (b) extend current
repo as a monorepo. Brainstorm D6 locked option (b): single brand, shared schema, easier
cross-product changes. This ADR specifies the concrete monorepo layout and tooling.

## Decision

**Single monorepo extending `llm-wiki-skills` with Bun workspaces. No Turbo/Nx.**

### Directory layout

```
llm-wiki-skills/           ← repo root (existing)
├── apps/
│   ├── wiki-skills/       ← v1.2 personal mode (bash+jq) — moved from repo root
│   └── wiki-team/         ← v2.0 team mode (TS+Bun)
│       ├── src/
│       │   ├── server/    ← Hono HTTP API
│       │   ├── jobs/      ← BullMQ workers
│       │   ├── auth/      ← OAuth + session
│       │   ├── rbac/      ← RBAC evaluator (implements ADR 010)
│       │   ├── storage/   ← Drizzle + Postgres
│       │   └── mcp/       ← MCP server (implements ADR 012)
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── wiki-schema/       ← Shared Drizzle schemas + Zod types (TS)
│   ├── wiki-mcp/          ← Reusable MCP server primitives
│   └── wiki-shared/       ← Common utilities (slug, normalization, etc.)
├── tests/
│   ├── wiki-memory/       ← existing personal-mode tests (unchanged)
│   └── wiki-team/         ← new Vitest + testcontainers tests
├── docs/
├── plans/
├── package.json           ← workspace root (Bun workspaces)
└── tsconfig.base.json     ← shared TS compiler options
```

### Bun workspace config (root `package.json`)

```json
{
  "workspaces": [
    "apps/wiki-team",
    "packages/wiki-schema",
    "packages/wiki-mcp",
    "packages/wiki-shared"
  ]
}
```

`apps/wiki-skills/` is **not** in Bun workspaces — it is a standalone bash directory. Its
install path (`skills add Tedydev-web/llm-wiki-skills`) must continue to work without Bun.
The personal-mode skill resolves from `apps/wiki-skills/` via symlink or install-script path
rewrite (P01 determines the exact mechanism; this ADR does not prescribe it).

### Package naming convention

| Package dir | npm name | Description |
|---|---|---|
| `packages/wiki-schema` | `@wiki/schema` | Drizzle table defs, Zod contracts |
| `packages/wiki-mcp` | `@wiki/mcp` | MCP server factory, tool helpers |
| `packages/wiki-shared` | `@wiki/shared` | Slug, hash, date utilities |
| `apps/wiki-team` | `@wiki/team` | Main team-mode application |

### TypeScript config inheritance

`tsconfig.base.json` at root defines `strict: true`, `target: "ESNext"`, `moduleResolution:
"bundler"`. Each package/app extends it and sets `outDir` + `rootDir` locally. No global
`paths` aliases that cross package boundaries — imports use workspace protocol
(`"@wiki/schema": "workspace:*"`) resolved by Bun at install time.

### Turbo rejected

Turbo requires a separate `turbo.json` + `turbo` binary. For a monorepo with 3 packages and
1 app, the task-graph benefit is marginal. Bun's native `--filter` flag (`bun run --filter
'packages/*' build`) handles cross-package builds without an additional tool.
Decision: revisit Turbo if package count exceeds 8 or CI build times exceed 3 minutes.

## Consequences

**Positive:**
- Single `bun install` at root installs all packages.
- `@wiki/schema` shared by `wiki-team` server AND future `wiki-skills` TS migration path.
- v1.2 personal mode stays bash + zero TS tooling for end-users.
- `bun run --filter 'apps/wiki-team' dev` scopes dev server to team mode only.

**Negative:**
- `apps/wiki-skills/` is not in workspaces — contributors must understand the asymmetry.
- Moving existing `skills/wiki-memory/` into `apps/wiki-skills/` is a one-time migration
  that affects the install path (P01 handles this; risk: 1 broken install path if symlink
  strategy is wrong).

**Neutral:**
- `tsconfig.base.json` at root is new — must not conflict with existing scripts that do not
  use TypeScript. Currently there are none, so no immediate risk.

## Alternatives rejected

- **Separate repo for wiki-team:** Duplicates types and forces cross-repo version pinning.
  Brainstorm D6 explicitly rejected this.
- **npm workspaces (not Bun):** Bun is the chosen runtime (ADR 007); using npm workspaces
  would introduce npm as a second package manager. Inconsistency rejected.
- **pnpm workspaces:** Same inconsistency argument as npm. pnpm's `catalog:` protocol is
  useful for version pinning but not worth the additional tool.
- **Turbo (Turborepo):** Unnecessary for current scale; deferred as noted above.

## References

- Brainstorm D6: `plans/reports/brainstorm-260506-0807-*-team-mode-fork-port.md`
- ADR 007: TypeScript + Bun stack
- P01 phase: `plans/260506-0837-team-mode-v2-0/phase-01-monorepo-scaffold.md`
