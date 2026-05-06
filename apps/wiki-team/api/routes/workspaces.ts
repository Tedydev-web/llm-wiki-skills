/**
 * workspaces.ts — /api/workspaces + /api/workspaces/:id
 *
 * GET    /api/workspaces          — list workspaces the caller owns or is member of
 * POST   /api/workspaces          — create new workspace
 * GET    /api/workspaces/:id      — get single workspace
 * PATCH  /api/workspaces/:id      — update (rbacGuard: workspace/manage)
 * DELETE /api/workspaces/:id      — soft-delete (rbacGuard: workspace/manage)
 */

import { Hono } from 'hono';
import { eq, or, isNull } from 'drizzle-orm';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { rbacGuard } from '../middleware/rbac-guard.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import { getDb, schema } from '../../storage/db.js';

export function buildWorkspacesRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // GET /api/workspaces
  app.get('/workspaces', async (c) => {
    const ctx = requireAuth(c);
    const db = getDb();

    // Return workspaces owned by or with active membership for caller
    const owned = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.ownerId, ctx.userId));

    const memberships = await db
      .select({ workspaceId: schema.members.workspaceId })
      .from(schema.members)
      .where(eq(schema.members.userId, ctx.userId));

    const memberIds = memberships.map((m) => m.workspaceId);
    const memberWorkspaces =
      memberIds.length > 0
        ? await db
            .select()
            .from(schema.workspaces)
            .where(
              or(
                ...memberIds.map((id) => eq(schema.workspaces.id, id)),
              ),
            )
        : [];

    // Merge + deduplicate
    const seen = new Set<string>();
    const all = [...owned, ...memberWorkspaces].filter((w) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return w.deletedAt === null;
    });

    return c.json({ workspaces: all });
  });

  // POST /api/workspaces
  app.post(
    '/workspaces',
    auditLog('workspace.created', 'workspace', (c) => c.get('newWorkspaceId' as never) as string | null),
    async (c) => {
      const ctx = requireAuth(c);
      const body = await c.req.json<{ slug: string; displayName: string }>();

      if (!body.slug || !body.displayName) {
        return errorResponse(c, 400, 'bad_request', 'slug and displayName are required');
      }

      const db = getDb();
      const id = crypto.randomUUID();

      await db.insert(schema.workspaces).values({
        id,
        slug: body.slug,
        displayName: body.displayName,
        ownerId: ctx.userId,
        groupId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Also insert owner membership row
      await db.insert(schema.members).values({
        id: crypto.randomUUID(),
        workspaceId: id,
        userId: ctx.userId,
        tier: 'owner',
        joinedAt: new Date(),
      });

      c.set('newWorkspaceId' as never, id as never);
      return c.json({ id, slug: body.slug, displayName: body.displayName }, 201);
    },
  );

  // GET /api/workspaces/:id
  app.get('/workspaces/:id', async (c) => {
    requireAuth(c);
    const db = getDb();
    const [ws] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, c.req.param('id')));

    if (!ws || ws.deletedAt !== null) {
      return errorResponse(c, 404, 'not_found', 'Workspace not found');
    }
    return c.json(ws);
  });

  // PATCH /api/workspaces/:id
  app.patch(
    '/workspaces/:id',
    rbacGuard('kb', 'manage'),
    auditLog('workspace.updated', 'workspace', (c) => c.req.param('id')),
    async (c) => {
      const body = await c.req.json<{ displayName?: string; slug?: string }>();
      const db = getDb();
      const id = c.req.param('id');

      await db
        .update(schema.workspaces)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(schema.workspaces.id, id));

      return c.json({ id, updated: true });
    },
  );

  // DELETE /api/workspaces/:id — soft-delete
  app.delete(
    '/workspaces/:id',
    rbacGuard('kb', 'manage'),
    auditLog('workspace.deleted', 'workspace', (c) => c.req.param('id')),
    async (c) => {
      const db = getDb();
      const id = c.req.param('id');

      await db
        .update(schema.workspaces)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.workspaces.id, id));

      return c.json({ id, deleted: true });
    },
  );

  return app;
}
