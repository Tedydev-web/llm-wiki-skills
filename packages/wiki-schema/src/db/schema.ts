/**
 * schema.ts — Drizzle ORM table definitions for wiki-team v2.0
 *
 * Anti-trace renaming (ADR 010 / phase-03):
 *   notes           ← wiki_pages (forbidden)
 *   note_links      ← wiki_links (forbidden)
 *   materials       ← sources (forbidden)
 *   material_tags   ← source_departments (forbidden)
 *   workspaces      ← projects (forbidden)
 *   members         ← project_members (forbidden)
 *   workspace_materials ← project_sources (forbidden)
 *   users           ← employees (forbidden)
 *   groups          ← departments (forbidden)
 *   role_definitions ← roles (forbidden)
 *   mcp_tokens      ← (standalone table; upstream stored as plain column — forbidden pattern)
 *   audit_events    ← audit_log (forbidden)
 *   note_kinds      ← knowledge_types (forbidden)
 *
 * Embedding dimension: 768 (Gemini text-embedding-004, ADR 011 / phase-03 spike confirmed).
 * Version column semantics: ADR 011 — starts at 1, never resets, incremented on content write.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  varchar,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// pgvector custom type — vector(768) for Gemini text-embedding-004 embeddings
// Drizzle does not ship a first-class vector type; raw SQL custom type is the
// documented escape hatch. ARRAY && ops also require sql`` template (P05 note).

const vector768 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(768)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Postgres returns e.g. "[0.1,0.2,...]"
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map(Number);
  },
});

// ---------------------------------------------------------------------------
// Shared column helpers

const pk = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const deletedAt = () =>
  timestamp('deleted_at', { withTimezone: true });

// ---------------------------------------------------------------------------
// 1. users — authenticated identities (renamed from employees)

export const users = pgTable(
  'users',
  {
    id:           pk(),
    email:        varchar('email', { length: 254 }).notNull(),
    displayName:  varchar('display_name', { length: 120 }).notNull(),
    avatarUrl:    text('avatar_url'),
    groupId:      uuid('group_id'),                  // FK → groups.id (nullable; set after creation)
    /** Hashed password (argon2id); null for OAuth-only users */
    passwordHash: text('password_hash'),
    createdAt:    createdAt(),
    updatedAt:    updatedAt(),
    deletedAt:    deletedAt(),
  },
  (t) => ({
    emailUidx:   uniqueIndex('users_email_uidx').on(t.email),
    groupIdIdx:  index('users_group_id_idx').on(t.groupId),
  }),
);

// ---------------------------------------------------------------------------
// 2. groups — org-level grouping for RBAC scope (renamed from departments)

