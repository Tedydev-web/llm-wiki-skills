/**
 * rbac-scope-filter-sql.test.ts — compileScopeFilter live DB integration test
 *
 * Skipped when SKIP_DB_TESTS=true or DATABASE_URL is not set.
 *
 * Seed layout:
 *   workspace A (WS_A):  3 materials  — users: alice (observer), bob (contributor)
 *   workspace B (WS_B):  2 materials  — users: carol (steward)
 *   global-admin user:   no workspace binding
 *
 * Expected visibility per compileScopeFilter(ctx, 'materials'):
 *   alice  → 3 rows  (WS_A member)
 *   bob    → 3 rows  (WS_A member)
 *   carol  → 2 rows  (WS_B member)
 *   admin  → 5 rows  (global-admin sees all)
 *   anon   → 0 rows  (no membership)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, schema } from '../../../apps/wiki-team/storage/db.js';
import { compileScopeFilter } from '../../../apps/wiki-team/rbac/scope-compiler.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Skip guard

const SKIP = !process.env['DATABASE_URL'] || process.env['SKIP_DB_TESTS'] === 'true';

// ---------------------------------------------------------------------------
// Stable test UUIDs (deterministic — avoids collision with production data)

const IDS = {
  WS_A:   '10000000-aaaa-0000-0000-000000000001',
  WS_B:   '10000000-bbbb-0000-0000-000000000002',
  ALICE:  '20000000-0000-0000-0000-000000000001',
  BOB:    '20000000-0000-0000-0000-000000000002',
  CAROL:  '20000000-0000-0000-0000-000000000003',
  ADMIN:  '20000000-0000-0000-0000-000000000099',
  ANON:   '20000000-0000-0000-0000-000000000000',
  KB_A:   '30000000-0000-0000-0000-000000000001',
  KB_B:   '30000000-0000-0000-0000-000000000002',
  MAT_A1: '40000000-0000-0000-0000-000000000001',
  MAT_A2: '40000000-0000-0000-0000-000000000002',
  MAT_A3: '40000000-0000-0000-0000-000000000003',
  MAT_B1: '40000000-0000-0000-0000-000000000004',
  MAT_B2: '40000000-0000-0000-0000-000000000005',
  GRP_A:  '50000000-0000-0000-0000-000000000001',
} as const;

// ---------------------------------------------------------------------------
// AuthContext stubs for each persona

function makeCtx(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: IDS.ANON,
    workspaceId: null,
    membershipTier: 'observer',
    permissions: [],
    source: 'session',
    ...overrides,
  };
}

const CTX_ALICE: AuthContext = makeCtx({ userId: IDS.ALICE, workspaceId: IDS.WS_A, membershipTier: 'observer' });
const CTX_BOB:   AuthContext = makeCtx({ userId: IDS.BOB,   workspaceId: IDS.WS_A, membershipTier: 'contributor' });
const CTX_CAROL: AuthContext = makeCtx({ userId: IDS.CAROL, workspaceId: IDS.WS_B, membershipTier: 'steward' });
const CTX_ADMIN: AuthContext = makeCtx({ userId: IDS.ADMIN, workspaceId: null,     membershipTier: 'global-admin' });
const CTX_ANON:  AuthContext = makeCtx({ userId: IDS.ANON,  workspaceId: null,     membershipTier: 'observer' });

// ---------------------------------------------------------------------------
// Setup / teardown

beforeAll(async () => {
  if (SKIP) return;
  const db = getDb();

  // Groups
  await db.insert(schema.groups).values({
    id: IDS.GRP_A, slug: 'test-grp-a', displayName: 'Test Group A',
  }).onConflictDoNothing();

  // Users
  await db.insert(schema.users).values([
    { id: IDS.ALICE, email: 'alice@test.local', displayName: 'Alice Test', groupId: IDS.GRP_A },
    { id: IDS.BOB,   email: 'bob@test.local',   displayName: 'Bob Test',   groupId: IDS.GRP_A },
    { id: IDS.CAROL, email: 'carol@test.local',  displayName: 'Carol Test', groupId: null },
    { id: IDS.ADMIN, email: 'admin@test.local',  displayName: 'Admin Test', groupId: null },
  ]).onConflictDoNothing();

  // Workspaces
  await db.insert(schema.workspaces).values([
    { id: IDS.WS_A, slug: 'test-ws-a', displayName: 'Test WS A', ownerId: IDS.ALICE },
    { id: IDS.WS_B, slug: 'test-ws-b', displayName: 'Test WS B', ownerId: IDS.CAROL },
  ]).onConflictDoNothing();

  // Members
  await db.insert(schema.members).values([
    { workspaceId: IDS.WS_A, userId: IDS.ALICE, tier: 'observer' },
    { workspaceId: IDS.WS_A, userId: IDS.BOB,   tier: 'contributor' },
    { workspaceId: IDS.WS_B, userId: IDS.CAROL,  tier: 'steward' },
  ]).onConflictDoNothing();

  // Materials
  await db.insert(schema.materials).values([
    { id: IDS.MAT_A1, workspaceId: IDS.WS_A, kbId: IDS.KB_A, fileName: 'a1.pdf', mimeType: 'application/pdf', storageKey: 'test/a1.pdf', dedupeKey: 'ingest:a1', uploadedBy: IDS.ALICE },
    { id: IDS.MAT_A2, workspaceId: IDS.WS_A, kbId: IDS.KB_A, fileName: 'a2.pdf', mimeType: 'application/pdf', storageKey: 'test/a2.pdf', dedupeKey: 'ingest:a2', uploadedBy: IDS.ALICE },
    { id: IDS.MAT_A3, workspaceId: IDS.WS_A, kbId: IDS.KB_A, fileName: 'a3.pdf', mimeType: 'application/pdf', storageKey: 'test/a3.pdf', dedupeKey: 'ingest:a3', uploadedBy: IDS.BOB },
    { id: IDS.MAT_B1, workspaceId: IDS.WS_B, kbId: IDS.KB_B, fileName: 'b1.pdf', mimeType: 'application/pdf', storageKey: 'test/b1.pdf', dedupeKey: 'ingest:b1', uploadedBy: IDS.CAROL },
    { id: IDS.MAT_B2, workspaceId: IDS.WS_B, kbId: IDS.KB_B, fileName: 'b2.pdf', mimeType: 'application/pdf', storageKey: 'test/b2.pdf', dedupeKey: 'ingest:b2', uploadedBy: IDS.CAROL },
  ]).onConflictDoNothing();

  // workspace_materials junction
  await db.insert(schema.workspaceMaterials).values([
    { workspaceId: IDS.WS_A, materialId: IDS.MAT_A1, addedBy: IDS.ALICE },
    { workspaceId: IDS.WS_A, materialId: IDS.MAT_A2, addedBy: IDS.ALICE },
    { workspaceId: IDS.WS_A, materialId: IDS.MAT_A3, addedBy: IDS.BOB },
    { workspaceId: IDS.WS_B, materialId: IDS.MAT_B1, addedBy: IDS.CAROL },
    { workspaceId: IDS.WS_B, materialId: IDS.MAT_B2, addedBy: IDS.CAROL },
  ]).onConflictDoNothing();
});

afterAll(async () => {
  if (SKIP) return;
  const db = getDb();

  // Clean up in dependency order (FK-safe)
  await db.delete(schema.workspaceMaterials).where(
    eq(schema.workspaceMaterials.workspaceId, IDS.WS_A),
  );
  await db.delete(schema.workspaceMaterials).where(
    eq(schema.workspaceMaterials.workspaceId, IDS.WS_B),
  );
  await db.delete(schema.materials).where(eq(schema.materials.kbId, IDS.KB_A));
  await db.delete(schema.materials).where(eq(schema.materials.kbId, IDS.KB_B));
  await db.delete(schema.members).where(eq(schema.members.workspaceId, IDS.WS_A));
  await db.delete(schema.members).where(eq(schema.members.workspaceId, IDS.WS_B));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, IDS.WS_A));
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, IDS.WS_B));
  await db.delete(schema.users).where(eq(schema.users.email, 'alice@test.local'));
  await db.delete(schema.users).where(eq(schema.users.email, 'bob@test.local'));
  await db.delete(schema.users).where(eq(schema.users.email, 'carol@test.local'));
  await db.delete(schema.users).where(eq(schema.users.email, 'admin@test.local'));
  await db.delete(schema.groups).where(eq(schema.groups.id, IDS.GRP_A));

  await closeDb();
});

// ---------------------------------------------------------------------------
// Tests

describe.skipIf(SKIP)('compileScopeFilter — live DB row visibility', () => {
  it('alice (WS_A observer) sees exactly 3 materials', async () => {
    const db = getDb();
    const filter = compileScopeFilter(CTX_ALICE, 'materials');
    const rows = await db.select({ id: schema.materials.id })
      .from(schema.materials)
      .where(filter);
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(IDS.MAT_A1);
    expect(ids).toContain(IDS.MAT_A2);
    expect(ids).toContain(IDS.MAT_A3);
  });

  it('bob (WS_A contributor) sees exactly 3 materials', async () => {
    const db = getDb();
    const filter = compileScopeFilter(CTX_BOB, 'materials');
    const rows = await db.select({ id: schema.materials.id })
      .from(schema.materials)
      .where(filter);
    expect(rows).toHaveLength(3);
  });

  it('carol (WS_B steward) sees exactly 2 materials', async () => {
    const db = getDb();
    const filter = compileScopeFilter(CTX_CAROL, 'materials');
    const rows = await db.select({ id: schema.materials.id })
      .from(schema.materials)
      .where(filter);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(IDS.MAT_B1);
    expect(ids).toContain(IDS.MAT_B2);
  });

  it('global-admin sees all 5 materials', async () => {
    const db = getDb();
    const filter = compileScopeFilter(CTX_ADMIN, 'materials');
    const rows = await db.select({ id: schema.materials.id })
      .from(schema.materials)
      .where(filter);
    // At minimum sees the 5 seeded rows (other tests may have added more)
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  it('anonymous user (no membership) sees 0 materials', async () => {
    const db = getDb();
    const filter = compileScopeFilter(CTX_ANON, 'materials');
    const rows = await db.select({ id: schema.materials.id })
      .from(schema.materials)
      .where(filter);
    // Anonymous has no workspace_materials join — should return 0 seeded rows
    const seededIds = new Set(
      (Object.values(IDS) as string[]).filter((v) => v.startsWith('40000000')),
    );
    const seededVisible = rows.filter((r) => seededIds.has(r.id));
    expect(seededVisible).toHaveLength(0);
  });

  it('alice does NOT see WS_B materials', async () => {
    const db = getDb();
    const filter = compileScopeFilter(CTX_ALICE, 'materials');
    const rows = await db.select({ id: schema.materials.id })
      .from(schema.materials)
      .where(filter);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(IDS.MAT_B1);
    expect(ids).not.toContain(IDS.MAT_B2);
  });

  it('carol does NOT see WS_A materials', async () => {
    const db = getDb();
    const filter = compileScopeFilter(CTX_CAROL, 'materials');
    const rows = await db.select({ id: schema.materials.id })
      .from(schema.materials)
      .where(filter);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(IDS.MAT_A1);
    expect(ids).not.toContain(IDS.MAT_A2);
    expect(ids).not.toContain(IDS.MAT_A3);
  });
});
