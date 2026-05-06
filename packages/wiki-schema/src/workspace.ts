/**
 * workspace.ts — Workspace + Member Zod schemas
 *
 * Vocabulary per ADR 010:
 *   - Workspace: multi-user project space (v2 name)
 *   - Member: workspace membership record (v2 name)
 *   - MembershipTier: 4-role enum — observer | contributor | steward | owner
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// MembershipTier — workspace-level role hierarchy (ADR 010 Realm 2)

export const membershipTierSchema = z.enum([
  'observer',    // view-only
  'contributor', // create/edit pages
  'steward',     // upload sources + manage membership
  'owner',       // delete workspace + transfer ownership
]);

export type MembershipTier = z.infer<typeof membershipTierSchema>;

/** Numeric rank for hierarchy comparisons (observer=0 … owner=3) */
export const MEMBERSHIP_TIER_RANK: Record<MembershipTier, number> = {
  observer:    0,
  contributor: 1,
  steward:     2,
  owner:       3,
};

// ---------------------------------------------------------------------------
// Workspace

export const workspaceSchema = z.object({
  id:          z.string().uuid(),
  slug:        z.string().min(1).max(64).regex(/^[a-z0-9-]+$/),
  displayName: z.string().min(1).max(120),
  groupId:     z.string().uuid().nullable(),
  createdAt:   z.string().datetime(),
  updatedAt:   z.string().datetime(),
  deletedAt:   z.string().datetime().nullable(),
}).strict();

export type Workspace = z.infer<typeof workspaceSchema>;

// ---------------------------------------------------------------------------
// Member

export const memberSchema = z.object({
  id:          z.string().uuid(),
  workspaceId: z.string().uuid(),
  userId:      z.string().uuid(),
  tier:        membershipTierSchema,  // field name "tier" maps to MembershipTier enum
  invitedBy:   z.string().uuid().nullable(),
  joinedAt:    z.string().datetime(),
}).strict();

export type Member = z.infer<typeof memberSchema>;

// ---------------------------------------------------------------------------
// SharedKbGrant — cross-department KB access (required by ADR 010 resolveScope)

export const sharedKbGrantSchema = z.object({
  id:         z.string().uuid(),
  userId:     z.string().uuid(),
  kbId:       z.string().uuid(),
  grantedBy:  z.string().uuid(),
  grantedAt:  z.string().datetime(),
  expiresAt:  z.string().datetime().nullable(),
}).strict();

export type SharedKbGrant = z.infer<typeof sharedKbGrantSchema>;
