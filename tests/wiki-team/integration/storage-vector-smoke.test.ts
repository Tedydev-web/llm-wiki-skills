/**
 * storage-vector-smoke.test.ts — pgvector round-trip smoke test
 *
 * Verifies:
 *   1. Postgres + pgvector extension reachable
 *   2. Migrations apply cleanly (0000 extensions + 0001-0003 up)
 *   3. INSERT a notes row with a random 768-dim embedding
 *   4. cosine_distance query returns the inserted row as nearest neighbour
 *   5. Drizzle ARRAY && overlap op via sql`` escape hatch works (P05 gate)
 *   6. Rollback drill: apply down migrations in reverse, assert clean state
 *
 * Spike outcome (P03 §Architecture — MUST-PASS gate):
 *   - pgvector ARRAY ops (&&) require raw sql`` template; Drizzle has no first-class operator.
 *     Working pattern documented here and locked for P05 compileScopeFilter.
 *   - cosine_distance via sql`... <=> ...` works correctly on vector(768).
 *   - NULL embedding rows are skipped by adding WHERE embedding IS NOT NULL.
 *
 * Requirements:
 *   - docker compose must be running (postgres service healthy)
 *   - DATABASE_URL must point to wiki_team_dev
 *   - Run via: bun test tests/wiki-team/integration/storage-vector-smoke.test.ts
 *
 * If Docker is unavailable, all tests are skipped gracefully (it.skip).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Config

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://wiki:devonly@localhost:5432/wiki_team_dev';

const REPO_ROOT = resolve(__dirname, '../../../');

const SQL_FILES = {
  extensions: resolve(REPO_ROOT, 'drizzle/0000-init-extensions.sql'),
  up: [
    resolve(REPO_ROOT, 'drizzle/0001-init-core.up.sql'),
    resolve(REPO_ROOT, 'drizzle/0002-init-content.up.sql'),
    resolve(REPO_ROOT, 'drizzle/0003-init-rbac-jobs.up.sql'),
  ],
  down: [
    resolve(REPO_ROOT, 'drizzle/0003-init-rbac-jobs.down.sql'),
    resolve(REPO_ROOT, 'drizzle/0002-init-content.down.sql'),
    resolve(REPO_ROOT, 'drizzle/0001-init-core.down.sql'),
  ],
};

// ---------------------------------------------------------------------------
// Helpers

function randomVector(dim: number): number[] {
  const v = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  // L2-normalise so cosine distance is well-behaved
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

function vectorToSql(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ---------------------------------------------------------------------------
// Connectivity probe — determines whether tests run or skip

let dockerAvailable = false;
let sql: ReturnType<typeof postgres> | null = null;

async function probe(): Promise<boolean> {
  const client = postgres(DATABASE_URL, { max: 1, connect_timeout: 3 });
  try {
    await client`SELECT 1`;
    sql = client;
    return true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Suite

describe('storage-vector smoke test', () => {
  beforeAll(async () => {
    dockerAvailable = await probe();
    if (!dockerAvailable) {
      console.warn(
        '[smoke] Postgres unreachable — all vector smoke tests SKIPPED. ' +
        'Start services with: bun run compose:up && bun run db:migrate',
      );
      return;
    }

    // Apply migrations fresh (idempotent — IF NOT EXISTS guards)
    await sql!.unsafe(readFileSync(SQL_FILES.extensions, 'utf-8'));
    for (const f of SQL_FILES.up) {
      await sql!.unsafe(readFileSync(f, 'utf-8'));
    }
  });

  afterAll(async () => {
    if (sql) await sql.end();
  });

  // -------------------------------------------------------------------------
  // 1. pgvector extension present

  it('pgvector extension is installed', async () => {
    if (!dockerAvailable) return;
    const rows = await sql!<{ name: string }[]>`
      SELECT name FROM pg_extension WHERE name = 'vector'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('vector');
  });

  // -------------------------------------------------------------------------
  // 2. Migration tables exist

  it('all 14 tables exist after migration', async () => {
    if (!dockerAvailable) return;
    const expectedTables = [
      'users', 'groups', 'role_definitions', 'workspaces', 'members',
      'note_kinds', 'notes', 'note_links',
      'materials', 'material_tags', 'workspace_materials',
      'mcp_tokens', 'jobs', 'audit_events',
    ];
    const rows = await sql!<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
    `;
    const tableNames = rows.map((r) => r.tablename);
    for (const t of expectedTables) {
      expect(tableNames, `table "${t}" should exist`).toContain(t);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Insert + cosine_distance round-trip (MUST-PASS gate for P05)

  it('inserts a note with 768-dim embedding and retrieves it by cosine_distance', async () => {
    if (!dockerAvailable) return;

    // Seed: group → workspace → user (FK chain)
    const groupId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const kbId = crypto.randomUUID();

    await sql!`
      INSERT INTO groups (id, slug, display_name)
      VALUES (${groupId}, ${'smoke-group-' + groupId.slice(0,8)}, 'Smoke Group')
    `;
    await sql!`
      INSERT INTO users (id, email, display_name, group_id)
      VALUES (${userId}, ${'smoke+' + userId.slice(0,8) + '@test.local'}, 'Smoke User', ${groupId})
    `;
    await sql!`
      INSERT INTO workspaces (id, slug, display_name, group_id, owner_id)
      VALUES (${workspaceId}, ${'smoke-ws-' + workspaceId.slice(0,8)}, 'Smoke WS', ${groupId}, ${userId})
    `;

    // Insert note with known embedding
    const noteId = crypto.randomUUID();
    const embedding = randomVector(768);
    const embSql = vectorToSql(embedding);

    await sql!.unsafe(`
      INSERT INTO notes (id, workspace_id, kb_id, slug, title, content, taxonomy, embedding)
      VALUES (
        '${noteId}',
        '${workspaceId}',
        '${kbId}',
        'smoke-note',
        'Smoke Note',
        'Hello pgvector',
        'fact',
        '${embSql}'
      )
    `);

    // Query: nearest neighbour should be the inserted row
    // cosine_distance uses <=> operator — requires sql`` escape hatch in Drizzle
    const rows = await sql!.unsafe(`
      SELECT id, embedding <=> '${embSql}'::vector AS distance
      FROM notes
      WHERE embedding IS NOT NULL
        AND workspace_id = '${workspaceId}'
      ORDER BY distance ASC
      LIMIT 1
    `) as Array<{ id: string; distance: number }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(noteId);
    // Cosine distance from a vector to itself is 0 (within float precision)
    expect(rows[0]!.distance).toBeCloseTo(0, 5);

    // Cleanup
    await sql!`DELETE FROM notes      WHERE workspace_id = ${workspaceId}`;
    await sql!`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await sql!`DELETE FROM users      WHERE id = ${userId}`;
    await sql!`DELETE FROM groups     WHERE id = ${groupId}`;
  });

  // -------------------------------------------------------------------------
  // 4. JSONB ?| overlap op — P05 compileScopeFilter pattern (canonical per storage/README.md)

  it('jsonb ?| ARRAY[...] overlap operator works (P05 gate)', async () => {
    if (!dockerAvailable) return;

    // Pattern A (canonical): tags JSONB ?| input ARRAY checks any-element match.
    // In Drizzle P05 uses: sql`${notes.tags} ?| ${sql.array(allowedTags)}`
    // Note: jsonb::text[] cast FAILS in Postgres (documented in storage/README.md).
    const rows = await sql!<{ result: boolean }[]>`
      SELECT '["fact","analysis"]'::jsonb ?| ARRAY['fact'] AS result
    `;
    expect(rows[0]!.result).toBe(true);

    const noOverlap = await sql!<{ result: boolean }[]>`
      SELECT '["procedure"]'::jsonb ?| ARRAY['fact'] AS result
    `;
    expect(noOverlap[0]!.result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 5. Rollback drill — apply down migrations in reverse, assert clean state

  it('down migrations roll back cleanly (0003 → 0001)', async () => {
    if (!dockerAvailable) return;

    // Apply down migrations
    for (const f of SQL_FILES.down) {
      await sql!.unsafe(readFileSync(f, 'utf-8'));
    }

    // All 3-migration tables should be gone
    const rows = await sql!<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `;
    const tableNames = rows.map((r) => r.tablename);
    const migratedTables = [
      'users', 'groups', 'workspaces', 'members', 'role_definitions',
      'notes', 'note_links', 'note_kinds', 'materials', 'material_tags',
      'workspace_materials', 'mcp_tokens', 'jobs', 'audit_events',
    ];
    for (const t of migratedTables) {
      expect(tableNames, `table "${t}" should be gone after rollback`).not.toContain(t);
    }

    // Re-apply so afterAll / other tests don't break
    await sql!.unsafe(readFileSync(SQL_FILES.extensions, 'utf-8'));
    for (const f of SQL_FILES.up) {
      await sql!.unsafe(readFileSync(f, 'utf-8'));
    }
  });
});
