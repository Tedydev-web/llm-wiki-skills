/**
 * index.ts — public surface re-exports for apps/wiki-team/rbac
 *
 * Consumers (P06 wiki-compile, P07 MCP tools, P08 HTTP middleware) import
 * from this module exclusively — never from sub-modules directly.
 *
 * Surface is intentionally minimal: only types + functions needed by callers.
 */

// Decision type + reason codes + constructors
export type { Decision, DenyReason } from './decision.js';
export { ALLOW, deny } from './decision.js';

// Role hierarchy — tier type + ordinal helpers
export type { MembershipTier } from './role-hierarchy.js';
export { MEMBERSHIP_TIERS, roleAtLeast, verbToMinTier } from './role-hierarchy.js';

// Policy evaluator — pure dual-realm decision function
export type { ResourceRef, Action } from './policy-evaluator.js';
export { evaluatePolicy, hasGrant } from './policy-evaluator.js';

// Permission loader — DB-backed loaders (called by auth-context middleware)
export { loadPermissions, loadMembershipRole } from './permission-loader.js';

// Scope compiler — Drizzle SQL fragment for query-time row filtering
export { compileScopeFilter } from './scope-compiler.js';
