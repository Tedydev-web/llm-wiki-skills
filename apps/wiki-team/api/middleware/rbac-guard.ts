/**
 * rbac-guard.ts — Hono middleware factory: RBAC enforcement per route
 *
 * Usage in route files:
 *   app.patch('/workspaces/:id', rbacGuard('workspace', 'manage'), handler)
 *
 * Pulls workspaceId from route param ':id' or ':wid' automatically.
 * Calls P05 evaluatePolicy() — pure, no DB I/O in the guard itself.
 */

import type { Context, MiddlewareHandler, Next } from 'hono';
import type { AuthContextEnv } from '../../auth/auth-context.js';
import { requireAuth } from '../../auth/auth-context.js';
import { evaluatePolicy } from '../../rbac/index.js';
import type { ResourceRef, Action } from '../../rbac/index.js';
import type { PermissionGrant } from '@wiki-team/schema';
import { errorResponse } from './error-handler.js';

/**
 * rbacGuard — returns a Hono middleware that:
 *   1. Calls requireAuth (throws 401 if unauthenticated)
 *   2. Resolves workspaceId from route params (param name: 'id' or 'wid')
 *   3. Calls evaluatePolicy(ctx, ref, action)
 *   4. Returns 403 on deny with structured body
 *
 * @param resource  ADR 010 resource token: 'kb' | 'page' | 'tenant' | 'mcp'
 * @param verb      ADR 010 verb: 'view' | 'edit' | 'delete' | 'manage'
 */
export function rbacGuard(
  resource: PermissionGrant['resource'],
  verb: PermissionGrant['verb'],
): MiddlewareHandler<AuthContextEnv> {
  return async (c: Context<AuthContextEnv>, next: Next) => {
    const ctx = requireAuth(c); // throws 401 Response if not authed

    // Resolve workspaceId from route params (supports :id and :wid param names)
    const workspaceId =
      c.req.param('id') ?? c.req.param('wid') ?? ctx.workspaceId ?? null;

    const ref: ResourceRef = {
      resource,
      workspaceId,
    };
    const action: Action = { verb };

    const decision = evaluatePolicy(ctx, ref, action);
    if (!decision.allow) {
      return errorResponse(
        c,
        403,
        'forbidden',
        `Access denied: ${decision.reason ?? 'rbac_deny'}`,
        { resource, verb, workspaceId },
      );
    }

    await next();
  };
}
