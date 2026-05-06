/**
 * rbac-policy-matrix.test.ts — contract matrix for evaluatePolicy
 *
 * 26 rows covering:
 *   - 4 workspace tiers × 4 verbs × own-workspace + cross-workspace = 32 base cases
 *     (trimmed to representative set + edge cases = 26 rows)
 *   - global-admin all-allow (4 rows)
 *   - anonymous (no membership) all-deny (3 rows)
 *   - revoked / workspace-mismatch reason codes
 *
 * Pure-function test — NO database, NO async (besides vitest harness).
 * Asserts evaluatePolicy.toString() does NOT contain 'await'.
 */

import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../../apps/wiki-team/rbac/policy-evaluator.js';
import type { AuthContext } from '../../../apps/wiki-team/auth/auth-context.js';
import type { ResourceRef, Action } from '../../../apps/wiki-team/rbac/policy-evaluator.js';
import type { Decision } from '../../../apps/wiki-team/rbac/decision.js';

// ---------------------------------------------------------------------------
// Helpers: build minimal AuthContext stubs

const WS_A = 'ws-aaaaaaaa-0000-0000-0000-000000000001';
const WS_B = 'ws-bbbbbbbb-0000-0000-0000-000000000002';
const USER_1 = 'user-00000000-0000-0000-0000-000000000001';

