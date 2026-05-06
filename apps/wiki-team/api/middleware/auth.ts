/**
 * auth.ts — Hono middleware: resolve AuthContext or reject 401
 *
 * Wraps P04 authContextMiddleware. Routes that require auth call
 * requireAuth(c) inside their handler — this middleware only populates
 * c.get('authContext'), it does NOT auto-reject (allows public routes).
 *
 * Usage in server.ts:
 *   app.use('/api/*', authMiddleware(authInstance, mcpTokenDb))
 */

import type { MiddlewareHandler } from 'hono';
import type { AuthInstance } from '../../auth/better-auth.js';
import type { McpTokenDb } from '../../auth/mcp-token-service.js';
import {
  authContextMiddleware,
  type AuthContextEnv,
} from '../../auth/auth-context.js';

export type { AuthContextEnv };

/**
 * Factory: returns a Hono middleware that resolves AuthContext per request.
 * Sets c.var.authContext = AuthContext | null.
 * 401 enforcement is deferred to route handlers via requireAuth(c).
 */
export function buildAuthMiddleware(
  auth: AuthInstance,
  mcpTokenDb: McpTokenDb,
): MiddlewareHandler<AuthContextEnv> {
  return authContextMiddleware(auth, mcpTokenDb);
}
