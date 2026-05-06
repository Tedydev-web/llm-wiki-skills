/**
 * materials.ts — /api/workspaces/:id/materials + compile + jobs
 *
 * GET    /api/workspaces/:id/materials           — list materials
 * POST   /api/workspaces/:id/materials           — multipart upload → MinIO + DB row
 * GET    /api/workspaces/:id/materials/:mid      — get material metadata
 * DELETE /api/workspaces/:id/materials/:mid      — soft-delete (mark failed)
 * POST   /api/workspaces/:id/materials/:mid/compile — enqueue BullMQ wiki-compile job
 * GET    /api/jobs/:jid                          — poll job status
 *
 * Security: Redis health-check BEFORE MinIO write on upload (no partial state).
 * Body limit: 100 MB. Content-type allowlist enforced.
 */

import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { AuthContextEnv } from '../middleware/auth.js';
import { requireAuth } from '../../auth/auth-context.js';
import { rbacGuard } from '../middleware/rbac-guard.js';
import { auditLog } from '../middleware/audit-log.js';
import { errorResponse } from '../middleware/error-handler.js';
import { getDb, schema } from '../../storage/db.js';
import { getObjectStore, sanitizeObjectKey } from '../../storage/object-store.js';
import type { WikiCompileJobData } from '../../jobs/wiki-compile/index.js';

// ---------------------------------------------------------------------------
// Constants

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/markdown',
  'text/plain',
  'text/html',
]);

const BODY_LIMIT_BYTES = 100 * 1024 * 1024; // 100 MB

// Default KB ID placeholder (workspace root KB) — real KB resolution is P10+
const DEFAULT_KB_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------

