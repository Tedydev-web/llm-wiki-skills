---
adr: 007
title: TypeScript + Bun runtime for team mode (wiki-team)
status: accepted
date: 2026-05-06
extends: 002
---

# 007 — TypeScript + Bun for team mode

## Context

ADR 002 mandated pure bash + jq for hook scripts — constraint driven by zero-install-friction
and <2 s cold-start requirements for personal mode. Those constraints do not apply to the
team-mode server (`apps/wiki-team/`): it runs as a long-lived Bun process, not a Claude Code
hook.

Team mode requires a persistent HTTP server, background job queue, ORM with pgvector queries,
MCP server, and a typed API surface shared across packages. bash+jq cannot satisfy these.
Python was evaluated and rejected (ADR 002 rationale extended to new scope; see Alternatives).

Brainstorm D5 locked the decision: single JS/TS ecosystem for both API and client code.
Research report (researcher-260506-0827-ts-port-feasibility.md) validated stack choices and
confirmed 6-10 week effort estimate is viable.

## Decision

**Team mode (`apps/wiki-team/` + `packages/wiki-*/`) is TypeScript on Bun.** Personal mode
(`apps/wiki-skills/`) stays bash + jq — ADR 002 scope unchanged.

Stack:

| Layer | Choice | Version |
|---|---|---|
| Runtime | Bun | 1.3.10+ |
| HTTP | Hono | v4.x |
| ORM | Drizzle + Drizzle Kit | v0.28+ |
| Database | PostgreSQL 15+ | pgvector extension |
| Job queue | BullMQ (Redis) | v4.x |
| PDF ingestion | MuPDF.js (`mupdf` npm) | Latest |
| AI providers | @anthropic-ai/sdk, openai, @google/generative-ai | Latest stable |
| MCP SDK | @modelcontextprotocol/sdk | v1.x |
| Validation | Zod | v3.x |
| Tests | Vitest + testcontainers | v1.x |
| Binary | `bun build --compile` | Bun native |

**Governing rules (non-negotiable):**

1. No Python in `apps/wiki-team/` or `packages/wiki-*/` — ever. If a Python-only library is
   needed (e.g., PDF edge case), the only permitted pattern is a subprocess sidecar behind an
   interface adapter; the adapter must be covered by integration tests.
2. No runtime `any` escapes in public API signatures without an inline justification comment.
3. BullMQ uses Redis; bunqueue (SQLite-backed) is an accepted alternative iff the ops team
   explicitly rejects the Redis dependency. Decision must be recorded in a plan update.
4. MuPDF.js (`mupdf` npm) is AGPL. The AGPL obligation applies to `apps/wiki-team/` binary
   distribution — see ADR 009 for license implications.

## Consequences

**Positive:**
- Single JS/TS ecosystem: shared types from `packages/wiki-schema/` flow to both API and client.
- `bun build --compile` produces a ~60-80 MB self-contained binary; docker multi-stage builds
  reduce final image to scratch/alpine + binary.
- Hono + Zod generates OpenAPI automatically; no hand-written docs.
- Vitest watch mode (40 ms re-run) and testcontainers (ephemeral Postgres in CI) from day one.

**Negative:**
- BullMQ requires Redis as an external service (ops overhead vs SQLite-backed alternative).
- MuPDF.js AGPL binds binary distribution to AGPL; users redistributing compiled binary must
  comply (acceptable under D1 open-source non-commercial vision).
- Bun 1.3.10+ required; older environments unsupported (document in README).

**Neutral:**
- ADR 002 "no Python" rule now has two sub-scopes: personal (bash+jq always), team (TS+Bun).
  Contributing guide must document the boundary clearly.

## Alternatives rejected

- **Python + FastAPI:** Violates ADR 002 "no Python in shipping code".
  Clean-room TS derivation is the project's differentiation path (D3/D4 brainstorm).
- **Node.js (non-Bun) + Express:** Viable but ~4x slower cold start; no native TS support
  (requires ts-node or tsx); less lean than Bun for single-binary compilation.
- **Elysia (Bun-only HTTP):** Faster micro-benchmark but tighter Bun lock-in and smaller
  community than Hono. Hono's multi-runtime compatibility is preferred hedge.
- **Prisma ORM:** 40 KB client + 50 MB query engine binary; pgvector support added late (v5.x).
  Drizzle is lighter and ships pgvector natively.

## References

- ADR 002: Pure bash + jq (personal mode scope — unchanged)
- Brainstorm D5: `plans/reports/brainstorm-260506-0807-*-team-mode-fork-port.md`
- TS port feasibility: `plans/reports/researcher-260506-0827-ts-port-feasibility.md`
- ADR 009: Derivative-status + MuPDF.js AGPL implications
