/**
 * decision.ts — Decision discriminated union + reason codes
 *
 * Produced by evaluatePolicy(); consumed by:
 *   - P08 HTTP middleware (403 response builder)
 *   - P07 MCP tool handlers (deny with reason)
 *   - audit_events table (reason code logged on deny)
 *
 * ADR 010: default-deny — evaluatePolicy never silently grants.
 */

// ---------------------------------------------------------------------------
// Deny reason codes

/**
 * Reason codes for denied decisions.
 *
 * no-grant         — no matching PermissionGrant in ctx.permissions for the requested resource.verb.scope
 * role-too-low     — workspace membership exists but tier is below the minimum for this action
 * workspace-mismatch — resource belongs to a workspace the subject is not a member of
 * revoked          — grant or membership was revoked before this request arrived (stale ctx guard)
 */
export type DenyReason = 'no-grant' | 'role-too-low' | 'workspace-mismatch' | 'revoked';

// ---------------------------------------------------------------------------
// Decision type

export type Decision =
  | { allow: true }
  | { allow: false; reason: DenyReason };

// ---------------------------------------------------------------------------
// Convenience constructors

export const ALLOW: Decision = { allow: true };

export function deny(reason: DenyReason): Decision {
  return { allow: false, reason };
}
