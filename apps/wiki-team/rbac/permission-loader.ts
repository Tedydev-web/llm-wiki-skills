/**
 * permission-loader.ts — DB-backed loaders for AuthContext population
 *
 * Called ONCE per request by authContextMiddleware (auth-context.ts) for both
 * session-cookie and Bearer-token paths. Results are set on AuthContext directly —
 * no separate cache layer needed (per-request lifetime).
 *
 * Queries:
 *   loadPermissions    — joins users → members → role_definitions, unions all permission arrays
 *   loadMembershipRole — single SELECT from members WHERE user_id + workspace_id
 *
 * ADR 010: permissions stored as JSONB array on role_definitions.permissions.
 * Parsed via parsePermission() from @wiki-team/schema — invalid strings throw (rejected at boundary).
 */

import { eq, and } from 'drizzle-orm';
import { parsePermission, type PermissionGrant } from '@wiki-team/schema';
import { logger } from '../lib/logger.js';
import { getDb, schema } from '../storage/db.js';
import { type MembershipTier, MEMBERSHIP_TIERS } from './role-hierarchy.js';

// ---------------------------------------------------------------------------
// loadPermissions — global realm: union of all role permission arrays for a user

/**
 * Load effective permissions for a user by joining members → role_definitions.
 *
 * A user may hold multiple workspace memberships, each linked to a role_definition
 * carrying a JSONB permissions array. Effective permissions = union (deduped) of all.
 *
 * Returns empty array for users with no memberships or no role grants.
 * Never throws on empty — empty permissions = default-deny (safe).
 *
 * @param userId  UUID of the authenticated user
 */
export async function loadPermissions(userId: string): Promise<PermissionGrant[]> {
  const db = getDb();

  // Join members → role_definitions via members.tier as slug lookup.
  // We also look up role_definitions by slug matching the member's tier value.
  // Note: members.tier stores the MembershipTier string; role_definitions.slug
  // stores the canonical role slug. We join on tier = slug to get permission arrays.
  const rows = await db
    .select({
      permissions: schema.roleDefinitions.permissions,
    })
    .from(schema.members)
    .innerJoin(
      schema.roleDefinitions,
      eq(schema.members.tier, schema.roleDefinitions.slug),
    )
    .where(eq(schema.members.userId, userId));

  // Union all permission arrays, parse each string, deduplicate
  const seen = new Set<string>();
  const grants: PermissionGrant[] = [];

  for (const row of rows) {
    const rawPerms = row.permissions as unknown;
    if (!Array.isArray(rawPerms)) continue;

    for (const raw of rawPerms) {
      if (typeof raw !== 'string') continue;
      // Skip duplicates before parsing (cheaper)
      if (seen.has(raw)) continue;
      seen.add(raw);

      try {
        grants.push(parsePermission(raw));
      } catch {
        // Invalid permission string in DB — log and skip (do NOT silently grant)
        logger.warn({ raw, userId }, '[rbac] loadPermissions: skipping invalid permission string');
      }
    }
  }

  return grants;
}

// ---------------------------------------------------------------------------
// loadMembershipRole — workspace realm: tier for a specific user+workspace

/**
 * Load the MembershipTier for a user in a given workspace.
 *
 * Returns null if the user has no membership row for this workspace.
 * Null means "not a member" — caller treats as default-deny for workspace actions.
 *
 * @param userId       UUID of the authenticated user
 * @param workspaceId  UUID of the workspace being accessed
 */
export async function loadMembershipRole(
  userId: string,
  workspaceId: string,
): Promise<MembershipTier | null> {
  const db = getDb();

  const rows = await db
    .select({ tier: schema.members.tier })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.userId, userId),
        eq(schema.members.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (rows.length === 0) return null;

  const tier = rows[0]!.tier;

  // Validate tier value is a known MembershipTier (guard against stale DB data)
  if (!(MEMBERSHIP_TIERS as readonly string[]).includes(tier)) {
    logger.warn({ tier, userId, workspaceId }, '[rbac] loadMembershipRole: unknown tier value');
    return null;
  }

  return tier as MembershipTier;
}
