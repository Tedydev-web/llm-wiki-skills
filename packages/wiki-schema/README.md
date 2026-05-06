# @wiki-team/schema

Shared Zod schemas and TypeScript types for the wiki-team monorepo.

This package is the **single source of truth** for all type shapes shared across
`apps/wiki-team` (server, jobs, MCP) and downstream consumers.

## Modules

| File | Exports | ADR ref |
|---|---|---|
| `permission.ts` | `PermissionGrant`, `parsePermission()` | ADR 010 |
| `workspace.ts` | `Workspace`, `Member`, `MembershipTier`, `SharedKbGrant` | ADR 010 |
| `note.ts` | `Note`, `PageTaxonomy`, `NoteUpdateInput`, sentinel slug constants | ADR 011 |
| `material.ts` | `Material`, `MaterialStatus` | ADR 011 |
| `mcp-token.ts` | `MCPToken`, `MCPTokenCreateInput`, `McpAccessContext` | ADR 012 |
| `job-status.ts` | `JobStatus`, `JobState`, `JobProgressResponse` | ADR 011 |
| `audit.ts` | `AuditEvent`, `AuditAction` | — |

## Usage

```ts
import { workspaceSchema, parsePermission, type Note } from '@wiki-team/schema';
```

## Security notes

- `MCPToken.tokenHash` is an argon2id hash — **never** a plain token value.
  There is no `tokenPlain` field by design.
- `parsePermission()` throws on malformed input; never returns a silent default.

## Vocabulary (ADR 010)

All type names in this package follow ADR 010 vocabulary.
See `docs/decisions/010-rbac-dual-realm.md` for the authoritative name list.

## DB schemas

`src/db/` is owned by P03 (Storage layer). Drizzle table definitions live there;
this package exports only Zod refinement schemas derived via `drizzle-zod`.
