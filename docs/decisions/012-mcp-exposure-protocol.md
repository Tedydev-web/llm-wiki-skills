---
adr: 012
title: MCP exposure protocol — dual-transport, 8-tool surface, hardened bearer auth
status: accepted
date: 2026-05-06
depends-on: [007, 010]
---

# 012 — MCP exposure protocol

## Context

Team mode must expose wiki knowledge to Claude via Model Context Protocol so that Claude
can search, fetch, and cross-reference pages without a browser session. The upstream
reference has 12 tools over a single SSE transport with plaintext token storage — three
areas we explicitly improve.

P07 implementers rely on this ADR alone. No other report is required.

## Decision

### Transport: dual — Streamable HTTP (primary) + SSE legacy fallback

**Primary:** Streamable HTTP transport per current MCP specification (2025-03-26).
Endpoint: `POST /mcp` with `Content-Type: application/json`. Supports both single-response
and streamed responses in one HTTP connection. Required for all new MCP clients.

**Fallback:** SSE (Server-Sent Events) transport for compatibility with older MCP clients
that predate the Streamable HTTP spec. Endpoint: `GET /mcp/sse` (event stream) +
`POST /mcp/messages` (client → server). The SSE path is maintained but not the primary
development target; it may be deprecated in v3.0.

Both transports share the same tool registry and auth middleware. Transport selection is
determined by the client's `Accept` header and initial handshake method, not server config.

### Bearer token auth

**Issuance:** MCP tokens are issued via `POST /auth/mcp-tokens` (steward or owner role
required per ADR 010). Each token is a random 32-byte URL-safe base64 string prefixed with
`wkt_` (wiki-team token). Full token: `wkt_<32-bytes-base64url>`.

**Storage (at-rest hardening):**

```
Stored in db.mcp_tokens row:
  prefix_lookup: HMAC-SHA256(fullToken, BETTER_AUTH_SECRET) truncated to 16 hex chars
                 — indexed unique; NO plaintext bits leak to disk
  token_hash:   argon2id(fullToken, { memoryCost: 65536, timeCost: 3, parallelism: 4 })
  workspace_id, granted_kb_ids, granted_page_types, expires_at, revoked_at
```

**Verification flow (constant-time, timing-oracle safe):**

```
function verifyMcpToken(presented: string): McpAccessContext | null:
  if not presented.startsWith("wkt_"):
    argon2id.verify(DUMMY_HASH, presented)   // constant-time burn; prevent prefix oracle
    return null

  lookup = HMAC-SHA256(presented, BETTER_AUTH_SECRET).slice(0, 16)
  row = db.mcpTokens.findByPrefixLookup(lookup)

  if row is null:
    argon2id.verify(DUMMY_HASH, presented)   // constant-time burn; prevent existence oracle
    return null

  if row.revokedAt != null OR row.expiresAt < now():
    argon2id.verify(DUMMY_HASH, presented)   // still burn; prevent timing leak on revoked
    return null

  match = argon2id.verify(row.tokenHash, presented)  // real verify
  if not match:
    return null

  return buildMcpAccessContext(row)          // see ADR 010 §MCP scope resolution
```

`DUMMY_HASH` is a pre-computed argon2id hash of a random fixed string, initialised at
server startup. It ensures the verify path always runs argon2id regardless of lookup result.

### Tool surface: 8 tools (consolidated from 12)

Source-mapping table — concept-level; no upstream tool names used:

| v2 tool | Consolidates / replaces | Rationale |
|---|---|---|
| `wiki.search` | semantic search + keyword search | Unified query; auto-selects vector or keyword path |
| `wiki.fetch` | single-note fetch + metadata | Metadata returned inline; one round-trip |
| `wiki.catalog` | index-listing | Paginated note list for a workspace; scoped by `AuthContext` |
| `wiki.recent` | recent-activity feed | Recently updated notes (replaces source-listing — more useful for AI clients) |
| `material.read` | source/material content fetch | Raw extracted text + outline; used for deep citation |
| `directory.lookup` | user directory | People search workspace-scoped; admin-tier required for email field |
| `workspace.info` | system + workspace metadata | Server capabilities + workspace settings + feature flags |
| `note.crossrefs` | graph/links | Outbound cross-references for a note |

**Vocabulary alignment with ADR 010:** material (not source), workspace (not tenant),
directory (not people/employees), note (not page) — keeps terminology coherent across
schemas, RBAC, and MCP tool surface. Reconciled in P07 implementation; this ADR
amended to match (2026-05-06 amendment).

**Dropped from upstream 12:** one placeholder/stub tool (no-op) and one internal-only
diagnostic tool — neither provided value to external MCP clients.

