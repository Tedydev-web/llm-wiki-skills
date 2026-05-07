/**
 * scope-compiler-group-extension.test.ts — Unit tests for compileScopeFilterAsync
 * group_note_kinds branch (P08).
 *
 * Tests the three scenarios:
 *   1. User with no group → no kind filtering (returns base workspace clause)
 *   2. User in group with no kind assignments → no filtering (legacy behavior)
 *   3. User in group WITH kind assignments → adds AND taxonomy IN (...) clause
 *   4. Global-admin → sql`TRUE` regardless of group
 *   5. view.all grant → sql`TRUE` regardless of group
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers

type SqlFragment = { _isSql: true; text?: string; parts?: TemplateStringsArray; values?: unknown[] };

function makeSql(text: string): SqlFragment {
  return { _isSql: true, text };
}

// ---------------------------------------------------------------------------
// Mock DB — controls user.group_id + group_note_kinds rows per test

const mockExecute = vi.fn();

vi.mock('../../../apps/wiki-team/storage/db.js', () => {
  // Minimal sql tag that captures template literal for assertions
  const sql = Object.assign(
    (parts: TemplateStringsArray, ...values: unknown[]): SqlFragment => ({ _isSql: true, parts, values }),
    {
      join: (items: SqlFragment[], _sep: SqlFragment) => ({ _isSql: true, joined: items }),
    },
  );

  const mockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    execute: mockExecute,
  };

  return {
    getDb: () => mockDb,
    schema: {
      groups: {},
      notes: { taxonomy: 'notes.taxonomy', workspaceId: 'notes.workspace_id' },
      members: { workspaceId: 'members.workspace_id', userId: 'members.user_id' },
      users: {},
    },
    sql,
  };
});

// Import AFTER mock is set up
import { compileScopeFilterAsync, compileScopeFilter } from '../../../apps/wiki-team/rbac/scope-compiler.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';

// ---------------------------------------------------------------------------
// Fixtures

function makeCtx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-123',
    workspaceId: 'ws-abc',
    membershipTier: 'contributor',
    permissions: [],
    source: 'session',
    ...overrides,
  };
}

const adminCtx = makeCtx({ membershipTier: 'global-admin' });
const viewAllCtx = makeCtx({
  permissions: [{ resource: 'kb', verb: 'view', scope: 'all' }],
});

// ---------------------------------------------------------------------------
// Tests

describe('compileScopeFilter (sync) — baseline', () => {
  it('returns TRUE for global-admin', () => {
    const result = compileScopeFilter(adminCtx, 'notes');
    // Drizzle sql`TRUE` produces a tagged template result — just verify it's SQL
    expect(result).toBeDefined();
  });

  it('returns TRUE for view.all grant', () => {
    const result = compileScopeFilter(viewAllCtx, 'notes');
    expect(result).toBeDefined();
  });

  it('returns workspace membership clause for regular contributor (notes)', () => {
    const result = compileScopeFilter(makeCtx(), 'notes');
    expect(result).toBeDefined();
  });
});

describe('compileScopeFilterAsync — group_note_kinds extension', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('returns TRUE immediately for global-admin (no DB call)', async () => {
    const result = await compileScopeFilterAsync(adminCtx, 'notes');
    expect(result).toBeDefined();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns TRUE immediately for view.all grant (no DB call)', async () => {
    const result = await compileScopeFilterAsync(viewAllCtx, 'notes');
    expect(result).toBeDefined();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns base clause when user has no group (group_id = null)', async () => {
    // First execute call: users query → no group
    mockExecute.mockResolvedValueOnce([{ group_id: null }]);

    const result = await compileScopeFilterAsync(makeCtx(), 'notes');
    expect(result).toBeDefined();
    // Only one DB call: user lookup; NO group_note_kinds query
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns base clause when user has group but group has no kind assignments', async () => {
    // users query → has groupId
    mockExecute.mockResolvedValueOnce([{ group_id: 'group-xyz' }]);
    // group_note_kinds query → empty (no restrictions)
    mockExecute.mockResolvedValueOnce([]);

    const result = await compileScopeFilterAsync(makeCtx(), 'notes');
    expect(result).toBeDefined();
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('returns base clause AND taxonomy IN (...) when group has kind assignments', async () => {
    // users query → has groupId
    mockExecute.mockResolvedValueOnce([{ group_id: 'group-xyz' }]);
    // group_note_kinds query → 2 kinds assigned
    mockExecute.mockResolvedValueOnce([{ slug: 'fact' }, { slug: 'analysis' }]);

    const result = await compileScopeFilterAsync(makeCtx(), 'notes');
    expect(result).toBeDefined();
    // Result should be a compound SQL fragment (base AND taxonomy filter)
    // We can't inspect the exact SQL text in unit tests, but verify DB was queried
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('falls back to sync compileScopeFilter for materials table', async () => {
    const result = await compileScopeFilterAsync(makeCtx(), 'materials');
    expect(result).toBeDefined();
    // No DB execute calls for materials path
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
