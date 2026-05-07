/**
 * drizzle-zod-source-of-truth.test.ts — CI assertion: Drizzle table columns vs hand-authored Zod schemas.
 *
 * For each major Drizzle table, we derive a Zod schema via `createSelectSchema(table)` and
 * compare the key-set against the hand-authored Zod schema in packages/wiki-schema/src/*.
 * Purpose: catch future column additions/renames in schema.ts that drift from the hand-authored
 * Zod layer (which is the API serialization contract).
 *
 * Allowlisted differences (documented per table):
 *   - Timestamp columns: Drizzle yields z.date(), hand-authored yields z.string().datetime().
 *     These are intentional transformers at the API boundary — key presence is asserted, type is not.
 *   - notes.embedding: pgvector custom column — drizzle-zod emits `z.any()` for customType.
 *     Excluded from hand-authored schema (not serialized to clients). Allowlisted.
 *   - workspaces: hand-authored schema omits `ownerId` (workspace creator is implicit from auth context).
 *     Allowlisted — ownerId is present in DB but intentionally excluded from API response shape.
 *   - mcp_tokens: hand-authored `mcpTokenSchema` uses field `ownerId` (alias), DB uses `userId`.
 *     Allowlisted — explicit API renaming for clarity (ADR 012).
 *   - jobs (DB table): maps to jobStatusSchema which models BullMQ state, not raw DB row.
 *     job-status.ts uses `jobId` (BullMQ ID) rather than DB `id`/`bullJobId` split.
 *     Comparison is done on DB key-set; discrepancies documented below.
 *
 * Anti-trace: file name uses canonical vocabulary (drizzle-zod, not upstream naming).
 */

import { describe, it, expect } from 'vitest';
import { createSelectSchema } from 'drizzle-zod';

// Drizzle table definitions
import {
  users,
  groups,
  workspaces,
  members,
  notes,
  materials,
  mcpTokens,
  jobs,
  auditEvents,
  materialImages,
  noteKinds,
  providerSettings,
} from '../../../packages/wiki-schema/src/db/schema.js';

// Hand-authored Zod schemas
import {
  workspaceSchema,
  memberSchema,
} from '../../../packages/wiki-schema/src/workspace.js';
import { noteSchema } from '../../../packages/wiki-schema/src/note.js';
import { materialSchema } from '../../../packages/wiki-schema/src/material.js';
import { mcpTokenSchema } from '../../../packages/wiki-schema/src/mcp-token.js';
import { auditEventSchema } from '../../../packages/wiki-schema/src/audit.js';

// ---------------------------------------------------------------------------
// Helper: extract sorted key set from a Zod object shape or a Drizzle table's derived schema

function drizzleKeys(table: Parameters<typeof createSelectSchema>[0]): string[] {
  const derived = createSelectSchema(table);
  return Object.keys(derived.shape).sort();
}

function zodKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

// ---------------------------------------------------------------------------
// workspaces — hand-authored schema excludes `ownerId` (API design decision)

