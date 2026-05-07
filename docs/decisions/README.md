# Architecture Decision Records

All accepted decisions that govern this codebase. Implementers rely on ADRs as the
authoritative spec — no scout report or external reference required per decision.

## Index

| ADR | Title | Status |
|---|---|---|
| [001](001-clean-room-implementation.md) | Clean-room implementation, no upstream code copy | accepted |
| [002](002-pure-bash-jq-no-python.md) | Pure bash + jq for hook scripts, no Python/Node/SDK | accepted |
| [003](003-mkdir-lock-cross-platform.md) | mkdir-based atomic lock for concurrent hook fires | accepted |
| [004](004-defer-auto-compile-v1.2.md) | Defer auto-compile (hook → ingest) to v1.2 | accepted |
| [005](005-sidecar-schema-versioning.md) | Sidecar config schema-versioning with backward-compat migration | accepted |
| [006](006-auto-compile-architecture.md) | Auto-compile architecture — external scheduler, 3-layer recursion guard, hardened FS safety | accepted |
| [007](007-typescript-bun-team-mode.md) | TypeScript + Bun runtime for team mode (wiki-team) | accepted |
| [008](008-monorepo-structure.md) | Monorepo structure with Bun workspaces | accepted |
| [009](./009-arkon-derivative-status.md) | Derivative-work status and PolyForm-NC license inheritance | accepted |
| [010](010-rbac-dual-realm.md) | RBAC model — dual-realm with own permission vocabulary | accepted |
| [011](011-sync-architecture-optimistic.md) | Sync architecture — optimistic concurrency, no CRDT (v2.0) | accepted |
| [012](012-mcp-exposure-protocol.md) | MCP exposure protocol — dual-transport, 8-tool surface, hardened bearer auth | accepted |
| [013](013-multi-provider-llm.md) | Multi-provider LLM/embedding/vision abstraction — ProviderFactory + AES-GCM key storage | accepted |
| [014](014-knowledge-type-taxonomy.md) | Knowledge-type taxonomy — admin CRUD, color schema, MCP tools | accepted |
| [015](015-image-extraction-vision.md) | Image extraction + vision captioning — async BullMQ queue, cost caps, PII disclosure | accepted |

## Template

Each ADR follows: Context → Decision → Consequences → Alternatives rejected → References.
ADRs are frozen once accepted; amendments are dated inline.

## Dependency graph

```
001 ← 009
007 ← 008 ← 010 ← 012
                010 ← 013 ← 015
                010 ← 014
```
