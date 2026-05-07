/**
 * auth-context.ts — unified AuthContext type + Hono middleware
 *
 * Two auth sources resolved in priority order:
 *   1. Bearer token  → verifyMcpToken() → AuthContext { source: 'mcp-token' }
 *   2. Session cookie → Better Auth session → AuthContext { source: 'session' }
 *   3. Neither present → returns null (handler must reject 401)
 *
 * AuthContext shape per Phase 04 spec + ADR 010 vocabulary:
 *   membershipTier uses MembershipTier enum from @wiki-team/schema (observer | contributor | steward | owner)
 *   + 'global-admin' for tenant-level admins (null workspaceId)
 *
 *
 * Usage in Hono route:
 *   app.use('*', authContextMiddleware(authInstance, db))
 *   app.get('/protected', (c) => {
 *     const ctx = c.get('authContext')
 *     if (!ctx) return c.json({ error: 'Unauthorized' }, 401)
 *     ...
 *   })
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import type { PermissionGrant } from '@wiki-team/schema';
import type { AuthInstance } from './better-auth.js';
import type { McpTokenDb } from './mcp-token-service.js';
import { verifyMcpToken } from './mcp-token-service.js';
import { logger } from '../lib/logger.js';
import { loadPermissions, loadMembershipRole } from '../rbac/permission-loader.js';

// ---------------------------------------------------------------------------
// AuthContext — canonical identity bundle (phase-04 naming)

export interface AuthContext {
  userId: string;
  /** null = global admin context (no workspace bound) */
  workspaceId: string | null;
  /** Workspace-level role tier per ADR 010 Realm 2; global-admin = tenant-level only */
  membershipTier: 'observer' | 'contributor' | 'steward' | 'owner' | 'global-admin';
  /** Effective permission grants (union of all role permissions + token scopes) */
  permissions: PermissionGrant[];
  /** Audit field: which auth channel resolved this context */
  source: 'session' | 'mcp-token';
}

// ---------------------------------------------------------------------------
// Hono env extension (typed context variable)

export type AuthContextEnv = {
  Variables: {
    authContext: AuthContext | null;
  };
};

// ---------------------------------------------------------------------------
// Middleware factory

/**
 * Hono middleware that resolves AuthContext from each request.
 * Sets `c.set('authContext', ctx)` — null if unauthenticated.
 *
 * Bearer token check is attempted first (cheaper: HMAC prefix lookup before argon2id).
 * Session cookie check is fallback (requires Better Auth session lookup).
 *
 * @param auth  Better Auth instance (from createAuthInstance())
 * @param db    McpTokenDb interface (from P03 storage layer)
 */
export function authContextMiddleware(
  auth: AuthInstance,
  db: McpTokenDb,
): MiddlewareHandler<AuthContextEnv> {
  return async (c: Context<AuthContextEnv>, next: Next) => {
    let resolved: AuthContext | null = null;

    // --- Path 1: Bearer token (MCP clients) ---
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer wkt_')) {
      const token = authHeader.slice('Bearer '.length);
      try {
        const mcpCtx = await verifyMcpToken(token, db);
        if (mcpCtx !== null) {
          // P05: populate permissions + upgrade membershipTier via DB loaders.
          // verifyMcpToken builds a partial context from token.scopes; loaders add
          // the full role-based permission union from role_definitions table.
          const [fullPermissions, membershipRole] = await Promise.all([
            loadPermissions(mcpCtx.userId),
            mcpCtx.workspaceId !== null
              ? loadMembershipRole(mcpCtx.userId, mcpCtx.workspaceId)
              : Promise.resolve(null),
          ]);

          // Merge: token scopes union with role-derived permissions
          // Token scopes are already validated PermissionGrants; union with role grants
          const mergedPermissions = mergePermissions(mcpCtx.permissions, fullPermissions);

          resolved = {
            ...mcpCtx,
            permissions: mergedPermissions,
            // Upgrade membershipTier if DB lookup found a higher tier than token-derived
            membershipTier: membershipRole ?? mcpCtx.membershipTier,
          };
        }
      } catch (err) {
        // verifyMcpToken or loader throws on internal errors (e.g. BETTER_AUTH_SECRET missing)
        // Treat as unauthenticated; log error for ops visibility
        logger.error({ err: err instanceof Error ? err.message : err }, '[auth] Bearer path error');
        resolved = null;
      }
    }

    // --- Path 2: Session cookie (browser / admin UI) ---
    if (resolved === null) {
      try {
        const session = await auth.api.getSession({ headers: c.req.raw.headers });
        if (session?.user?.id) {
          const partial = buildSessionAuthContext(session);

          // P05: populate permissions + membershipTier for session users.
          // workspaceId is resolved per-request from route params (injected by P08);
          // at middleware level we load the global permission union only.
          const permissions = await loadPermissions(partial.userId);
          resolved = { ...partial, permissions };
        }
      } catch (err) {
        // Session lookup or loader failure is non-fatal — treat as unauthenticated
        logger.error({ err: err instanceof Error ? err.message : err }, '[auth] session path error');
        resolved = null;
      }
    }

    c.set('authContext', resolved);
    await next();
  };
}

// ---------------------------------------------------------------------------
// Helper: build AuthContext from a Better Auth session object

/**
 * Convert a Better Auth session to an AuthContext.
 * Session-based auth has no workspace binding at the middleware level —
 * workspace resolution happens in RBAC layer (P05) per the request's route params.
 *
 * membershipTier defaults to 'observer' here; P05 RBAC middleware upgrades it
 * based on workspace membership lookup.
 */
function buildSessionAuthContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any — Better Auth session shape varies by version
  session: any,
): AuthContext {
  return {
    userId: session.user.id as string,
    workspaceId: null, // resolved per-request by P05 RBAC middleware
    membershipTier: 'observer', // upgraded by P05 after workspace membership lookup
    permissions: [], // populated by P05 based on user's global roles
    source: 'session',
  };
}

// ---------------------------------------------------------------------------
// Guard helper for route handlers

/**
 * Assert AuthContext is present; throw 401 response if not.
 * Convenience wrapper for route handlers that require authentication.
 *
 * Usage:
 *   const ctx = requireAuth(c)  // throws Response(401) if not authed
 */
export function requireAuth(c: Context<AuthContextEnv>): AuthContext {
  const ctx = c.get('authContext');
  if (!ctx) {
    // Throwing a Response is Hono's idiomatic way to short-circuit handlers
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Internal: merge two PermissionGrant arrays, deduplicating by resource.verb.scope

/**
 * Union two PermissionGrant arrays without duplicates.
 * Key: "<resource>.<verb>.<scope>" string — matches the canonical permission format.
 */
function mergePermissions(a: PermissionGrant[], b: PermissionGrant[]): PermissionGrant[] {
  const seen = new Set<string>();
  const result: PermissionGrant[] = [];

  for (const grant of [...a, ...b]) {
    const key = `${grant.resource}.${grant.verb}.${grant.scope}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(grant);
    }
  }

  return result;
}
