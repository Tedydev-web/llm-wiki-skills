/**
 * role-hierarchy.test.ts — unit tests for roleAtLeast() and verbToMinTier()
 *
 * Pure module: no I/O, no mocks. Tests ADR 010 tier ordering.
 */

import { describe, it, expect } from 'vitest';
import {
  roleAtLeast,
  verbToMinTier,
  MEMBERSHIP_TIERS,
} from '../../../apps/wiki-team/rbac/role-hierarchy.js';

// ---------------------------------------------------------------------------
// MEMBERSHIP_TIERS ordering contract

describe('MEMBERSHIP_TIERS', () => {
  it('contains exactly 4 tiers in ascending order', () => {
    expect(MEMBERSHIP_TIERS).toEqual(['observer', 'contributor', 'steward', 'owner']);
  });
});

// ---------------------------------------------------------------------------
// roleAtLeast — ordinal comparison

describe('roleAtLeast', () => {
  // Reflexive: every tier satisfies itself
  it.each(MEMBERSHIP_TIERS)('%s satisfies itself', (tier) => {
    expect(roleAtLeast(tier, tier)).toBe(true);
  });

  // Ascending chain
  it('contributor satisfies observer', () => {
    expect(roleAtLeast('contributor', 'observer')).toBe(true);
  });

  it('steward satisfies contributor', () => {
    expect(roleAtLeast('steward', 'contributor')).toBe(true);
  });

  it('owner satisfies steward', () => {
    expect(roleAtLeast('owner', 'steward')).toBe(true);
  });

  it('owner satisfies observer (skip tiers)', () => {
    expect(roleAtLeast('owner', 'observer')).toBe(true);
  });

  // Descending — lower tier does NOT satisfy higher
  it('observer does NOT satisfy contributor', () => {
    expect(roleAtLeast('observer', 'contributor')).toBe(false);
  });

  it('observer does NOT satisfy steward', () => {
    expect(roleAtLeast('observer', 'steward')).toBe(false);
  });

  it('contributor does NOT satisfy steward', () => {
    expect(roleAtLeast('contributor', 'steward')).toBe(false);
  });

  it('steward does NOT satisfy owner', () => {
    expect(roleAtLeast('steward', 'owner')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verbToMinTier — ADR 010 capability table

describe('verbToMinTier', () => {
  it('view → observer (all tiers can view)', () => {
    expect(verbToMinTier('view')).toBe('observer');
  });

  it('edit → contributor', () => {
    expect(verbToMinTier('edit')).toBe('contributor');
  });

  it('delete → steward', () => {
    expect(verbToMinTier('delete')).toBe('steward');
  });

  it('manage → owner', () => {
    expect(verbToMinTier('manage')).toBe('owner');
  });

  it('unknown verb → owner (safe default)', () => {
    expect(verbToMinTier('explode')).toBe('owner');
  });

  it('empty verb → owner (safe default)', () => {
    expect(verbToMinTier('')).toBe('owner');
  });
});

// ---------------------------------------------------------------------------
// Combined: roleAtLeast + verbToMinTier (policy logic simulation)

describe('roleAtLeast + verbToMinTier integration', () => {
  it('observer can view (observer >= observer)', () => {
    expect(roleAtLeast('observer', verbToMinTier('view'))).toBe(true);
  });

  it('observer cannot edit (observer < contributor)', () => {
    expect(roleAtLeast('observer', verbToMinTier('edit'))).toBe(false);
  });

  it('contributor can edit', () => {
    expect(roleAtLeast('contributor', verbToMinTier('edit'))).toBe(true);
  });

  it('contributor cannot delete (contributor < steward)', () => {
    expect(roleAtLeast('contributor', verbToMinTier('delete'))).toBe(false);
  });

  it('steward can delete', () => {
    expect(roleAtLeast('steward', verbToMinTier('delete'))).toBe(true);
  });

  it('steward cannot manage (steward < owner)', () => {
    expect(roleAtLeast('steward', verbToMinTier('manage'))).toBe(false);
  });

  it('owner can manage', () => {
    expect(roleAtLeast('owner', verbToMinTier('manage'))).toBe(true);
  });
});
