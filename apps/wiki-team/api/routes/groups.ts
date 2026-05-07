/**
 * groups.ts — /api/workspaces/:wid/groups CRUD + note-kind scope assignment (P08).
 *
 * GET    /api/workspaces/:wid/groups                              — list groups (kb.view)
 * POST   /api/workspaces/:wid/groups                             — create group (kb.manage)
 * PATCH  /api/workspaces/:wid/groups/:slug                       — update displayName (kb.manage)
 * DELETE /api/workspaces/:wid/groups/:slug                       — delete group (kb.manage; 409 if members)
 * GET    /api/workspaces/:wid/groups/:slug/note-kinds            — list assigned kinds
 * POST   /api/workspaces/:wid/groups/:slug/note-kinds            — assign kind (kb.manage)
 * DELETE /api/workspaces/:wid/groups/:slug/note-kinds/:kindSlug  — remove kind (kb.manage)
 *
 * Anti-trace: generic "group" naming (not department/dept).
 */

import { Hono } from 'hono';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { rbacGuard } from '../middleware/rbac-guard.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import {
  listGroups,
  createGroup,
  patchGroup,
  deleteGroup,
  listGroupNoteKinds,
  assignNoteKindToGroup,
  removeNoteKindFromGroup,
} from '../../services/group-service.js';

// ---------------------------------------------------------------------------
// Typed service error

interface ServiceError extends Error {
  status?: number;
  code?: string;
}

function handleServiceError(c: Parameters<typeof errorResponse>[0], err: unknown): Response {
  const e = err as ServiceError;
  return errorResponse(c, e.status ?? 500, e.code ?? 'internal_server_error', e.message ?? 'Unexpected error');
}

// ---------------------------------------------------------------------------
// Router

export function buildGroupsRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // GET /api/workspaces/:wid/groups — list all groups
  app.get('/workspaces/:wid/groups', rbacGuard('kb', 'view'), async (c) => {
    requireAuth(c);
    try {
      const groups = await listGroups();
      return c.json({ groups });
    } catch (err) {
      return handleServiceError(c, err);
    }
  });

  // POST /api/workspaces/:wid/groups — create group (admin)
  app.post(
    '/workspaces/:wid/groups',
    rbacGuard('kb', 'manage'),
    auditLog('group.created', 'group', (c) => c.get('newGroupId' as never) as string | null),
    async (c) => {
      requireAuth(c);
      const body = await c.req.json<{ slug?: string; displayName?: string }>();
      if (!body.slug || !body.displayName) {
        return errorResponse(c, 400, 'bad_request', 'slug and displayName are required');
      }
      try {
        const group = await createGroup({ slug: body.slug, displayName: body.displayName });
        c.set('newGroupId' as never, group.id as never);
        return c.json({ group }, 201);
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  // PATCH /api/workspaces/:wid/groups/:slug — update displayName
  app.patch(
    '/workspaces/:wid/groups/:slug',
    rbacGuard('kb', 'manage'),
    auditLog('group.updated', 'group', (c) => c.req.param('slug')),
    async (c) => {
      requireAuth(c);
      const slug = c.req.param('slug');
      const body = await c.req.json<{ displayName?: string }>();
      if (!body.displayName) {
        return errorResponse(c, 400, 'bad_request', 'displayName is required');
      }
      try {
        const group = await patchGroup(slug, body.displayName);
        return c.json({ group });
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  // DELETE /api/workspaces/:wid/groups/:slug — delete group (409 if members assigned)
  app.delete(
    '/workspaces/:wid/groups/:slug',
    rbacGuard('kb', 'manage'),
    auditLog('group.deleted', 'group', (c) => c.req.param('slug')),
    async (c) => {
      requireAuth(c);
      const slug = c.req.param('slug');
      try {
        await deleteGroup(slug);
        return c.json({ deleted: true, slug });
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  // GET /api/workspaces/:wid/groups/:slug/note-kinds — list assigned kinds
  app.get('/workspaces/:wid/groups/:slug/note-kinds', rbacGuard('kb', 'view'), async (c) => {
    requireAuth(c);
    const slug = c.req.param('slug');
    try {
      const kinds = await listGroupNoteKinds(slug);
      return c.json({ noteKinds: kinds });
    } catch (err) {
      return handleServiceError(c, err);
    }
  });

  // POST /api/workspaces/:wid/groups/:slug/note-kinds — assign kind to group
  app.post(
    '/workspaces/:wid/groups/:slug/note-kinds',
    rbacGuard('kb', 'manage'),
    auditLog('group.kind_assigned', 'group', (c) => c.req.param('slug')),
    async (c) => {
      requireAuth(c);
      const groupSlug = c.req.param('slug');
      const body = await c.req.json<{ noteKindSlug?: string }>();
      if (!body.noteKindSlug) {
        return errorResponse(c, 400, 'bad_request', 'noteKindSlug is required');
      }
      try {
        const kind = await assignNoteKindToGroup(groupSlug, body.noteKindSlug);
        return c.json({ noteKind: kind }, 201);
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  // DELETE /api/workspaces/:wid/groups/:slug/note-kinds/:kindSlug — remove kind from group
  app.delete(
    '/workspaces/:wid/groups/:slug/note-kinds/:kindSlug',
    rbacGuard('kb', 'manage'),
    auditLog('group.kind_removed', 'group', (c) => c.req.param('slug')),
    async (c) => {
      requireAuth(c);
      const groupSlug = c.req.param('slug');
      const kindSlug = c.req.param('kindSlug');
      try {
        await removeNoteKindFromGroup(groupSlug, kindSlug);
        return c.json({ deleted: true, groupSlug, kindSlug });
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  return app;
}