export function buildMaterialsRouter(redisUrl: string): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  // Lazy BullMQ producer + a separate Redis probe client for health-checks
  let _queue: Queue<WikiCompileJobData> | null = null;
  let _redisProbe: Redis | null = null;

  function getQueue(): Queue<WikiCompileJobData> {
    if (!_queue) {
      _queue = new Queue<WikiCompileJobData>('wiki-compile', {
        connection: { lazyConnect: true, url: redisUrl },
      });
    }
    return _queue;
  }

  // Separate ioredis client used only for pre-upload health-check ping
  function getRedisProbe(): Redis {
    if (!_redisProbe) {
      _redisProbe = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
    }
    return _redisProbe;
  }

  // ---- GET /api/workspaces/:id/materials ----
  app.get('/workspaces/:id/materials', async (c) => {
    requireAuth(c);
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.materials)
      .where(eq(schema.materials.workspaceId, c.req.param('id')));
    return c.json({ materials: rows });
  });

  // ---- POST /api/workspaces/:id/materials — multipart upload ----
  app.post(
    '/workspaces/:id/materials',
    rbacGuard('kb', 'edit'),
    auditLog('material.uploaded', 'material', (c) => c.get('newMaterialId' as never) as string | null),
    async (c) => {
      const ctx = requireAuth(c);
      const wid = c.req.param('id');

      // 1. Redis health-check BEFORE MinIO write (fail-fast, no partial state)
      try {
        await getRedisProbe().ping();
      } catch {
        return errorResponse(
          c,
          503,
          'service_unavailable',
          'Queue service unavailable. Upload rejected to prevent partial state. Retry when Redis is healthy.',
        );
      }

      // 2. Parse multipart form
      let formData: FormData;
      try {
        formData = await c.req.formData();
      } catch {
        return errorResponse(c, 400, 'bad_request', 'Expected multipart/form-data body');
      }

      const file = formData.get('file');
      if (!file || !(file instanceof File)) {
        return errorResponse(c, 400, 'bad_request', 'file field is required in multipart body');
      }

      // 3. Size guard
      if (file.size > BODY_LIMIT_BYTES) {
        return errorResponse(c, 400, 'bad_request', `File too large. Maximum size is 100 MB, got ${file.size} bytes`);
      }

      // 4. Content-type allowlist
      const mimeType = file.type || 'application/octet-stream';
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        return errorResponse(
          c,
          400,
          'bad_request',
          `Content type "${mimeType}" is not allowed. Accepted: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
        );
      }

      // 5. Sanitize filename for object key
      let safeFilename: string;
      try {
        safeFilename = sanitizeObjectKey(file.name || 'upload');
      } catch (err) {
        return errorResponse(c, 400, 'bad_request', `Invalid filename: ${(err as Error).message}`);
      }

      // 6. Insert DB row first (materialId needed for storage key)
      const materialId = crypto.randomUUID();
      const storageKey = `${wid}/${materialId}/${safeFilename}`;
      const db = getDb();

      await db.insert(schema.materials).values({
        id: materialId,
        workspaceId: wid,
        kbId: DEFAULT_KB_ID,
        fileName: file.name.slice(0, 255),
        mimeType,
        storageKey,
        sizeBytes: file.size,
        status: 'pending',
        dedupeKey: `ingest:${materialId}`,
        progress: 0,
        pageCount: 0,
        uploadedBy: ctx.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 7. Upload to MinIO
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await getObjectStore().upload(storageKey, bytes, { contentType: mimeType });
      } catch (err) {
        // Roll back DB row if MinIO write fails
        await db.delete(schema.materials).where(eq(schema.materials.id, materialId));
        return errorResponse(c, 503, 'service_unavailable', `Object storage upload failed: ${(err as Error).message}`);
      }

      c.set('newMaterialId' as never, materialId as never);
      return c.json({ materialId, storageKey, status: 'pending' }, 201);
    },
  );

  // ---- GET /api/workspaces/:id/materials/:mid ----
  app.get('/workspaces/:id/materials/:mid', async (c) => {
    requireAuth(c);
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.materials)
      .where(
        and(
          eq(schema.materials.id, c.req.param('mid')),
          eq(schema.materials.workspaceId, c.req.param('id')),
        ),
      );

    if (!row) return errorResponse(c, 404, 'not_found', 'Material not found');
    return c.json(row);
  });

  // ---- DELETE /api/workspaces/:id/materials/:mid ----
  app.delete(
    '/workspaces/:id/materials/:mid',
    rbacGuard('kb', 'edit'),
    auditLog('material.deleted', 'material', (c) => c.req.param('mid')),
    async (c) => {
      const db = getDb();
      await db
        .update(schema.materials)
        .set({ status: 'failed', failedReason: 'deleted_by_user', updatedAt: new Date() })
        .where(
          and(
            eq(schema.materials.id, c.req.param('mid')),
            eq(schema.materials.workspaceId, c.req.param('id')),
          ),
        );
      return c.json({ deleted: true, materialId: c.req.param('mid') });
    },
  );

  // ---- POST /api/workspaces/:id/materials/:mid/compile — enqueue job ----
  app.post(
    '/workspaces/:id/materials/:mid/compile',
    rbacGuard('kb', 'edit'),
    auditLog('material.compile_enqueued', 'material', (c) => c.req.param('mid')),
    async (c) => {
      const ctx = requireAuth(c);
      const wid = c.req.param('id');
      const mid = c.req.param('mid');

      // Verify material exists and belongs to workspace
      const db = getDb();
      const [material] = await db
        .select()
        .from(schema.materials)
        .where(and(eq(schema.materials.id, mid), eq(schema.materials.workspaceId, wid)));

      if (!material) return errorResponse(c, 404, 'not_found', 'Material not found');

      // Enqueue BullMQ job
      const promptVersionId = process.env['WIKI_COMPILE_PROMPT_VERSION'] ?? 'v1';
      const jobData: WikiCompileJobData = {
        workspaceId: wid,
        materialId: mid,
        kbId: material.kbId,
        requestedBy: ctx.userId,
        promptVersionId,
      };

      const job = await getQueue().add('wiki-compile', jobData, {
        jobId: `ingest:${mid}`,         // BullMQ dedup key per ADR 011
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      });

      // Persist job tracking row to DB for HTTP polling
      const jobRowId = crypto.randomUUID();
      await db.insert(schema.jobs).values({
        id: jobRowId,
        queueName: 'wiki-compile',
        bullJobId: job.id ?? `ingest:${mid}`,
        materialId: mid,
        workspaceId: wid,
        state: 'waiting',
        progress: 0,
        attemptsMade: 0,
        maxAttempts: 3,
        enqueuedAt: new Date(),
      });

      return c.json({ jobId: jobRowId, bullJobId: job.id, status: 'waiting' }, 202);
    },
  );

  // ---- GET /api/jobs/:jid — poll job status ----
  app.get('/jobs/:jid', async (c) => {
    requireAuth(c);
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, c.req.param('jid')));

    if (!row) return errorResponse(c, 404, 'not_found', 'Job not found');

    // Sync progress from BullMQ if not terminal
    if (row.state !== 'completed' && row.state !== 'failed') {
      try {
        const bullJob = await getQueue().getJob(row.bullJobId);
        if (bullJob) {
          const bullState = await bullJob.getState();
          const progress = typeof bullJob.progress === 'number' ? bullJob.progress : 0;
          await db
            .update(schema.jobs)
            .set({ state: bullState, progress, attemptsMade: bullJob.attemptsMade })
            .where(eq(schema.jobs.id, row.id));
          return c.json({ ...row, state: bullState, progress });
        }
      } catch {
        // BullMQ unavailable — return cached DB state
      }
    }

    return c.json(row);
  });

  return app;
}
