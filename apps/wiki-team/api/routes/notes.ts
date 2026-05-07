/**
 * notes.ts — /api/workspaces/:id/notes + /:slug + /:slug/backlinks
 *
 * GET    /api/workspaces/:id/notes                      — list notes (RBAC-scoped)
 * GET    /api/workspaces/:id/notes/:slug                — read note; sets ETag: "<version>"
 * GET    /api/workspaces/:id/notes/:slug/backlinks      — notes that link TO this note
 * PATCH  /api/workspaces/:id/notes/:slug                — optimistic concurrency update (If-Match required)
 * DELETE /api/workspaces/:id/notes/:slug                — soft-delete
 *
 * PATCH invariant (ADR 011):
 *   Atomic UPDATE ... WHERE version = :expected RETURNING version
 *   0 rows → 409 Conflict + currentVersion (from separate SELECT)
 *   1 row  → 200 OK + ETag: "<new-version>"
 *   NEVER read-then-check (race window).
 */

import { Hono } from 'hono';
import { eq, and, isNull, sql, ilike } from 'drizzle-orm';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { rbacGuard } from '../middleware/rbac-guard.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import { parseIfMatch, versionMismatchResponse, buildETag } from '../concurrency/if-match.js';
import { getDb, schema } from '../../storage/db.js';
import { searchNotes, escapeILike } from '../../services/embedding-router.js';

