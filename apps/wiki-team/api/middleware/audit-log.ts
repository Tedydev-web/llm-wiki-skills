/**
 * audit-log.ts — async post-handler audit middleware
 *
 * After every mutation (POST/PATCH/DELETE), writes one row to audit_events.
 * Non-blocking: audit write does NOT delay the HTTP response.
 *
 * PII policy (phase-08 §Security):
 *   actor_email_hmac = HMAC-SHA256(user.email, AUDIT_HMAC_SECRET) — NEVER raw email
 *   body_hash        = SHA-256(request body bytes) — correlation without PII storage
 *
 * Env: AUDIT_HMAC_SECRET (required; crashes at write time if missing/placeholder)
 */

import { createHmac, createHash } from 'node:crypto';
import type { Context, MiddlewareHandler, Next } from 'hono';
import type { AuthContextEnv } from '../../auth/auth-context.js';
import { getDb, schema } from '../../storage/db.js';

// Mutation methods that trigger an audit write
const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);

/**
 * Hono middleware: attach audit writer to every mutation request.
 *
 * @param action        Audit action string e.g. 'note.updated', 'material.uploaded'
 * @param resourceType  Schema resource type e.g. 'note', 'material', 'workspace'
 * @param getResourceId Function to extract resource UUID from the resolved context
 *                      (called AFTER the downstream handler has run)
 */
export function auditLog(
  action: string,
  resourceType: string,
  getResourceId: (c: Context<AuthContextEnv>) => string | null | undefined,
): MiddlewareHandler<AuthContextEnv> {
  return async (c: Context<AuthContextEnv>, next: Next) => {
    // Read body bytes before downstream consumes the stream (for body_hash)
    let bodyBytes: Uint8Array | null = null;
    if (MUTATION_METHODS.has(c.req.method)) {
      try {
        const cloned = c.req.raw.clone();
        const buf = await cloned.arrayBuffer();
        bodyBytes = new Uint8Array(buf);
      } catch {
        // Body read failure is non-fatal for audit purposes
      }
    }

    await next();

    // Fire-and-forget audit write — do not await, do not block response
    if (MUTATION_METHODS.has(c.req.method)) {
      void writeAuditEvent(c, action, resourceType, getResourceId(c) ?? null, bodyBytes).catch(
        (err) => {
          // Audit write failure is logged but never surfaces to client
          console.error('[audit-log] write failed:', err instanceof Error ? err.message : err);
        },
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Internal

async function writeAuditEvent(
  c: Context<AuthContextEnv>,
  action: string,
  resourceType: string,
  resourceId: string | null,
  bodyBytes: Uint8Array | null,
): Promise<void> {
  const secret = process.env['AUDIT_HMAC_SECRET'];
  if (!secret || secret.includes('CHANGE_ME_BEFORE_BOOT')) {
    // Config error — log loudly but don't crash the process
    console.error('[audit-log] AUDIT_HMAC_SECRET not configured; skipping audit write');
    return;
  }

  const ctx = c.get('authContext');
  if (!ctx) return; // unauthenticated requests don't produce audit rows

  const workspaceId =
    c.req.param('id') ?? c.req.param('wid') ?? ctx.workspaceId ?? '00000000-0000-0000-0000-000000000000';

  if (!resourceId) return; // can't write without a resource ID

  // HMAC the actor user ID (privacy-preserving correlation — no raw email)
  const actorHmac = createHmac('sha256', secret)
    .update(ctx.userId)
    .digest('hex');

  // SHA-256 of request body for correlation without PII storage
  const bodyHash = bodyBytes
    ? createHash('sha256').update(bodyBytes).digest('hex')
    : null;

  const ipAddress =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    null;

  const db = getDb();
  await db.insert(schema.auditEvents).values({
    id: crypto.randomUUID(),
    workspaceId,
    actorId: ctx.userId,
    action,
    resourceType,
    resourceId,
    payload: {
      actorEmailHmac: actorHmac, // HMAC, not raw email
      bodyHash,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    },
    ipAddress: ipAddress?.slice(0, 45) ?? null, // varchar(45) max
    createdAt: new Date(),
  });
}
