---
adr: 010
title: RBAC model — dual-realm with own permission vocabulary
status: accepted
date: 2026-05-06
depends-on: [007]
---

# 010 — RBAC model (dual-realm)

## Context

Team mode requires multi-tenant access control across two concerns:
1. **Global / tenant level:** which resources (knowledge bases, wiki pages) a user may read
   or write based on their department or organisational scope.
2. **Workspace level:** what operations a user may perform inside a discrete workspace
   (project), based on their membership role.

These two concerns interact: a user with global read-all can view a workspace's wiki even
without explicit workspace membership. The model must be self-contained — P05 and P06
implementers rely solely on this ADR and must not need the scout report to understand the
vocabulary.

## Decision

### Realm 1 — Global permissions

Permission strings use the format: **`<resource>.<verb>.<scope>`**

**Resources:**

| Resource token | Covers |
|---|---|
| `kb` | Knowledge bases (document collections) |
| `page` | Individual wiki pages |
| `tenant` | Tenant-level settings and user management |
| `mcp` | MCP token issuance and revocation |

**Verbs:** `view`, `edit`, `delete`, `manage`

**Scopes:** `own` (same department/team as subject), `shared` (explicitly granted), `all` (unrestricted)

**Canonical permission set (define your own constants — do not hard-code strings):**

```
kb.view.own        — view knowledge bases in subject's department
kb.view.all        — view all knowledge bases (cross-department)
kb.edit.own        — create/update KBs in subject's department
kb.manage.all      — full KB administration
page.view.own      — read wiki pages scoped to subject's KBs
page.view.all      — read all wiki pages
page.edit.own      — create/update pages in owned KBs
page.edit.all      — create/update pages in any KB
page.delete.own    — delete pages in owned KBs
tenant.manage.all  — user, department, role CRUD (super-admin)
mcp.view.own       — read own MCP tokens
mcp.manage.all     — issue/revoke any MCP token
```

Permissions are stored as a JSON array on the `Role` record. A user may hold multiple roles.
Effective permissions = union of all role permission arrays.

### Realm 2 — Workspace roles

Four roles in strict hierarchy (lowest → highest privilege):

| Role token | Display name | Inherits from |
|---|---|---|
| `observer` | Observer | — |
| `contributor` | Contributor | observer |
| `steward` | Steward | contributor |
| `owner` | Owner | steward |

**Role capabilities (additive):**

| Capability | observer | contributor | steward | owner |
|---|:---:|:---:|:---:|:---:|
| View workspace wiki pages | ✓ | ✓ | ✓ | ✓ |
| Comment / annotate pages | — | ✓ | ✓ | ✓ |
| Create / edit wiki pages | — | ✓ | ✓ | ✓ |
| Upload sources / trigger ingest | — | — | ✓ | ✓ |
| Manage workspace membership | — | — | ✓ | ✓ |
| Delete workspace / transfer ownership | — | — | — | ✓ |

`owner` maps to global `kb.manage.all` within that workspace's scope only; it does not grant
tenant-level permissions unless the user also holds a global `tenant.manage.all` permission.

### Dual-realm decision logic (pseudo-code — no SQL)

```
function canAccessPage(subject, page, verb):
  // Realm 1: global permission check
  effectivePerms = union(subject.roles.map(r => r.permissions))

  scope = resolveScope(subject, page.knowledgeBaseId)
  // scope is one of: "own" | "shared" | "all"

  requiredGlobal = "page." + verb + "." + scope
  requiredAll    = "page." + verb + ".all"

  if effectivePerms.has(requiredGlobal) OR effectivePerms.has(requiredAll):
    return ALLOW

  // Realm 2: workspace membership check
  membership = WorkspaceMember.find(workspaceId: page.workspaceId, userId: subject.id)
  if membership is null:
    return DENY

  requiredRole = verbToMinRole(verb)
  // verbToMinRole: "view" → "observer", "edit" → "contributor", "delete" → "steward"
  if roleHierarchyRank(membership.role) >= roleHierarchyRank(requiredRole):
    return ALLOW

  return DENY


function resolveScope(subject, kbId):
  if subject.departmentId == KnowledgeBase.find(kbId).departmentId:
    return "own"
  if SharedKbGrant.exists(userId: subject.id, kbId: kbId):
    return "shared"
  return "all"   // signal: requires "all"-scope permission to proceed


function roleHierarchyRank(role):
  return { observer: 0, contributor: 1, steward: 2, owner: 3 }[role]
```

**MCP scope resolution** (for token-based requests without session):

```
function resolveMcpScope(mcpToken):
  token = McpToken.findByPrefix(mcpToken)   // prefix-indexed; see ADR 012
  if token is null OR token.revokedAt != null:
    return DENY

  return McpAccessContext {
    allowedKbIds:      token.grantedKbIds,
    allowedPageTypes:  token.grantedPageTypes,   // subset of page taxonomy
    workspaceId:       token.workspaceId,
  }
  // Callers apply MCP context as an additional AND filter on top of realm-1/2 checks
```

### Type signatures (Zod-compatible pseudo-code for P05)

```typescript
const GLOBAL_VERB    = z.enum(["view", "edit", "delete", "manage"]);
const GLOBAL_SCOPE   = z.enum(["own", "shared", "all"]);
const GLOBAL_RESOURCE = z.enum(["kb", "page", "tenant", "mcp"]);
const Permission     = z.template(`${GLOBAL_RESOURCE}.${GLOBAL_VERB}.${GLOBAL_SCOPE}`);
// Actual: z.string().regex(/^(kb|page|tenant|mcp)\.(view|edit|delete|manage)\.(own|shared|all)$/)

const MembershipTier  = z.enum(["observer", "contributor", "steward", "owner"]);

interface AccessSubject {
  id:           string;
  departmentId: string | null;
  roles:        Array<{ permissions: string[] }>;
}

interface WorkspaceMembership {
  userId:      string;
  workspaceId: string;
  role:        z.infer<typeof MembershipTier>;
}
```

## Consequences

**Positive:**
- Self-contained vocabulary: P05 implements this ADR without reading any other report.
- Dual-realm covers both fine-grained global access and coarse workspace roles with one
  decision function; no third layer needed for v2.0.
- MCP scope resolution is additive (AND filter), not a separate auth path.

**Negative:**
- Four workspace roles + permission string matrix adds onboarding complexity for new users.
- `resolveScope` requires a `SharedKbGrant` join table (P02/P05 schema work).

**Neutral:**
- Permission strings are validated by regex at write-time; invalid strings are rejected at
  the API boundary (Hono + Zod middleware), not silently ignored.

## Alternatives rejected

- **Single-realm (workspace roles only):** Cannot express cross-workspace read-all for power
  users (e.g., a global knowledge manager). Rejected.
- **ABAC (attribute-based):** More expressive but far higher implementation complexity for
  v2.0 scope. Deferred post-v2.0 if demand materialises.
- **Casbin library:** Adds a dependency with its own DSL; the dual-realm logic is simple
  enough to implement directly without a policy engine library.

## References

- ADR 007: TypeScript + Bun stack (type system requirements)
- ADR 012: MCP exposure — uses `McpAccessContext` from this ADR
- P05 phase: RBAC implementation owns `apps/wiki-team/src/rbac/`
- P06 phase: wiki-compile reads `canAccessPage` + `resolveMcpScope`