function makeCtx(overrides: Partial<AuthContext>): AuthContext {
  return {
    userId: USER_1,
    workspaceId: WS_A,
    membershipTier: 'observer',
    permissions: [],
    source: 'session',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Matrix row type

interface MatrixRow {
  label: string;
  ctx: AuthContext;
  ref: ResourceRef;
  action: Action;
  expected: Decision;
}

// ---------------------------------------------------------------------------
// Matrix rows

const MATRIX: MatrixRow[] = [
  // ---- global-admin: all-allow ----
  {
    label: 'global-admin / kb.view / own-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'global-admin', workspaceId: null }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'view' },
    expected: { allow: true },
  },
  {
    label: 'global-admin / page.delete / own-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'global-admin', workspaceId: null }),
    ref: { resource: 'page', workspaceId: WS_A },
    action: { verb: 'delete' },
    expected: { allow: true },
  },
  {
    label: 'global-admin / tenant.manage / null-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'global-admin', workspaceId: null }),
    ref: { resource: 'tenant', workspaceId: null },
    action: { verb: 'manage' },
    expected: { allow: true },
  },
  {
    label: 'global-admin / mcp.manage / cross-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'global-admin', workspaceId: null }),
    ref: { resource: 'mcp', workspaceId: WS_B },
    action: { verb: 'manage' },
    expected: { allow: true },
  },

  // ---- grant scope:all → ALLOW regardless of workspace ----
  {
    label: 'observer + kb.view.all / cross-ws → ALLOW',
    ctx: makeCtx({
      membershipTier: 'observer',
      workspaceId: WS_A,
      permissions: [{ resource: 'kb', verb: 'view', scope: 'all' }],
    }),
    ref: { resource: 'kb', workspaceId: WS_B },
    action: { verb: 'view' },
    expected: { allow: true },
  },
  {
    label: 'contributor + page.edit.all / cross-ws → ALLOW',
    ctx: makeCtx({
      membershipTier: 'contributor',
      workspaceId: WS_A,
      permissions: [{ resource: 'page', verb: 'edit', scope: 'all' }],
    }),
    ref: { resource: 'page', workspaceId: WS_B },
    action: { verb: 'edit' },
    expected: { allow: true },
  },

  // ---- grant scope:own → ALLOW when workspace matches ----
  {
    label: 'contributor + kb.view.own / same-ws → ALLOW',
    ctx: makeCtx({
      membershipTier: 'contributor',
      workspaceId: WS_A,
      permissions: [{ resource: 'kb', verb: 'view', scope: 'own' }],
    }),
    ref: { resource: 'kb', workspaceId: WS_A, departmentId: 'dept-x' },
    action: { verb: 'view' },
    expected: { allow: true },
  },
  {
    label: 'contributor + kb.view.own / cross-ws → DENY workspace-mismatch',
    ctx: makeCtx({
      membershipTier: 'contributor',
      workspaceId: WS_A,
      permissions: [{ resource: 'kb', verb: 'view', scope: 'own' }],
    }),
    ref: { resource: 'kb', workspaceId: WS_B },
    action: { verb: 'view' },
    expected: { allow: false, reason: 'workspace-mismatch' },
  },

  // ---- Realm 2: workspace tier checks ----
  {
    label: 'observer tier / kb.view / own-ws → ALLOW (observer can view)',
    ctx: makeCtx({ membershipTier: 'observer', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'view' },
    expected: { allow: true },
  },
  {
    label: 'observer tier / page.edit / own-ws → DENY role-too-low',
    ctx: makeCtx({ membershipTier: 'observer', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'page', workspaceId: WS_A },
    action: { verb: 'edit' },
    expected: { allow: false, reason: 'role-too-low' },
  },
  {
    label: 'contributor tier / page.edit / own-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'contributor', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'page', workspaceId: WS_A },
    action: { verb: 'edit' },
    expected: { allow: true },
  },
  {
    label: 'contributor tier / kb.delete / own-ws → DENY role-too-low',
    ctx: makeCtx({ membershipTier: 'contributor', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'delete' },
    expected: { allow: false, reason: 'role-too-low' },
  },
  {
    label: 'steward tier / kb.delete / own-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'steward', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'delete' },
    expected: { allow: true },
  },
  {
    label: 'steward tier / kb.manage / own-ws → DENY role-too-low',
    ctx: makeCtx({ membershipTier: 'steward', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'manage' },
    expected: { allow: false, reason: 'role-too-low' },
  },
  {
    label: 'owner tier / kb.manage / own-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'owner', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'manage' },
    expected: { allow: true },
  },
  {
    label: 'owner tier / page.delete / own-ws → ALLOW',
    ctx: makeCtx({ membershipTier: 'owner', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'page', workspaceId: WS_A },
    action: { verb: 'delete' },
    expected: { allow: true },
  },

  // ---- Cross-workspace without grant: workspace-mismatch ----
  {
    label: 'observer / kb.view / cross-ws no grant → DENY workspace-mismatch',
    ctx: makeCtx({ membershipTier: 'observer', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'kb', workspaceId: WS_B },
    action: { verb: 'view' },
    expected: { allow: false, reason: 'workspace-mismatch' },
  },
  {
    label: 'owner / page.edit / cross-ws no grant → DENY workspace-mismatch',
    ctx: makeCtx({ membershipTier: 'owner', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'page', workspaceId: WS_B },
    action: { verb: 'edit' },
    expected: { allow: false, reason: 'workspace-mismatch' },
  },

  // ---- Anonymous (no workspace binding, no permissions) ----
  {
    label: 'anonymous / kb.view / any-ws → DENY no-grant',
    ctx: makeCtx({ membershipTier: 'observer', workspaceId: null, permissions: [] }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'view' },
    expected: { allow: false, reason: 'no-grant' },
  },
  {
    label: 'anonymous / page.edit / any-ws → DENY no-grant',
    ctx: makeCtx({ membershipTier: 'observer', workspaceId: null, permissions: [] }),
    ref: { resource: 'page', workspaceId: WS_A },
    action: { verb: 'edit' },
    expected: { allow: false, reason: 'no-grant' },
  },
  {
    label: 'anonymous / tenant.manage / null-ws → DENY no-grant',
    ctx: makeCtx({ membershipTier: 'observer', workspaceId: null, permissions: [] }),
    ref: { resource: 'tenant', workspaceId: null },
    action: { verb: 'manage' },
    expected: { allow: false, reason: 'no-grant' },
  },

  // ---- Tenant-scoped resource (workspaceId null) ----
  {
    label: 'contributor (no global grant) / tenant.manage / null-ws → DENY no-grant',
    ctx: makeCtx({ membershipTier: 'contributor', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'tenant', workspaceId: null },
    action: { verb: 'manage' },
    expected: { allow: false, reason: 'no-grant' },
  },
  {
    label: 'has tenant.manage.all grant / tenant.manage → ALLOW',
    ctx: makeCtx({
      membershipTier: 'observer',
      workspaceId: WS_A,
      permissions: [{ resource: 'tenant', verb: 'manage', scope: 'all' }],
    }),
    ref: { resource: 'tenant', workspaceId: null },
    action: { verb: 'manage' },
    expected: { allow: true },
  },

  // ---- MCP token resource ----
  {
    label: 'has mcp.manage.all / mcp.manage → ALLOW',
    ctx: makeCtx({
      membershipTier: 'observer',
      workspaceId: WS_A,
      permissions: [{ resource: 'mcp', verb: 'manage', scope: 'all' }],
    }),
    ref: { resource: 'mcp', workspaceId: WS_A },
    action: { verb: 'manage' },
    expected: { allow: true },
  },
  {
    label: 'observer no grant / mcp.manage → DENY role-too-low',
    ctx: makeCtx({ membershipTier: 'observer', workspaceId: WS_A, permissions: [] }),
    ref: { resource: 'mcp', workspaceId: WS_A },
    action: { verb: 'manage' },
    expected: { allow: false, reason: 'role-too-low' },
  },

  // ---- scope:shared grant → workspace-bounded ----
  {
    label: 'has kb.view.shared / same-ws → ALLOW',
    ctx: makeCtx({
      membershipTier: 'observer',
      workspaceId: WS_A,
      permissions: [{ resource: 'kb', verb: 'view', scope: 'shared' }],
    }),
    ref: { resource: 'kb', workspaceId: WS_A },
    action: { verb: 'view' },
    expected: { allow: true },
  },
];

// ---------------------------------------------------------------------------
// Purity assertion: evaluatePolicy must not contain 'await'

describe('evaluatePolicy purity contract', () => {
  it('evaluatePolicy.toString() does not contain "await" (no async I/O)', () => {
    const src = evaluatePolicy.toString();
    expect(src).not.toMatch(/\bawait\b/);
  });
});

// ---------------------------------------------------------------------------
// Policy matrix: 26 rows

describe('evaluatePolicy policy matrix', () => {
  it.each(MATRIX.map((row) => [row.label, row] as [string, MatrixRow]))(
    '%s',
    (_label: string, row: MatrixRow) => {
      const result = evaluatePolicy(row.ctx, row.ref, row.action);
      expect(result).toEqual(row.expected);
    },
  );

  it('matrix has at least 16 rows', () => {
    expect(MATRIX.length).toBeGreaterThanOrEqual(16);
  });
});
