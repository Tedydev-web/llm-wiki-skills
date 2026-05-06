/**
 * me.ts — GET /api/me
 *
 * Returns AuthContext summary for the authenticated caller.
 * Supports both session and Bearer (MCP token) auth.
 */

import { Hono } from 'hono';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { errorResponse } from '../middleware/error-handler.js';

export function buildMeRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // GET /api/me — return caller identity summary
  app.get('/me', (c) => {
    const ctx = c.get('authContext');
    if (!ctx) return errorResponse(c, 401, 'unauthorized', 'Authentication required');

    return c.json({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      membershipTier: ctx.membershipTier,
      source: ctx.source,
      permissionCount: ctx.permissions.length,
    });
  });

  return app;
}
