/**
 * role-hierarchy.ts — MembershipTier enum + ordinal comparison helpers
 *
 * ADR 010 Realm 2 — four workspace roles in strict ascending order:
 *   observer < contributor < steward < owner
 *
 * Plus 'global-admin' overlay (tenant-level; not part of the 4-tier ordinal chain).
 *
 * Rule: 'global-admin' is checked BEFORE roleAtLeast in evaluatePolicy.
 * This module only defines the workspace-tier ordering.
 */

// ---------------------------------------------------------------------------
// MembershipTier enum (ADR 010 table: observer | contributor | steward | owner)

export const MEMBERSHIP_TIERS = ['observer', 'contributor', 'steward', 'owner'] as const;

export type MembershipTier = (typeof MEMBERSHIP_TIERS)[number];

// ---------------------------------------------------------------------------
// Ordinal index map — derive from array so order is single source of truth

const TIER_RANK: Record<MembershipTier, number> = Object.fromEntries(
  MEMBERSHIP_TIERS.map((tier, idx) => [tier, idx]),
) as Record<MembershipTier, number>;

// ---------------------------------------------------------------------------
// roleAtLeast — ordinal comparison

/**
 * Returns true when `actual` tier satisfies `required` tier (i.e. actual >= required).
 *
 * Examples:
 *   roleAtLeast('steward', 'contributor') === true   // steward rank 2 >= contributor rank 1
 *   roleAtLeast('observer', 'steward')   === false   // observer rank 0 < steward rank 2
 *   roleAtLeast('owner', 'owner')        === true    // same tier
 */
export function roleAtLeast(actual: MembershipTier, required: MembershipTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

// ---------------------------------------------------------------------------
// verbToMinTier — maps ADR 010 action verbs to minimum workspace tier
//
// Derived from ADR 010 capability table:
//   view     → observer    (all tiers can view)
//   edit     → contributor (can create/edit wiki pages)
//   delete   → steward     (steward manages membership + uploads; delete mapped here)
//   manage   → owner       (delete workspace / transfer ownership)

export function verbToMinTier(verb: string): MembershipTier {
  switch (verb) {
    case 'view':   return 'observer';
    case 'edit':   return 'contributor';
    case 'delete': return 'steward';
    case 'manage': return 'owner';
    default:       return 'owner'; // unknown verb → require highest tier (safe default)
  }
}
