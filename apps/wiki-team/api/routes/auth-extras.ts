/**
 * auth-extras.ts — admin-only auth management endpoints
 *
 * POST /api/admin/users/:id/reset-password
 *   Generates a temporary password for the target user.
 *   Returns plaintext ONCE — not stored. Admin must relay to user via secure channel.
 *   Requires caller membershipTier === 'global-admin' (checked via authContext).
 *
 * Security:
 *   - Only global-admin callers may invoke (403 otherwise)
 *   - Generated temp password: 24 random bytes → base64url (always strong)
 *   - Temp password is hashed via argon2id before storage
 *   - Audit log written for every reset (action: 'admin.password-reset')
 *   - Response plaintext is returned exactly once; not stored anywhere
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import type { AuthContextEnv } from '../../auth/auth-context.js';
import { requireAuth } from '../../auth/auth-context.js';
import { errorResponse } from '../middleware/error-handler.js';
import { logger } from '../../lib/logger.js';
import { getDb, schema } from '../../storage/db.js';

// ---------------------------------------------------------------------------
// Router

export function buildAuthExtrasRouter(): Hono<AuthContextEnv> {
  const app = new Hono<AuthContextEnv>();

  /**
   * POST /api/admin/users/:id/reset-password
   *
   * Admin resets a user's password. Returns temp password plaintext once.
   * Caller must be global-admin (membershipTier check).
   */
  app.post('/admin/users/:id/reset-password', async (c) => {
    const ctx = requireAuth(c);

    // Global-admin gate: only global-admin tier may reset other users' passwords
    if (ctx.membershipTier !== 'global-admin') {
      return errorResponse(c, 403, 'forbidden', 'Only global administrators may reset user passwords');
    }

    const targetUserId = c.req.param('id');
    if (!targetUserId) {
      return errorResponse(c, 400, 'bad_request', 'User ID is required');
    }

    // Prevent admin from using this endpoint to reset their own password
    // (use standard Better Auth forgot-password flow instead)
    if (targetUserId === ctx.userId) {
      return errorResponse(c, 400, 'bad_request', 'Use the forgot-password flow to reset your own password');
    }

    const db = getDb();

    // Verify target user exists
    const [targetUser] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, targetUserId))
      .limit(1);

    if (!targetUser) {
      return errorResponse(c, 404, 'not_found', 'User not found');
    }

    // Generate strong temporary password: 24 random bytes → base64url (32 chars)
    const tempPasswordPlain = randomBytes(24).toString('base64url');

    // Hash via argon2id
    const argon2 = await import('@node-rs/argon2');
    const tempPasswordHash = await argon2.hash(tempPasswordPlain);

    // Update user's password_hash
    await db
      .update(schema.users)
      .set({ passwordHash: tempPasswordHash, updatedAt: new Date() })
      .where(eq(schema.users.id, targetUserId));

    // Audit log (fire-and-forget)
    void writePasswordResetAudit(db, ctx.userId, targetUserId).catch((err) => {
      logger.error({ err: err instanceof Error ? err.message : err }, '[auth-extras] audit write failed');
    });

    // Return temp password ONCE — admin must relay via secure channel
    return c.json({
      userId: targetUserId,
      temporaryPassword: tempPasswordPlain,
      message: 'Temporary password set. Share via secure channel. User should change on next login.',
      expiresNote: 'No automatic expiry — user must change password after receiving it.',
    }, 200);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Internal audit helper

async function writePasswordResetAudit(
  db: ReturnType<typeof getDb>,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  // Use a system workspace ID for global-admin actions with no workspace context
  const SYSTEM_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000';

  await db.insert(schema.auditEvents).values({
    id: crypto.randomUUID(),
    workspaceId: SYSTEM_WORKSPACE_ID,
    actorId,
    action: 'admin.password-reset',
    resourceType: 'user',
    resourceId: targetUserId,
    payload: { source: 'admin-reset' },
    ipAddress: null,
    createdAt: new Date(),
  });
}