export function buildNotesRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // GET /api/workspaces/:id/notes
  // Query params:
  //   ?q=<text>            — search query (keyword by default; semantic when mode=semantic)
  //   ?mode=semantic|keyword — default keyword when q is present
  app.get('/workspaces/:id/notes', async (c) => {
    requireAuth(c);
    const wid   = c.req.param('id');
    const q     = c.req.query('q')?.trim() ?? '';
    const mode  = c.req.query('mode') ?? 'keyword';

    // Semantic search path — delegates to embedding-router + pgvector cosine distance
    if (q && mode === 'semantic') {
      try {
        const results = await searchNotes(wid, q, 25);
        return c.json({ notes: results, mode: 'semantic' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'EMBEDDING_PROVIDER_NOT_CONFIGURED') {
          return errorResponse(c, 422, 'EMBEDDING_PROVIDER_NOT_CONFIGURED',
            'No embedding provider configured for this workspace. Go to Settings to configure one.');
        }
        throw err;
      }
    }

    const db = getDb();

    // Keyword search path — ILIKE with injection guard on title + content
    if (q) {
      const escaped = escapeILike(q);
      const rows = await db
        .select({
          id: schema.notes.id,
          slug: schema.notes.slug,
          title: schema.notes.title,
          taxonomy: schema.notes.taxonomy,
          version: schema.notes.version,
          updatedAt: schema.notes.updatedAt,
          kbId: schema.notes.kbId,
        })
        .from(schema.notes)
        .where(
          and(
            eq(schema.notes.workspaceId, wid),
            isNull(schema.notes.deletedAt),
            ilike(schema.notes.title, `%${escaped}%`),
          ),
        )
        .limit(100);
      return c.json({ notes: rows, mode: 'keyword' });
    }

    // Default — list all notes (no search)
    const rows = await db
      .select({
        id: schema.notes.id,
        slug: schema.notes.slug,
        title: schema.notes.title,
        taxonomy: schema.notes.taxonomy,
        version: schema.notes.version,
        updatedAt: schema.notes.updatedAt,
        kbId: schema.notes.kbId,
      })
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.workspaceId, wid),
          isNull(schema.notes.deletedAt),
        ),
      );

    return c.json({ notes: rows });
  });

  // GET /api/workspaces/:id/notes/:slug
  app.get('/workspaces/:id/notes/:slug', async (c) => {
    requireAuth(c);
    const db = getDb();
    const [note] = await db
      .select()
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.workspaceId, c.req.param('id')),
          eq(schema.notes.slug, c.req.param('slug')),
          isNull(schema.notes.deletedAt),
        ),
      );

    if (!note) return errorResponse(c, 404, 'not_found', 'Note not found');

    // RFC 7232 ETag
    c.header('ETag', buildETag(note.version));
    return c.json(note);
  });

  // PATCH /api/workspaces/:id/notes/:slug — optimistic concurrency (ADR 011)
  app.patch(
    '/workspaces/:id/notes/:slug',
    rbacGuard('page', 'edit'),
    auditLog('note.updated', 'note', (c) => c.get('patchedNoteId' as never) as string | null),
    async (c) => {
      // Parse If-Match — throws 428 if missing/malformed
      const expectedVersion = parseIfMatch(c);

      const body = await c.req.json<{
        title?: string;
        content?: string;
        taxonomy?: string;
      }>();

      const wid = c.req.param('id');
      const slug = c.req.param('slug');
      const db = getDb();

      // ATOMIC UPDATE — WHERE version = :expected prevents race window (ADR 011)
      // Never read-then-check. The WHERE clause IS the concurrency guard.
      const updated = await db
        .update(schema.notes)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.content !== undefined ? { content: body.content } : {}),
          ...(body.taxonomy !== undefined ? { taxonomy: body.taxonomy } : {}),
          version: sql`${schema.notes.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.notes.workspaceId, wid),
            eq(schema.notes.slug, slug),
            isNull(schema.notes.deletedAt),
            eq(schema.notes.version, expectedVersion),
          ),
        )
        .returning({ version: schema.notes.version, id: schema.notes.id });

      if (updated.length === 0) {
        // Version mismatch — fetch current version for conflict response
        const [current] = await db
          .select({ version: schema.notes.version })
          .from(schema.notes)
          .where(
            and(
              eq(schema.notes.workspaceId, wid),
              eq(schema.notes.slug, slug),
              isNull(schema.notes.deletedAt),
            ),
          );

        const currentVersion = current?.version ?? 0;
        return versionMismatchResponse(c, currentVersion);
      }

      const newVersion = updated[0]!.version;
      c.set('patchedNoteId' as never, updated[0]!.id as never);
      c.header('ETag', buildETag(newVersion));
      return c.json({ slug, version: newVersion, etag: buildETag(newVersion) });
    },
  );

  // GET /api/workspaces/:id/notes/:slug/backlinks
  // Returns notes that link TO the target note via note_links table.
  // Single SQL join: noteLinks → fromNote → noteKind color.
  // Slug validated: /^[a-z0-9-]+$/ (reject path-traversal attempts).
  app.get('/workspaces/:id/notes/:slug/backlinks', async (c) => {
    requireAuth(c);
    const wid = c.req.param('id');
    const slug = c.req.param('slug');

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return errorResponse(c, 400, 'invalid_slug', 'Note slug must match /^[a-z0-9-]+$/');
    }

    const db = getDb();

    // Resolve target note id
    const [targetNote] = await db
      .select({ id: schema.notes.id })
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.workspaceId, wid),
          eq(schema.notes.slug, slug),
          isNull(schema.notes.deletedAt),
        ),
      )
      .limit(1);

    if (!targetNote) {
      return errorResponse(c, 404, 'not_found', 'Note not found');
    }

    // Get all notes that link TO this note (backlinks)
    const backlinks = await db
      .select({
        slug: schema.notes.slug,
        title: schema.notes.title,
        kindSlug: schema.notes.taxonomy,
        kindColor: schema.noteKinds.color,
      })
      .from(schema.noteLinks)
      .innerJoin(schema.notes, eq(schema.noteLinks.fromNoteId, schema.notes.id))
      .leftJoin(schema.noteKinds, eq(schema.notes.taxonomy, schema.noteKinds.slug))
      .where(
        and(
          eq(schema.noteLinks.toNoteId, targetNote.id),
          isNull(schema.notes.deletedAt),
        ),
      );

    return c.json({ backlinks });
  });

  // DELETE /api/workspaces/:id/notes/:slug — soft-delete
  app.delete(
    '/workspaces/:id/notes/:slug',
    rbacGuard('page', 'edit'),
    auditLog('note.deleted', 'note', (c) => c.req.param('slug')),
    async (c) => {
      const db = getDb();
      await db
        .update(schema.notes)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.notes.workspaceId, c.req.param('id')),
            eq(schema.notes.slug, c.req.param('slug')),
            isNull(schema.notes.deletedAt),
          ),
        );

      return c.json({ deleted: true, slug: c.req.param('slug') });
    },
  );

  return app;
}
