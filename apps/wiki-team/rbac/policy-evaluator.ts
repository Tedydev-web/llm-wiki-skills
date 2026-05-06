/**
 * policy-evaluator.ts — evaluatePolicy: pure dual-realm decision function
 *
 * PURE FUNCTION CONTRACT: no await, no DB import, no I/O.
 * All data arrives via AuthContext (pre-loaded by permission-loader.ts middleware).
 *
 * ADR 010 dual-realm decision logic:
 *   Realm 1 (global permissions): ctx.permissions[] matched against resource.verb.scope
 *   Realm 2 (workspace membership): ctx.membershipTier compared via roleAtLeast()
 *
 * Decision priority:
 *   1. global-admin override → ALLOW
 *   2. Realm 1: matching PermissionGrant with scope 'all' → ALLOW
 *   3. Realm 1: matching PermissionGrant with scope 'shared' → ALLOW (if shared grant exists)
 *   4. Realm 1: matching PermissionGrant with scope 'own' + workspace match → ALLOW
 *   5. Realm 2: workspace membership tier >= verbToMinTier(action.verb) → ALLOW
 *   6. Default → DENY
 */

import type { AuthContext } from '../auth/auth-context.js';
import type { PermissionGrant } from '@wiki-team/schema';
import { type Decision, ALLOW, deny } from './decision.js';
import { roleAtLeast, verbToMinTier, type MembershipTier } from './role-hierarchy.js';

// ---------------------------------------------------------------------------
// ResourceRef — identifies the target resource being accessed

export interface ResourceRef {
  /** ADR 010 resource token: kb | page | tenant | mcp */
  resource: PermissionGrant['resource'];
  /** Workspace the resource belongs to; null for tenant-scoped resources */
  workspaceId: string | null;
  /** Department/group ID of the resource's KB (for 'own' scope resolution) */
  departmentId?: string | null;
}

// ---------------------------------------------------------------------------
// Action — the operation being attempted

export interface Action {
  /** ADR 010 verb: view | edit | delete | manage */
  verb: PermissionGrant['verb'];
}

// ---------------------------------------------------------------------------
// evaluatePolicy — main entry point

/**
 * Evaluate whether `ctx` (authenticated subject) may perform `action` on `ref`.
 *
 * Pure function: relies exclusively on pre-loaded ctx.permissions and ctx.membershipTier.
 * No database access. No async. Safe to call in hot paths.
 *
 * @param ctx   AuthContext populated by authContextMiddleware + permission-loader.ts
 * @param ref   Target resource descriptor
 * @param action  Verb being attempted
 * @returns Decision — { allow: true } or { allow: false; reason }
 */
export function evaluatePolicy(
  ctx: AuthContext,
  ref: ResourceRef,
  action: Action,
): Decision {
  // ---- 1. Global-admin short-circuit (tenant-level; bypasses all checks) ----
  if (ctx.membershipTier === 'global-admin') {
    return ALLOW;
  }

  // ---- 2. Realm 1: global permission grant check ----
  const { resource, workspaceId: refWorkspaceId, departmentId: refDeptId } = ref;
  const { verb } = action;

  for (const grant of ctx.permissions) {
    if (grant.resource !== resource || grant.verb !== verb) continue;

    if (grant.scope === 'all') {
      // Unrestricted scope — grant covers everything
      return ALLOW;
    }

    if (grant.scope === 'shared') {
      // Explicitly shared grant — resource must be in subject's accessible workspace
      // 'shared' scope: subject has been explicitly granted access (SharedKbGrant per ADR 010)
      // We check the workspace membership as proxy for shared access
      if (refWorkspaceId !== null && ctx.workspaceId === refWorkspaceId) {
        return ALLOW;
      }
      // shared grant exists but workspace doesn't match — continue to next grant
      continue;
    }

    if (grant.scope === 'own') {
      // Own-scope: resource must be in subject's department
      // Department match: subject.departmentId == resource.departmentId (ADR 010 resolveScope)
      if (
        refDeptId != null &&
        ctx.workspaceId === refWorkspaceId
      ) {
        // Workspace matches — treat as own-scope access (workspace IS the department boundary in v2)
        return ALLOW;
      }
      // Check departmentId match directly when both are available
      // (future: ctx will carry departmentId once users table query joins groups)
      continue;
    }
  }

  // ---- 3. Realm 2: workspace membership role check ----
  // Only applicable when resource has a workspace binding
  if (refWorkspaceId === null) {
    // Tenant-scoped resource with no workspace; requires explicit global grant (checked above)
    return deny('no-grant');
  }

  // Workspace mismatch: subject has membership but in a different workspace
  if (ctx.workspaceId !== null && ctx.workspaceId !== refWorkspaceId) {
    return deny('workspace-mismatch');
  }

  // If subject has no workspace binding at all, they have no membership context
  if (ctx.workspaceId === null) {
    return deny('no-grant');
  }

  // Workspace matches — check membership tier
  const membershipTier = ctx.membershipTier as MembershipTier;
  const requiredTier = verbToMinTier(verb);

  if (roleAtLeast(membershipTier, requiredTier)) {
    return ALLOW;
  }

  return deny('role-too-low');
}

// ---------------------------------------------------------------------------
// hasGrant — narrow helper for compileScopeFilter and other callers

/**
 * Returns true if ctx.permissions contains a grant matching the given resource.verb.scope triple.
 * Does NOT perform scope resolution — pure grant existence check.
 */
export function hasGrant(
  ctx: AuthContext,
  resource: PermissionGrant['resource'],
  verb: PermissionGrant['verb'],
  scope: PermissionGrant['scope'],
): boolean {
  return ctx.permissions.some(
    (g) => g.resource === resource && g.verb === verb && g.scope === scope,
  );
}
