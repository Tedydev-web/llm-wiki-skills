/**
 * embedding-multi-dim.test.ts — integration smoke test for 3-dim column routing.
 *
 * Requires: docker compose running (postgres + pgvector + migration 0009 applied).
 * Skips gracefully when Postgres unreachable.
 *
 * Tests:
 *   1. Migration 0009 columns exist: embedding_768, embedding_1024, embedding_1536
 *   2. Insert + cosine_distance round-trip for each dim column
 *   3. Same-dim cosine distance of a vector with itself is 0
 *   4. Other dim columns remain NULL when only one dim is written
 *   5. provider metadata columns (embedding_provider, embedding_model, embedding_dimensions) persist
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

const MIGRATION_UP_FILES = [
  resolve(REPO_ROOT, 'drizzle/0000-init-extensions.sql'),
  resolve(REPO_ROOT, 'drizzle/0001-init-core.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0002-init-content.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0003-init-rbac-jobs.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0004-perf-indexes.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0005-taxonomy-color.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0006-provider-settings.up.sql'),
  resolve(REPO_ROOT, 'drizzle/0009-embedding-multi-dim.up.sql'),
];

// ---------------------------------------------------------------------------
// Helpers

function randomVector(dim: number): number[] {
  const v = Array.from({ length: dim }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

function vecSql(v: number[]): string {
  return `[${v.join(',')}]`;
}

// ---------------------------------------------------------------------------
// DB probe

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

describe('embedding multi-dim migration + vector routing', () => {
  beforeAll(async () => {
    dockerAvailable = await probe();
    if (!dockerAvailable) {
      console.warn('[multi-dim] Postgres unreachable — all tests SKIPPED');
      return;
    }
    for (const f of MIGRATION_UP_FILES) {
      await sql!.unsafe(readFileSync(f, 'utf-8'));
    }
  });

  afterAll(async () => {
    if (sql) await sql.end();
  });

  // -------------------------------------------------------------------------
  // 1. Schema columns exist after 0009

  it('notes table has embedding_768, embedding_1024, embedding_1536 columns after 0009', async () => {
    if (!dockerAvailable) return;

    const rows = await sql!<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'notes'
        AND column_name IN ('embedding_768', 'embedding_1024', 'embedding_1536',
                            'embedding_provider', 'embedding_model', 'embedding_dimensions',
                            'embedding_updated_at')
      ORDER BY column_name
    `;

    const cols = rows.map((r) => r.column_name);
    expect(cols).toContain('embedding_768');
    expect(cols).toContain('embedding_1024');
    expect(cols).toContain('embedding_1536');
    expect(cols).toContain('embedding_provider');
    expect(cols).toContain('embedding_model');
    expect(cols).toContain('embedding_dimensions');
    expect(cols).toContain('embedding_updated_at');
  });

  it('original embedding column no longer exists (renamed to embedding_768)', async () => {
    if (!dockerAvailable) return;

    const rows = await sql!<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'notes' AND column_name = 'embedding'
    `;

    expect(rows).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2 & 3. 768-dim cosine distance round-trip

  it('inserts 768-dim vector and retrieves it by cosine_distance = 0', async () => {
    if (!dockerAvailable) return;

    const { noteId, workspaceId, groupId, userId, kbId } = await seedNote(sql!, '768');
    const vec = randomVector(768);

    await sql!.unsafe(`
      UPDATE notes SET
        embedding_768 = '${vecSql(vec)}',
        embedding_provider = 'google',
        embedding_model = 'text-embedding-004',
        embedding_dimensions = 768
      WHERE id = '${noteId}'
    `);

    const rows = await sql!.unsafe(`
      SELECT id, embedding_768 <=> '${vecSql(vec)}'::vector AS distance
      FROM notes
      WHERE workspace_id = '${workspaceId}'
        AND embedding_768 IS NOT NULL
      ORDER BY distance ASC
      LIMIT 1
    `) as Array<{ id: string; distance: number }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(noteId);
    expect(rows[0]!.distance).toBeCloseTo(0, 5);

    await cleanup(sql!, { noteId, workspaceId, groupId, userId, kbId });
  });

  // -------------------------------------------------------------------------
  // 4. 1024-dim cosine distance round-trip

  it('inserts 1024-dim vector and retrieves it by cosine_distance = 0', async () => {
    if (!dockerAvailable) return;

    const { noteId, workspaceId, groupId, userId, kbId } = await seedNote(sql!, '1024');
    const vec = randomVector(1024);

    await sql!.unsafe(`
      UPDATE notes SET
        embedding_1024 = '${vecSql(vec)}',
        embedding_provider = 'voyage',
        embedding_model = 'voyage-3-large',
        embedding_dimensions = 1024
      WHERE id = '${noteId}'
    `);

    const rows = await sql!.unsafe(`
      SELECT id, embedding_1024 <=> '${vecSql(vec)}'::vector AS distance
      FROM notes
      WHERE workspace_id = '${workspaceId}'
        AND embedding_1024 IS NOT NULL
      ORDER BY distance ASC
      LIMIT 1
    `) as Array<{ id: string; distance: number }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(noteId);
    expect(rows[0]!.distance).toBeCloseTo(0, 5);

    await cleanup(sql!, { noteId, workspaceId, groupId, userId, kbId });
  });

  // -------------------------------------------------------------------------
  // 5. 1536-dim cosine distance round-trip

  it('inserts 1536-dim vector and retrieves it by cosine_distance = 0', async () => {
    if (!dockerAvailable) return;

    const { noteId, workspaceId, groupId, userId, kbId } = await seedNote(sql!, '1536');
    const vec = randomVector(1536);

    await sql!.unsafe(`
      UPDATE notes SET
        embedding_1536 = '${vecSql(vec)}',
        embedding_provider = 'openai',
        embedding_model = 'text-embedding-3-small',
        embedding_dimensions = 1536
      WHERE id = '${noteId}'
    `);

    const rows = await sql!.unsafe(`
      SELECT id, embedding_1536 <=> '${vecSql(vec)}'::vector AS distance
      FROM notes
      WHERE workspace_id = '${workspaceId}'
        AND embedding_1536 IS NOT NULL
      ORDER BY distance ASC
      LIMIT 1
    `) as Array<{ id: string; distance: number }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(noteId);
    expect(rows[0]!.distance).toBeCloseTo(0, 5);

    await cleanup(sql!, { noteId, workspaceId, groupId, userId, kbId });
  });

  // -------------------------------------------------------------------------
  // 6. Other dim columns remain NULL when only one written

  it('other dim columns are NULL when only embedding_768 is written', async () => {
    if (!dockerAvailable) return;

    const { noteId, workspaceId, groupId, userId, kbId } = await seedNote(sql!, 'null-check');
    const vec = randomVector(768);

    await sql!.unsafe(`
      UPDATE notes SET
        embedding_768 = '${vecSql(vec)}',
        embedding_provider = 'google',
        embedding_model = 'text-embedding-004',
        embedding_dimensions = 768
      WHERE id = '${noteId}'
    `);

    const rows = await sql!<{ e1024: null; e1536: null }[]>`
      SELECT embedding_1024 AS e1024, embedding_1536 AS e1536
      FROM notes WHERE id = ${noteId}
    `;

    expect(rows[0]!.e1024).toBeNull();
    expect(rows[0]!.e1536).toBeNull();

    await cleanup(sql!, { noteId, workspaceId, groupId, userId, kbId });
  });

  // -------------------------------------------------------------------------
  // 7. Metadata columns persist correctly

  it('embedding metadata columns persist provider/model/dimensions', async () => {
    if (!dockerAvailable) return;

    const { noteId, workspaceId, groupId, userId, kbId } = await seedNote(sql!, 'meta');

    await sql!.unsafe(`
      UPDATE notes SET
        embedding_1024 = '${vecSql(randomVector(1024))}',
        embedding_provider = 'voyage',
        embedding_model = 'voyage-3-large',
        embedding_dimensions = 1024,
        embedding_updated_at = now()
      WHERE id = '${noteId}'
    `);

    const rows = await sql!<{
      embedding_provider: string;
      embedding_model: string;
      embedding_dimensions: number;
    }[]>`
      SELECT embedding_provider, embedding_model, embedding_dimensions
      FROM notes WHERE id = ${noteId}
    `;

    expect(rows[0]!.embedding_provider).toBe('voyage');
    expect(rows[0]!.embedding_model).toBe('voyage-3-large');
    expect(rows[0]!.embedding_dimensions).toBe(1024);

    await cleanup(sql!, { noteId, workspaceId, groupId, userId, kbId });
  });
});

// ---------------------------------------------------------------------------
// Seed helpers

async function seedNote(sql: ReturnType<typeof postgres>, suffix: string) {
  const groupId     = crypto.randomUUID();
  const userId      = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const kbId        = crypto.randomUUID();
  const noteId      = crypto.randomUUID();

  await sql`
    INSERT INTO groups (id, slug, display_name)
    VALUES (${groupId}, ${'mdim-grp-' + suffix.slice(0, 6)}, 'MDim Group')
  `;
  await sql`
    INSERT INTO users (id, email, display_name, group_id)
    VALUES (${userId}, ${'mdim+' + suffix + '@test.local'}, 'MDim User', ${groupId})
  `;
  await sql`
    INSERT INTO workspaces (id, slug, display_name, group_id, owner_id)
    VALUES (${workspaceId}, ${'mdim-ws-' + suffix.slice(0, 8)}, 'MDim WS', ${groupId}, ${userId})
  `;
  await sql.unsafe(`
    INSERT INTO notes (id, workspace_id, kb_id, slug, title, content, taxonomy, version)
    VALUES ('${noteId}', '${workspaceId}', '${kbId}', 'mdim-${suffix}', 'MDim Note', 'Hello', 'fact', 1)
  `);

  return { noteId, workspaceId, groupId, userId, kbId };
}

async function cleanup(
  sql: ReturnType<typeof postgres>,
  ids: { noteId: string; workspaceId: string; groupId: string; userId: string; kbId: string },
) {
  await sql`DELETE FROM notes      WHERE id = ${ids.noteId}`;
  await sql`DELETE FROM workspaces WHERE id = ${ids.workspaceId}`;
  await sql`DELETE FROM users      WHERE id = ${ids.userId}`;
  await sql`DELETE FROM groups     WHERE id = ${ids.groupId}`;
}