export const groups = pgTable(
  'groups',
  {
    id:          pk(),
    slug:        varchar('slug', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    createdAt:   createdAt(),
    updatedAt:   updatedAt(),
    deletedAt:   deletedAt(),
  },
  (t) => ({
    slugUidx: uniqueIndex('groups_slug_uidx').on(t.slug),
  }),
);

// ---------------------------------------------------------------------------
// 3. role_definitions — custom roles with permission JSON (renamed from roles)

export const roleDefinitions = pgTable(
  'role_definitions',
  {
    id:          pk(),
    /** Machine-readable slug: e.g. "admin", "editor" */
    slug:        varchar('slug', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    /** JSON array of permission strings per ADR 010 format "<resource>.<verb>.<scope>" */
    permissions: jsonb('permissions').notNull().default(sql`'[]'::jsonb`),
    /** true = system-defined, false = user-created */
    isSystem:    boolean('is_system').notNull().default(false),
    createdAt:   createdAt(),
    updatedAt:   updatedAt(),
  },
  (t) => ({
    slugUidx: uniqueIndex('role_definitions_slug_uidx').on(t.slug),
  }),
);

// ---------------------------------------------------------------------------
// 4. workspaces — top-level multi-user project space (renamed from projects)

export const workspaces = pgTable(
  'workspaces',
  {
    id:          pk(),
    slug:        varchar('slug', { length: 64 }).notNull(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    groupId:     uuid('group_id'),                   // FK → groups.id (nullable)
    /** Owner user ID */
    ownerId:     uuid('owner_id').notNull(),
    createdAt:   createdAt(),
    updatedAt:   updatedAt(),
    deletedAt:   deletedAt(),
  },
  (t) => ({
    slugUidx:    uniqueIndex('workspaces_slug_uidx').on(t.slug),
    groupIdIdx:  index('workspaces_group_id_idx').on(t.groupId),
    ownerIdIdx:  index('workspaces_owner_id_idx').on(t.ownerId),
  }),
);

// ---------------------------------------------------------------------------
// 5. members — workspace membership (renamed from project_members)
// MembershipTier enum: observer | contributor | steward | owner (ADR 010 Realm 2)

export const members = pgTable(
  'members',
  {
    id:          pk(),
    workspaceId: uuid('workspace_id').notNull(),     // FK → workspaces.id
    userId:      uuid('user_id').notNull(),           // FK → users.id
    /** ADR 010 Realm 2 role: observer | contributor | steward | owner */
    tier:        varchar('tier', { length: 20 }).notNull(),
    invitedBy:   uuid('invited_by'),                 // FK → users.id (nullable)
    joinedAt:    timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    workspaceUserUidx: uniqueIndex('members_workspace_user_uidx').on(t.workspaceId, t.userId),
    userIdIdx:         index('members_user_id_idx').on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// 6. note_kinds — page-type taxonomy (renamed from knowledge_types)
// Four canonical kinds: fact | analysis | procedure | reference (ADR 010)

export const noteKinds = pgTable(
  'note_kinds',
  {
    id:          pk(),
    /** Canonical slug: fact | analysis | procedure | reference */
    slug:        varchar('slug', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 80 }).notNull(),
    description: text('description'),
    createdAt:   createdAt(),
  },
  (t) => ({
    slugUidx: uniqueIndex('note_kinds_slug_uidx').on(t.slug),
  }),
);

// ---------------------------------------------------------------------------
// 7. notes — compiled wiki pages (renamed from wiki_pages)
// version: ADR 011 — starts at 1, incremented on each content write, never resets

export const notes = pgTable(
  'notes',
  {
    id:          pk(),
    workspaceId: uuid('workspace_id').notNull(),     // FK → workspaces.id
    /** Knowledge base ID within the workspace */
    kbId:        uuid('kb_id').notNull(),
    slug:        varchar('slug', { length: 120 }).notNull(),
    title:       varchar('title', { length: 255 }).notNull(),
    content:     text('content').notNull().default(''),
    /** ADR 010: fact | analysis | procedure | reference */
    taxonomy:    varchar('taxonomy', { length: 20 }).notNull().default('fact'),
    /** Array of tag strings (stored as JSONB; ARRAY && ops via sql`` — see P05 note) */
    tags:        jsonb('tags').notNull().default(sql`'[]'::jsonb`),
    /** Array of linked page slugs (wikilinks) */
    links:       jsonb('links').notNull().default(sql`'[]'::jsonb`),
    /** Embedding vector for semantic search (Gemini text-embedding-004, 768 dim) */
    embedding:   vector768('embedding'),
    /** ADR 011: optimistic concurrency version; starts at 1, never 0 */
    version:     integer('version').notNull().default(1),
    createdAt:   createdAt(),
    updatedAt:   updatedAt(),
    deletedAt:   deletedAt(),
  },
  (t) => ({
    workspaceKbSlugUidx: uniqueIndex('notes_workspace_kb_slug_uidx').on(t.workspaceId, t.kbId, t.slug),
    workspaceIdIdx:      index('notes_workspace_id_idx').on(t.workspaceId),
    kbIdIdx:             index('notes_kb_id_idx').on(t.kbId),
    taxonomyIdx:         index('notes_taxonomy_idx').on(t.taxonomy),
    // wiki.recent ORDER BY updated_at — composite index keeps the per-workspace
    // recency feed cheap as note count grows (added in migration 0004 / v2.0.1).
    workspaceUpdatedIdx: index('notes_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
    // Vector index (IVFFlat) created separately in migration 0002 via raw SQL
    // as Drizzle does not support pgvector index types natively.
  }),
);

// ---------------------------------------------------------------------------
// 8. note_links — cross-references between notes (renamed from wiki_links)

export const noteLinks = pgTable(
  'note_links',
  {
    id:         pk(),
    /** Source note */
    fromNoteId: uuid('from_note_id').notNull(),      // FK → notes.id
    /** Target note (resolved slug) */
    toNoteId:   uuid('to_note_id').notNull(),        // FK → notes.id
    /** Wikilink text as authored (may differ from resolved title) */
    linkText:   varchar('link_text', { length: 255 }),
    createdAt:  createdAt(),
  },
  (t) => ({
    fromToUidx: uniqueIndex('note_links_from_to_uidx').on(t.fromNoteId, t.toNoteId),
    fromIdx:    index('note_links_from_idx').on(t.fromNoteId),
    toIdx:      index('note_links_to_idx').on(t.toNoteId),
  }),
);

// ---------------------------------------------------------------------------
// 9. materials — raw uploaded source documents (renamed from sources)

export const materials = pgTable(
  'materials',
  {
    id:           pk(),
    workspaceId:  uuid('workspace_id').notNull(),    // FK → workspaces.id
    kbId:         uuid('kb_id').notNull(),
    fileName:     varchar('file_name', { length: 255 }).notNull(),
    mimeType:     varchar('mime_type', { length: 100 }).notNull(),
    /** Object storage key (MinIO/S3 path) */
    storageKey:   text('storage_key').notNull(),
    sizeBytes:    integer('size_bytes').notNull().default(0),
    /** pending | processing | completed | failed */
    status:       varchar('status', { length: 20 }).notNull().default('pending'),
    /** BullMQ dedup key: "ingest:<id>" (ADR 011) */
    dedupeKey:    text('dedupe_key').notNull(),
    /** 0–100 progress from BullMQ worker */
    progress:     integer('progress').notNull().default(0),
    pageCount:    integer('page_count').notNull().default(0),
    failedReason: text('failed_reason'),
    uploadedBy:   uuid('uploaded_by').notNull(),     // FK → users.id
    createdAt:    createdAt(),
    updatedAt:    updatedAt(),
  },
  (t) => ({
    workspaceIdIdx:  index('materials_workspace_id_idx').on(t.workspaceId),
    kbIdIdx:         index('materials_kb_id_idx').on(t.kbId),
    statusIdx:       index('materials_status_idx').on(t.status),
    dedupeKeyUidx:   uniqueIndex('materials_dedupe_key_uidx').on(t.dedupeKey),
  }),
);

// ---------------------------------------------------------------------------
// 10. material_tags — material scope/tag assignment (renamed from source_departments)
//     Many-to-many: materials ↔ groups/tags

export const materialTags = pgTable(
  'material_tags',
  {
    id:         pk(),
    materialId: uuid('material_id').notNull(),       // FK → materials.id
    /** Tag label (e.g. a group slug or freeform tag) */
    tag:        varchar('tag', { length: 64 }).notNull(),
    createdAt:  createdAt(),
  },
  (t) => ({
    materialTagUidx: uniqueIndex('material_tags_material_tag_uidx').on(t.materialId, t.tag),
    tagIdx:          index('material_tags_tag_idx').on(t.tag),
  }),
);

// ---------------------------------------------------------------------------
// 11. workspace_materials — many-to-many: workspaces ↔ materials (renamed from project_sources)

export const workspaceMaterials = pgTable(
  'workspace_materials',
  {
    id:          pk(),
    workspaceId: uuid('workspace_id').notNull(),     // FK → workspaces.id
    materialId:  uuid('material_id').notNull(),      // FK → materials.id
    addedBy:     uuid('added_by').notNull(),         // FK → users.id
    addedAt:     timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    wsMaterialUidx: uniqueIndex('workspace_materials_ws_mat_uidx').on(t.workspaceId, t.materialId),
    wsIdx:          index('workspace_materials_ws_idx').on(t.workspaceId),
  }),
);

// ---------------------------------------------------------------------------
// 12. mcp_tokens — MCP bearer token table (ADR 012; own design, not from upstream)
//     tokenHash: argon2id at rest — NEVER stores plaintext
//     prefixLookup: HMAC-SHA256(fullToken, BETTER_AUTH_SECRET) truncated 16 hex — indexed unique

export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id:          uuid('id').primaryKey(),            // "wkt_<32+ alphanumeric>" pattern
    /** HMAC-SHA256(fullToken, BETTER_AUTH_SECRET) truncated to 16 hex chars — no plaintext bits */
    prefixLookup: varchar('prefix_lookup', { length: 64 }).notNull(),
    /** argon2id hash of the full token (ADR 012: NEVER plaintext) */
    tokenHash:   text('token_hash').notNull(),
    userId:      uuid('user_id').notNull(),           // FK → users.id (token owner)
    workspaceId: uuid('workspace_id').notNull(),     // FK → workspaces.id
    /** JSONB array of PermissionGrant objects per ADR 010 */
    scopes:      jsonb('scopes').notNull().default(sql`'[]'::jsonb`),
    /** JSONB array of UUID strings (granted KB IDs) */
    grantedKbIds: jsonb('granted_kb_ids').notNull().default(sql`'[]'::jsonb`),
    /** JSONB array of taxonomy strings */
    grantedPageTypes: jsonb('granted_page_types').notNull().default(sql`'[]'::jsonb`),
    expiresAt:   timestamp('expires_at', { withTimezone: true }),
    revokedAt:   timestamp('revoked_at', { withTimezone: true }),
    createdAt:   createdAt(),
  },
  (t) => ({
    prefixLookupUidx: uniqueIndex('mcp_tokens_prefix_lookup_uidx').on(t.prefixLookup),
    userIdIdx:        index('mcp_tokens_user_id_idx').on(t.userId),
    workspaceIdIdx:   index('mcp_tokens_workspace_id_idx').on(t.workspaceId),
  }),
);

// ---------------------------------------------------------------------------
// 13. jobs — BullMQ job tracking rows (mirrors BullMQ state for HTTP polling)

export const jobs = pgTable(
  'jobs',
  {
    id:           pk(),
    /** BullMQ queue name: "ingest" | "recompile" */
    queueName:    varchar('queue_name', { length: 64 }).notNull(),
    /** External BullMQ job ID */
    bullJobId:    text('bull_job_id').notNull(),
    materialId:   uuid('material_id').notNull(),     // FK → materials.id
    workspaceId:  uuid('workspace_id').notNull(),
    /** waiting | active | completed | failed | delayed | paused */
    state:        varchar('state', { length: 20 }).notNull().default('waiting'),
    /** 0–100 progress integer */
    progress:     integer('progress').notNull().default(0),
    attemptsMade: integer('attempts_made').notNull().default(0),
    maxAttempts:  integer('max_attempts').notNull().default(3),
    failedReason: text('failed_reason'),
    enqueuedAt:   timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt:   timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    bullJobIdUidx:  uniqueIndex('jobs_bull_job_id_uidx').on(t.bullJobId),
    materialIdIdx:  index('jobs_material_id_idx').on(t.materialId),
    workspaceIdIdx: index('jobs_workspace_id_idx').on(t.workspaceId),
    stateIdx:       index('jobs_state_idx').on(t.state),
  }),
);

// ---------------------------------------------------------------------------
// 14. audit_events — immutable append-only audit trail (renamed from audit_log)

export const auditEvents = pgTable(
  'audit_events',
  {
    id:           pk(),
    workspaceId:  uuid('workspace_id').notNull(),
    /** Actor who triggered the event; null for system/worker events */
    actorId:      uuid('actor_id'),
    /** Audit action string: e.g. "note.created", "mcp_token.issued" */
    action:       varchar('action', { length: 60 }).notNull(),
    resourceType: varchar('resource_type', { length: 30 }).notNull(),
    resourceId:   uuid('resource_id').notNull(),
    /** Arbitrary JSON: before/after state, context */
    payload:      jsonb('payload'),
    ipAddress:    varchar('ip_address', { length: 45 }),
    createdAt:    createdAt(),
  },
  (t) => ({
    workspaceIdIdx: index('audit_events_workspace_id_idx').on(t.workspaceId),
    actorIdIdx:     index('audit_events_actor_id_idx').on(t.actorId),
    resourceIdx:    index('audit_events_resource_idx').on(t.resourceType, t.resourceId),
    createdAtIdx:   index('audit_events_created_at_idx').on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Export all tables for Drizzle Kit and db.ts

export type Schema = {
  users: typeof users;
  groups: typeof groups;
  roleDefinitions: typeof roleDefinitions;
  workspaces: typeof workspaces;
  members: typeof members;
  noteKinds: typeof noteKinds;
  notes: typeof notes;
  noteLinks: typeof noteLinks;
  materials: typeof materials;
  materialTags: typeof materialTags;
  workspaceMaterials: typeof workspaceMaterials;
  mcpTokens: typeof mcpTokens;
  jobs: typeof jobs;
  auditEvents: typeof auditEvents;
};