describe('drizzle-zod drift: workspaces', () => {
  it('hand-authored keys are a subset of DB columns (no stale keys)', () => {
    const dbKeys   = drizzleKeys(workspaces);
    const handKeys = zodKeys(workspaceSchema);
    // Every hand-authored key must exist in the DB table
    for (const key of handKeys) {
      expect(dbKeys, `key "${key}" missing from DB columns`).toContain(key);
    }
  });

  it('DB columns not in hand-authored schema are all allowlisted', () => {
    const dbKeys   = drizzleKeys(workspaces);
    const handKeys = new Set(zodKeys(workspaceSchema));
    // Allowlisted DB-only columns: ownerId (not exposed in API response shape)
    const allowlist = new Set(['ownerId']);
    const unexpected = dbKeys.filter((k) => !handKeys.has(k) && !allowlist.has(k));
    expect(unexpected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// members — full key-set match expected

describe('drizzle-zod drift: members', () => {
  it('hand-authored keys match DB columns (with datetime allowlist)', () => {
    const dbKeys   = drizzleKeys(members);
    const handKeys = zodKeys(memberSchema);
    // joinedAt appears in both — timestamps are allowlisted for type difference, not key presence
    for (const key of handKeys) {
      expect(dbKeys, `key "${key}" missing from DB columns`).toContain(key);
    }
    for (const key of dbKeys) {
      expect(handKeys, `DB key "${key}" not in hand-authored schema`).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// notes — embedding column excluded from API schema (custom pgvector type, not serialized)

describe('drizzle-zod drift: notes', () => {
  it('hand-authored keys are a subset of DB columns', () => {
    const dbKeys   = drizzleKeys(notes);
    const handKeys = zodKeys(noteSchema);
    for (const key of handKeys) {
      expect(dbKeys, `key "${key}" missing from DB columns`).toContain(key);
    }
  });

  it('DB-only columns are all allowlisted', () => {
    const dbKeys   = drizzleKeys(notes);
    const handKeys = new Set(zodKeys(noteSchema));
    // embedding: pgvector custom type — not serialized to API clients (ADR 011 / P05)
    const allowlist = new Set(['embedding']);
    const unexpected = dbKeys.filter((k) => !handKeys.has(k) && !allowlist.has(k));
    expect(unexpected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// materials — full key-set match

describe('drizzle-zod drift: materials', () => {
  it('hand-authored keys match DB columns', () => {
    const dbKeys   = drizzleKeys(materials);
    const handKeys = zodKeys(materialSchema);
    for (const key of handKeys) {
      expect(dbKeys, `key "${key}" missing from DB columns`).toContain(key);
    }
    for (const key of dbKeys) {
      expect(handKeys, `DB key "${key}" not in hand-authored schema`).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// mcp_tokens — hand-authored uses `ownerId`, DB column is `userId` (ADR 012 rename)

describe('drizzle-zod drift: mcp_tokens', () => {
  it('hand-authored keys are a subset of DB columns (with ownerId→userId rename allowlist)', () => {
    const dbKeys   = drizzleKeys(mcpTokens);
    const handKeys = zodKeys(mcpTokenSchema);
    // Allowlisted rename: hand-authored `ownerId` maps to DB `userId`
    const handKeysNormalized = handKeys.map((k) => (k === 'ownerId' ? 'userId' : k));
    for (const key of handKeysNormalized) {
      expect(dbKeys, `key "${key}" missing from DB columns (after rename allowlist)`).toContain(key);
    }
  });

  it('DB-only columns are all allowlisted', () => {
    const dbKeys   = drizzleKeys(mcpTokens);
    const handKeys = new Set(zodKeys(mcpTokenSchema).map((k) => (k === 'ownerId' ? 'userId' : k)));
    // No unexpected DB-only columns beyond the rename
    const unexpected = dbKeys.filter((k) => !handKeys.has(k));
    expect(unexpected).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// audit_events — full key-set match

describe('drizzle-zod drift: audit_events', () => {
  it('hand-authored keys match DB columns', () => {
    const dbKeys   = drizzleKeys(auditEvents);
    const handKeys = zodKeys(auditEventSchema);
    for (const key of handKeys) {
      expect(dbKeys, `key "${key}" missing from DB columns`).toContain(key);
    }
    for (const key of dbKeys) {
      expect(handKeys, `DB key "${key}" not in hand-authored schema`).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// No-drift smoke tests for tables without direct hand-authored equivalents
// Purpose: assert createSelectSchema() runs cleanly (no runtime error from custom types)

describe('drizzle-zod smoke: tables without hand-authored Zod equivalents', () => {
  it('users table: createSelectSchema produces expected keys', () => {
    const keys = drizzleKeys(users);
    expect(keys).toContain('id');
    expect(keys).toContain('email');
    expect(keys).toContain('displayName');
    expect(keys).toContain('passwordHash');
    expect(keys).toContain('groupId');
  });

  it('groups table: createSelectSchema produces expected keys', () => {
    const keys = drizzleKeys(groups);
    expect(keys).toContain('id');
    expect(keys).toContain('slug');
    expect(keys).toContain('displayName');
  });

  it('noteKinds table: createSelectSchema produces expected keys', () => {
    const keys = drizzleKeys(noteKinds);
    expect(keys).toContain('id');
    expect(keys).toContain('slug');
    expect(keys).toContain('color');
    expect(keys).toContain('isSystemDefault');
  });

  it('providerSettings table: createSelectSchema produces expected keys (v2.1 new table)', () => {
    const keys = drizzleKeys(providerSettings);
    expect(keys).toContain('id');
    expect(keys).toContain('workspaceId');
    expect(keys).toContain('capability');
    expect(keys).toContain('vendor');
    expect(keys).toContain('apiKeyEncrypted');
    expect(keys).toContain('encryptionMetadata');
  });

  it('jobs table: createSelectSchema produces expected keys', () => {
    const keys = drizzleKeys(jobs);
    expect(keys).toContain('id');
    expect(keys).toContain('bullJobId');
    expect(keys).toContain('state');
    expect(keys).toContain('progress');
    expect(keys).toContain('failedReason');
  });

  it('materialImages table: createSelectSchema produces expected keys (v2.1 new table)', () => {
    const keys = drizzleKeys(materialImages);
    expect(keys).toContain('id');
    expect(keys).toContain('materialId');
    expect(keys).toContain('caption');
    expect(keys).toContain('status');
    expect(keys).toContain('storageKey');
  });
});
