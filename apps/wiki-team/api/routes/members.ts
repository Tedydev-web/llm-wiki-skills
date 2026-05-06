/**
 * members.ts — /api/workspaces/:id/members + /:uid
 *
 * GET    /api/workspaces/:id/members         — list workspace members
 * POST   /api/workspaces/:id/members         — invite by userId + tier
 * PATCH  /api/workspaces/:id/members/:uid    — change tier (steward+)
 * DELETE /api/workspaces/:id/members/:uid    — remove member (steward+)
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { rbacGuard } from '../middleware/rbac-guard.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import { getDb, schema } from '../../storage/db.js';

const VALID_TIERS = ['observer', 'contributor', 'steward', 'owner'] as const;
type Tier = typeof VALID_TIERS[number];

export function buildMembersRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // GET /api/workspaces/:id/members
  app.get('/workspaces/:id/members', async (c) => {
    requireAuth(c);
    const db = getDb();
    const members = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.workspaceId, c.req.param('id')));

    return c.json({ members });
  });

  // POST /api/workspaces/:id/members — invite member
  app.post(
    '/workspaces/:id/members',
    rbacGuard('kb', 'manage'),
    auditLog('member.invited', 'member', (c) => c.get('newMemberId' as never) as string | null),
    async (c) => {
      const ctx = requireAuth(c);
      const body = await c.req.json<{ userId: string; tier?: Tier }>();

      if (!body.userId) {
        return errorResponse(c, 400, 'bad_request', 'userId is required');
      }

      const tier: Tier = VALID_TIERS.includes(body.tier as Tier) ? (body.tier as Tier) : 'observer';
      const db = getDb();
      const wid = c.req.param('id');
      const id = crypto.randomUUID();

      await db.insert(schema.members).values({
        id,
        workspaceId: wid,
        userId: body.userId,
        tier,
        invitedBy: ctx.userId ?? null,
        joinedAt: new Date(),
      });

      c.set('newMemberId' as never, id as never);
      return c.json({ id, workspaceId: wid, userId: body.userId, tier }, 201);
    },
  );

  // PATCH /api/workspaces/:id/members/:uid — update tier
  app.patch(
    '/workspaces/:id/members/:uid',
    rbacGuard('kb', 'manage'),
    auditLog('member.updated', 'member', (c) => c.req.param('uid')),
    async (c) => {
      const body = await c.req.json<{ tier: Tier }>();

      if (!VALID_TIERS.includes(body.tier)) {
        return errorResponse(c, 400, 'bad_request', `tier must be one of: ${VALID_TIERS.join(', ')}`);
      }

      const db = getDb();
      await db
        .update(schema.members)
        .set({ tier: body.tier })
        .where(
          and(
            eq(schema.members.workspaceId, c.req.param('id')),
            eq(schema.members.userId, c.req.param('uid')),
          ),
        );

      return c.json({ userId: c.req.param('uid'), tier: body.tier });
    },
  );

  // DELETE /api/workspaces/:id/members/:uid — remove member
  app.delete(
    '/workspaces/:id/members/:uid',
    rbacGuard('kb', 'manage'),
    auditLog('member.removed', 'member', (c) => c.req.param('uid')),
    async (c) => {
      const db = getDb();
      await db
        .delete(schema.members)
        .where(
          and(
            eq(schema.members.workspaceId, c.req.param('id')),
            eq(schema.members.userId, c.req.param('uid')),
          ),
        );

      return c.json({ removed: true, userId: c.req.param('uid') });
    },
  );

  return app;
}
