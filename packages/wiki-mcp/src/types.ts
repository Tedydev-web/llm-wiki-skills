/**
 * types.ts — local type aliases for wiki-mcp primitives
 *
 * These are intentionally minimal re-declarations of the types that
 * packages/wiki-mcp needs from the app layer. This avoids cross-package
 * relative imports (packages/* must not import from apps/*).
 *
 * Canonical definitions live in:
 *   AuthContext     → apps/wiki-team/auth/auth-context.ts
 *   McpTokenDb      → apps/wiki-team/auth/mcp-token-service.ts
 *   Decision        → apps/wiki-team/rbac/decision.ts
 *
 * These local aliases must be kept in sync with the canonical sources.
 * A type mismatch will cause a compile error in the consuming app (server.ts).
 */

// ---------------------------------------------------------------------------
// AuthContext — minimal shape needed by mcp-auth.ts

export interface AuthContext {
  userId: string;
  workspaceId: string | null;
  membershipTier: 'observer' | 'contributor' | 'steward' | 'owner' | 'global-admin';
  permissions: Array<{ resource: string; verb: string; scope: string }>;
  source: 'session' | 'mcp-token';
}

// ---------------------------------------------------------------------------
// McpTokenDb — minimal interface needed by mcp-auth.ts to call verifyMcpToken

export interface McpTokenDb {
  findMcpTokenByPrefixLookup(prefixLookup: string): Promise<McpTokenRow | null>;
  findMcpTokenById(id: string): Promise<McpTokenRow | null>;
  [key: string]: unknown; // allow additional methods from concrete implementations
}

export interface McpTokenRow {
  id: string;
  prefixLookup: string;
  tokenHash: string;
  userId: string;
  workspaceId: string | null;
  scopes: Array<{ resource: string; verb: string; scope: string }>;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Decision — minimal discriminated union needed by error-mapper.ts

export type DenyReason = 'no-grant' | 'role-too-low' | 'workspace-mismatch' | 'revoked';

export type Decision =
  | { allow: true }
  | { allow: false; reason: DenyReason };