### Per-tool I/O contracts (Zod-shape pseudo-code)

| Tool | Key inputs | Key outputs | Errors |
|---|---|---|---|
| `wiki.search` | `query:string`, `workspaceId:uuid`, `topK:int(1-20)=5`, `mode:auto\|semantic\|keyword` | `notes[]{slug,title,excerpt,score}` | `WORKSPACE_NOT_FOUND`, `SCOPE_DENIED`, `EMBEDDING_UNAVAILABLE` |
| `wiki.fetch` | `slug:string`, `workspaceId:uuid`, `version?:int` | `{slug,title,content,version,kind,tags[],links[]}` | `NOTE_NOT_FOUND`, `SCOPE_DENIED`, `VERSION_NOT_FOUND` |
| `wiki.catalog` | `workspaceId:uuid`, `cursor?:string`, `limit:int(1-100)=50` | `{slugs[], nextCursor:string\|null, total:int}` | `WORKSPACE_NOT_FOUND`, `SCOPE_DENIED` |
| `wiki.recent` | `workspaceId:uuid`, `since?:datetime`, `limit:int(1-50)=20` | `notes[]{slug,title,updatedAt,kind}` | `WORKSPACE_NOT_FOUND`, `SCOPE_DENIED` |
| `material.read` | `materialId:uuid`, `pageRange?:{start,end}`, `maxChars:int≤40000=20000` | `{text:string, outline[]{heading,level,charOffset}}` | `MATERIAL_NOT_FOUND`, `SCOPE_DENIED`, `PAGE_RANGE_INVALID` |
| `directory.lookup` | `query:string(1-200)`, `workspaceId:uuid` | non-admin: `users[]{userId,displayName}`; admin: `users[]{userId,displayName,email}` | `SCOPE_DENIED`, `INSUFFICIENT_TIER` |
| `workspace.info` | `workspaceId:uuid` | `{workspaceId,displayName,memberCount,featureFlags{},embeddingModel}` | `WORKSPACE_NOT_FOUND`, `SCOPE_DENIED` |
| `note.crossrefs` | `slug:string`, `workspaceId:uuid`, `depth:int(1-3)=1` | `{nodes[]{slug,title}, edges[]{from,to,linkText}}` | `NOTE_NOT_FOUND`, `SCOPE_DENIED` |

All inputs validated by Zod at the transport layer before tool handler runs.
All outputs are JSON-serialisable; no binary blobs in tool responses.

### System instructions

The MCP server registers a system instructions string advising Claude:
> "Search wiki first (`wiki.search`). Fetch full note (`wiki.fetch`) only when excerpt
> is insufficient. Use `note.crossrefs` to find related concepts. Cite note slugs in answers."

## Consequences

**Positive:**
- Streamable HTTP primary transport is spec-current; SSE fallback avoids breaking old clients.
- argon2id at-rest + constant-time dummy verify closes the timing-oracle attack present in
  the upstream reference (plaintext storage).
- 8 tools vs 12: fewer tools means cleaner Claude tool-selection and less context window use.
- Per-tool Zod schemas are the source of truth for OpenAPI + runtime validation.

**Negative:**
- argon2id verify adds ~100 ms latency on cache miss — acceptable for token verify (once
  per request, not per tool call). Mitigate with short-lived in-memory verified-token cache
  (TTL = 60 s, LRU eviction, never persisted to disk).
- Maintaining dual transports doubles transport-layer test surface.

**Neutral:**
- `wkt_` prefix allows easy identification of wiki-team tokens in logs (redact after prefix).

## Alternatives rejected

- **Streamable HTTP only (drop SSE):** Breaks Claude Desktop and other clients still on SSE.
  Rejected until adoption of new spec is confirmed broad enough.
- **SSE only (keep legacy):** New spec is stable since 2025-03-26; building on a deprecated
  transport for primary path is wrong. Rejected.
- **Plaintext token storage:** Upstream approach — single DB compromise exposes all tokens.
  Rejected in favour of argon2id at rest.
- **JWT as MCP token:** JWTs are self-contained (no DB lookup), but revocation requires a
  deny-list anyway. argon2id-hashed opaque token + HMAC prefix-lookup is simpler and fully revocable.
- **12-tool surface (keep all):** Stub and internal-diagnostic tools add noise to Claude's
  tool selection. Consolidation improves LLM tool-use accuracy.

## References

- ADR 007: MCP SDK choice (`@modelcontextprotocol/sdk` v1.x)
- ADR 010: `McpAccessContext` definition + `resolveMcpScope` pseudo-code
- MCP specification (Streamable HTTP): https://modelcontextprotocol.io/specification
- P07 phase: MCP server implementation owns `apps/wiki-team/src/mcp/`
