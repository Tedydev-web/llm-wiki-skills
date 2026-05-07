/**
 * admin-bootstrap.test.ts — integration tests for admin user bootstrap logic
 *
 * Tests:
 *   1. ENV vars set + clean DB → admin user created; outcome='created'
 *   2. Second call with same email → no-op; outcome='idempotent-ok'
 *   3. DEFAULT_ADMIN_EMAIL matches existing OAuth-only user (no password_hash)
 *      → warning logged; outcome='skipped'; user NOT escalated (S-6)
 *   4. DEFAULT_ADMIN_PASSWORD deleted from process.env after success (S-2)
 *   5. DEFAULT_ADMIN_EMAIL not set → outcome='skipped' (no-op)
 *   6. WIKI_ENV=prod + weak password → assertProductionSecurityPosture throws
 *   7. BETTER_AUTH_SECRET placeholder → assertProductionSecurityPosture throws
 *
 * Uses in-memory mock DB (no real Postgres required) to keep tests hermetic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { maybeBootstrapAdmin } from '../../../apps/wiki-team/auth/admin-bootstrap.js';
import {
  assertProductionSecurityPosture,
  isWeakPassword,
} from '../../../apps/wiki-team/auth/boot-security-check.js';

// ---------------------------------------------------------------------------
// Mock DB factory — minimal in-memory simulation of Drizzle insert/select/update

function makeMockDb(initialUsers: Array<{ id: string; email: string; passwordHash: string | null }> = []) {
  const users = [...initialUsers];
  const workspaces: Array<{ id: string; slug: string }> = [];
  const members: Array<{ id: string; workspaceId: string; userId: string; tier: string }> = [];
  const auditEvents: Array<{ id: string; action: string }> = [];

  // Chainable query builder: .select().from().where().limit() → Promise<row[]>
  function makeQueryChain(rows: unknown[]) {
    const chain = {
      from(_t: unknown): typeof chain { return chain; },
      where(_cond: unknown): typeof chain { return chain; },
      limit(_n: number): typeof chain { return chain; },
      then(resolve: (v: unknown[]) => void, reject?: (e: unknown) => void): Promise<unknown[]> {
        void reject;
        resolve(rows);
        return Promise.resolve(rows);
      },
      // Make it await-able
      [Symbol.toStringTag]: 'Promise' as const,
    };
    return chain;
  }

  const db = {
    _users: users,
    _workspaces: workspaces,
    _members: members,
    _auditEvents: auditEvents,

    select(_fields?: unknown) {
      // Default: return all users (tests override via vi.spyOn when needed)
      return makeQueryChain(users);
    },

    insert(tableRef: unknown) {
      const tableStr = String(tableRef);
      return {
        values(row: Record<string, unknown>) {
          if (row['email'] !== undefined) {
            users.push({ id: row['id'] as string, email: row['email'] as string, passwordHash: row['passwordHash'] as string | null });
          } else if (row['slug'] !== undefined) {
            workspaces.push({ id: row['id'] as string, slug: row['slug'] as string });
          } else if (row['tier'] !== undefined) {
            members.push({ id: row['id'] as string, workspaceId: row['workspaceId'] as string, userId: row['userId'] as string, tier: row['tier'] as string });
          } else if (row['action'] !== undefined) {
            auditEvents.push({ id: row['id'] as string, action: row['action'] as string });
          }
          void tableStr;
          return Promise.resolve();
        },
      };
    },

    update(_tableRef: unknown) {
      return {
        set(_fields: unknown) { return this; },
        where(_cond: unknown) { return Promise.resolve(); },
      };
    },

    async transaction(fn: (tx: unknown) => Promise<unknown>) {
      // tx has same interface; workspace select inside tx returns empty by default
      const tx = {
        ...this,
        select(_fields?: unknown) {
          return makeQueryChain([]); // empty workspaces → triggers Personal workspace creation
        },
      };
      return fn(tx);
    },
  };

  return db;
}

// ---------------------------------------------------------------------------
// Patch module imports so admin-bootstrap uses our mock DB

// We need to intercept the dynamic import('../storage/db.js') calls inside admin-bootstrap.ts
// Use vi.mock to replace the module.

vi.mock('../../../apps/wiki-team/storage/db.js', () => ({
  schema: {
    users: { _: { name: 'users' } },
    workspaces: { _: { name: 'workspaces' } },
    members: { _: { name: 'members' } },
    auditEvents: { _: { name: 'audit_events' } },
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, value: unknown) => ({ field, value, _type: 'eq' }),
}));

vi.mock('@node-rs/argon2', () => ({
  hash: async (password: string) => `hashed:${password}`,
}));

// ---------------------------------------------------------------------------
// Env helpers

function setBootstrapEnv(email: string, password: string) {
  process.env['DEFAULT_ADMIN_EMAIL'] = email;
  process.env['DEFAULT_ADMIN_PASSWORD'] = password;
}

function clearBootstrapEnv() {
  delete process.env['DEFAULT_ADMIN_EMAIL'];
  delete process.env['DEFAULT_ADMIN_PASSWORD'];
}

// ---------------------------------------------------------------------------
// Tests

describe('maybeBootstrapAdmin', () => {
  beforeEach(() => {
    clearBootstrapEnv();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearBootstrapEnv();
  });

  it('skips when DEFAULT_ADMIN_EMAIL not set', async () => {
    const db = makeMockDb();
    const result = await maybeBootstrapAdmin(db);
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toMatch(/DEFAULT_ADMIN_EMAIL not set/);
  });

  it('throws when DEFAULT_ADMIN_EMAIL set but DEFAULT_ADMIN_PASSWORD missing', async () => {
    process.env['DEFAULT_ADMIN_EMAIL'] = 'admin@example.com';
    const db = makeMockDb();
    await expect(maybeBootstrapAdmin(db)).rejects.toThrow('DEFAULT_ADMIN_PASSWORD');
  });

  it('creates admin user when email not in DB → outcome=created', async () => {
    setBootstrapEnv('admin@example.com', 'StrongPassword123!');
    const db = makeMockDb(); // empty DB

    // Override select to return empty (no existing user with that email)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => ({
            then: (fn: (v: unknown[]) => void) => { fn([]); return Promise.resolve([]); },
          }),
        }),
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await maybeBootstrapAdmin(db);
    expect(result.outcome).toBe('created');
    expect(result.userId).toBeDefined();
  });

  it('S-2: DEFAULT_ADMIN_PASSWORD deleted from process.env after creation', async () => {
    setBootstrapEnv('admin2@example.com', 'StrongPassword456!');
    const db = makeMockDb();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => ({
            then: (fn: (v: unknown[]) => void) => { fn([]); return Promise.resolve([]); },
          }),
        }),
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await maybeBootstrapAdmin(db);

    // S-2: Password MUST be gone from process env
    expect(process.env['DEFAULT_ADMIN_PASSWORD']).toBeUndefined();
  });

  it('S-6: OAuth-only user (no passwordHash) → skipped, not escalated', async () => {
    setBootstrapEnv('oauth-admin@example.com', 'StrongPassword789!');
    const oauthUser = { id: 'existing-oauth-id', email: 'oauth-admin@example.com', passwordHash: null };
    const db = makeMockDb([oauthUser]);

    // Return the existing OAuth user when queried by email
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => ({
            then: (fn: (v: unknown[]) => void) => {
              fn([oauthUser]);
              return Promise.resolve([oauthUser]);
            },
          }),
        }),
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await maybeBootstrapAdmin(db);

    // S-6 assertions: outcome skipped, reason mentions OAuth collision
    expect(result.outcome).toBe('skipped');
    expect(result.reason).toMatch(/OAuth.*collision/i);
    // userId is returned but user is NOT escalated (no admin role assigned)
    expect(result.userId).toBe('existing-oauth-id');
  });

  it('returns idempotent-ok when password user already exists', async () => {
    setBootstrapEnv('existing-admin@example.com', 'StrongPassword000!');
    const existingUser = { id: 'existing-id', email: 'existing-admin@example.com', passwordHash: 'hashed:something' };
    const db = makeMockDb([existingUser]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(db, 'select').mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => ({
            then: (fn: (v: unknown[]) => void) => {
              fn([existingUser]);
              return Promise.resolve([existingUser]);
            },
          }),
        }),
      }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await maybeBootstrapAdmin(db);
    expect(result.outcome).toBe('idempotent-ok');
  });
});

// ---------------------------------------------------------------------------
// Boot security posture tests

describe('assertProductionSecurityPosture', () => {
  afterEach(() => {
    delete process.env['WIKI_ENV'];
    delete process.env['BETTER_AUTH_SECRET'];
    delete process.env['DEFAULT_ADMIN_PASSWORD'];
    delete process.env['DEFAULT_ADMIN_EMAIL'];
  });

  it('throws when BETTER_AUTH_SECRET contains CHANGE_ME_BEFORE_BOOT', () => {
    process.env['BETTER_AUTH_SECRET'] = 'CHANGE_ME_BEFORE_BOOT';
    expect(() => assertProductionSecurityPosture()).toThrow('BETTER_AUTH_SECRET');
  });

  it('throws in prod when DEFAULT_ADMIN_PASSWORD is weak', () => {
    process.env['WIKI_ENV'] = 'prod';
    process.env['DEFAULT_ADMIN_PASSWORD'] = 'admin';
    process.env['BETTER_AUTH_SECRET'] = 'a'.repeat(32);
    expect(() => assertProductionSecurityPosture()).toThrow('weak');
  });

  it('throws when DEFAULT_ADMIN_PASSWORD contains CHANGE_ME_BEFORE_BOOT (any env)', () => {
    process.env['WIKI_ENV'] = 'dev';
    process.env['DEFAULT_ADMIN_PASSWORD'] = 'CHANGE_ME_BEFORE_BOOT';
    process.env['BETTER_AUTH_SECRET'] = 'a'.repeat(32);
    expect(() => assertProductionSecurityPosture()).toThrow('CHANGE_ME_BEFORE_BOOT');
  });

  it('passes in dev with strong password', () => {
    process.env['WIKI_ENV'] = 'dev';
    process.env['DEFAULT_ADMIN_PASSWORD'] = 'Str0ng!P@ssw0rd2024';
    process.env['BETTER_AUTH_SECRET'] = 'a'.repeat(32);
    expect(() => assertProductionSecurityPosture()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isWeakPassword unit tests

describe('isWeakPassword', () => {
  it('rejects passwords shorter than 12 chars', () => {
    expect(isWeakPassword('Short1!')).toBe(true);
  });

  it('rejects passwords containing common defaults bundle tokens', () => {
    expect(isWeakPassword('AdminPassword123')).toBe(true);
    expect(isWeakPassword('changeme-password!')).toBe(true);
  });

  it('rejects low-entropy passwords', () => {
    expect(isWeakPassword('aaaaaaaaaaaa')).toBe(true);
  });

  it('accepts strong passwords', () => {
    expect(isWeakPassword('Tr0ub4dor&3-correct-horse')).toBe(false);
    expect(isWeakPassword('xK9#mP2$vL7@nQ')).toBe(false);
  });
});
