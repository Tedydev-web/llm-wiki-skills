---
adr: 011
title: Sync architecture — optimistic concurrency, no CRDT (v2.0)
status: accepted
date: 2026-05-06
depends-on: [007, 008]
---

# 011 — Sync architecture (optimistic concurrency)

## Context

Team mode allows multiple users to edit wiki pages and ingest sources concurrently.
Two failure modes must be prevented:

1. **Silent overwrite:** User A reads page v3, User B saves page v4, User A saves back v3
   content without seeing B's changes. Last writer wins silently — data loss.
2. **Ingest race:** Two BullMQ workers pick up overlapping compile jobs for the same source
   and produce conflicting page states.

Three sync strategies were evaluated: pessimistic locking (SELECT FOR UPDATE), optimistic
concurrency (version column + 409), and CRDT (e.g., Yjs, Automerge). Scope and complexity
drove the decision.

## Decision

### Page edit: optimistic concurrency with version column

Every `wiki_pages`-equivalent table row carries a `version` integer column (starts at 1,
incremented on each update). Clients always send their read version with write requests.

**Update flow:**

```
PUT /workspaces/:wid/pages/:slug
Body: { content, version: N }

Server pseudo-code:
  current = db.page.findBySlug(slug, workspaceId)
  if current.version != N:
    return HTTP 409 { error: "conflict", currentVersion: current.version }
  db.page.update({ content, version: N + 1 })
  return HTTP 200 { version: N + 1 }
```

**Client conflict resolution policy (v2.0):** On 409, surface a diff UI showing the
server-current version vs the client's draft. The user chooses: overwrite, discard, or
merge manually. No automatic 3-way merge in v2.0 — deferred to v2.1+ if demand warrants.

**Version column rules:**
- Version is a non-nullable positive integer; never reset to 0 after creation.
- Version increments happen inside a single DB transaction with the content write.
- Soft deletes (`deleted_at` timestamp) do not increment version; hard deletes remove the row.

### Source ingest: BullMQ job deduplication

Each ingest job carries a `dedupeKey` = `"ingest:<sourceId>"`. BullMQ's built-in
deduplication (`jobId` uniqueness within the queue) prevents two identical jobs from
running concurrently. A recompile triggered while an ingest is in-flight is queued and
runs after the current job completes — not dropped.

**Progress tracking:** The BullMQ job updates a `progress` field (0–100 integer) on the
job record. The HTTP API exposes `GET /sources/:id/progress` which reads BullMQ job data
directly. Frontend polls at 2-second intervals while `status == "processing"`. No WebSocket
required for v2.0.

**Ingest failure handling:**
- Retry policy: 3 attempts with exponential backoff (1s, 5s, 25s).
- After 3 failures: job moves to Dead Letter Queue (DLQ); `source.status` set to `"failed"`.
- UI shows last error message from `job.failedReason` on the source detail page.

### CRDT deferred

Real-time collaborative editing (simultaneous keystroke sync) is NOT in v2.0 scope.
Reasons:
- CRDT libraries (Yjs, Automerge) require a persistent WebSocket server or y-websocket
  relay — significant operational complexity.
- Target users (small teams, async editing) have low collision frequency; optimistic
  concurrency with manual conflict resolution is sufficient for v2.0.
- CRDT evaluation scheduled for v2.1 if user research confirms real-time co-editing need.

### Version column schema sketch (for P02)

```typescript
// Drizzle pseudo-schema — P02 owns the real schema file
export const wikiPages = pgTable("wiki_pages", {
  id:          uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  slug:        varchar("slug", { length: 120 }).notNull(),
  content:     text("content").notNull().default(""),
  version:     integer("version").notNull().default(1),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
  deletedAt:   timestamp("deleted_at"),
});
// Unique constraint: (workspace_id, slug) WHERE deleted_at IS NULL
```

## Consequences

**Positive:**
- Zero additional infra: optimistic concurrency needs only a DB column — no Redis locks,
  no coordination service.
- 409 contract is explicit and testable: integration tests can simulate concurrent edits.
- BullMQ dedup is built-in; no custom semaphore needed for ingest races.

**Negative:**
- Concurrent edits on the same page produce 409s that users must resolve manually.
  High-collision scenarios (>2 simultaneous editors on same page) degrade UX.
- Polling every 2s is not real-time; ingest progress feels laggy on slow jobs. Acceptable
  for v2.0; upgrade to SSE progress stream in v2.1.

**Neutral:**
- Version column adds 4 bytes per row; negligible at expected page counts (<100k pages).

## Alternatives rejected

- **Pessimistic locking (SELECT FOR UPDATE):** Holds a DB lock for the entire edit session
  duration (minutes). Causes lock contention at >5 concurrent editors. Rejected.
- **CRDT (Yjs/Automerge):** Correct for real-time co-editing but over-engineered for
  async team wikis. Operational cost (WebSocket relay) not justified for v2.0. Deferred.
- **Timestamp-based last-writer-wins (no version):** Silent data loss on concurrent saves.
  Explicitly rejected — this is the exact failure mode we must prevent.
- **Event sourcing / append-only log:** Correct audit semantics but high implementation
  overhead; no upstream precedent in the codebase to build on. Deferred post-v2.0.

## References

- ADR 007: BullMQ job queue choice
- ADR 008: Monorepo structure (worker lives in `apps/wiki-team/src/jobs/`)
- P02 phase: schema package owns Drizzle table definitions
- P06 phase: wiki-compile worker implements ingest job + dedup key
