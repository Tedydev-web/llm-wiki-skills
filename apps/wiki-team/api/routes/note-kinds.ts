/**
 * note-kinds.ts — /api/workspaces/:wid/note-kinds CRUD (ADR 014)
 *
 * GET    /api/workspaces/:wid/note-kinds          — list all kinds (kb.view.own+)
 * POST   /api/workspaces/:wid/note-kinds          — create custom kind (kb.manage admin)
 * PATCH  /api/workspaces/:wid/note-kinds/:slug    — patch color/description (kb.manage)
 * DELETE /api/workspaces/:wid/note-kinds/:slug    — delete custom kind (kb.manage)
 *
  * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 * ADR 014: 4 system defaults (fact/analysis/procedure/reference) are immutable.
 */

import { Hono } from 'hono';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { rbacGuard } from '../middleware/rbac-guard.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import {
  listNoteKinds,
  createNoteKind,
  patchNoteKind,
  deleteNoteKind,
} from '../../services/note-kind-service.js';

// ---------------------------------------------------------------------------
// Typed error from service layer
interface ServiceError extends Error {
  status?: number;
  code?: string;
}

function handleServiceError(c: Parameters<typeof errorResponse>[0], err: unknown): Response {
  const e = err as ServiceError;
  const status = e.status ?? 500;
  const code = e.code ?? 'internal_server_error';
  const message = e.message ?? 'Unexpected error';
  return errorResponse(c, status, code, message);
}

// ---------------------------------------------------------------------------
// Router

export function buildNoteKindsRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // GET /api/workspaces/:wid/note-kinds — any member with kb.view.own+
  app.get('/workspaces/:wid/note-kinds', rbacGuard('kb', 'view'), async (c) => {
    requireAuth(c);
    try {
      const kinds = await listNoteKinds();
      return c.json({ noteKinds: kinds });
    } catch (err) {
      return handleServiceError(c, err);
    }
  });

  // POST /api/workspaces/:wid/note-kinds — admin only (kb.manage)
  app.post(
    '/workspaces/:wid/note-kinds',
    rbacGuard('kb', 'manage'),
    auditLog('note_kind.created', 'note_kind', (c) => c.get('newNoteKindSlug' as never) as string | null),
    async (c) => {
      const ctx = requireAuth(c);
      const body = await c.req.json<{
        slug?: string;
        label?: string;
        color?: string;
        description?: string;
      }>();

      if (!body.slug || !body.label) {
        return errorResponse(c, 400, 'bad_request', 'slug and label are required');
      }

      try {
        const kind = await createNoteKind({
          slug: body.slug,
          label: body.label,
          color: body.color,
          description: body.description,
          createdByUserId: ctx.userId,
        });
        c.set('newNoteKindSlug' as never, kind.slug as never);
        return c.json({ noteKind: kind }, 201);
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  // PATCH /api/workspaces/:wid/note-kinds/:slug — admin only (kb.manage)
  app.patch(
    '/workspaces/:wid/note-kinds/:slug',
    rbacGuard('kb', 'manage'),
    auditLog('note_kind.updated', 'note_kind', (c) => c.req.param('slug')),
    async (c) => {
      requireAuth(c);
      const slug = c.req.param('slug');
      const body = await c.req.json<{ color?: string; description?: string | null }>();

      try {
        const kind = await patchNoteKind(slug, {
          color: body.color,
          description: body.description,
        });
        return c.json({ noteKind: kind });
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  // DELETE /api/workspaces/:wid/note-kinds/:slug — admin only (kb.manage)
  app.delete(
    '/workspaces/:wid/note-kinds/:slug',
    rbacGuard('kb', 'manage'),
    auditLog('note_kind.deleted', 'note_kind', (c) => c.req.param('slug')),
    async (c) => {
      requireAuth(c);
      const slug = c.req.param('slug');

      try {
        await deleteNoteKind(slug);
        return c.json({ deleted: true, slug });
      } catch (err) {
        return handleServiceError(c, err);
      }
    },
  );

  return app;
}
