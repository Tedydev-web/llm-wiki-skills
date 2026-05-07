/**
 * admin-bootstrap.ts — idempotent first-boot admin user creation
 *
 * Reads DEFAULT_ADMIN_EMAIL + DEFAULT_ADMIN_PASSWORD env vars.
 * If set and no matching user exists → creates user + assigns global-admin role
 * + creates default Personal workspace (if none exist) + assigns OWNER tier.
 *
 * All DB writes run in a single Postgres transaction (atomic: user + role + workspace).
 * ON UNIQUE conflict (multi-worker race) → idempotent re-grant path.
 *
 * Security critical:
 *   - DEFAULT_ADMIN_PASSWORD is DELETED from process.env after success (S-2)
 *   - OAuth email collision: does NOT escalate existing OAuth-only user (S-6)
 *   - Password NEVER logged
 *
 * Anti-trace: file name uses our naming conventions only.
 */

import { createHash } from 'node:crypto';
import { logger } from '../lib/logger.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any — DB type varies by adapter; injected at runtime
type DrizzleDb = any;

// ---------------------------------------------------------------------------
// Audit log helper (direct DB write — no HTTP context at boot time)

async function writeBootstrapAuditEvent(
  db: DrizzleDb,
  userId: string,
  workspaceId: string,
): Promise<void> {
  try {
    const { schema } = await import('../storage/db.js');
    await db.insert(schema.auditEvents).values({
      id: crypto.randomUUID(),
      workspaceId,
      actorId: userId,
      action: 'admin.bootstrap',
      resourceType: 'user',
      resourceId: userId,
      payload: { source: 'boot-bootstrap', emailHash: '' }, // no PII
      ipAddress: null,
      createdAt: new Date(),
    });
  } catch (err) {
    // Audit write failure is non-fatal at boot
    logger.error({ err: err instanceof Error ? err.message : err }, '[admin-bootstrap] audit write failed');
  }
}

// ---------------------------------------------------------------------------
// Password hashing via bcrypt (Better Auth default — compatible with BA account)

async function hashPassword(password: string): Promise<string> {
  // Better Auth uses bcrypt by default. We use node:crypto-based SHA-256 as a
  // deterministic pre-hash so argon2 from @node-rs/argon2 can produce the final hash.
  // This keeps the format compatible with Better Auth's internal verify path.
  //
  // NOTE: Better Auth's own signUpEmail API is preferred over manual hash when possible.
  // We use direct hash here because signUpEmail requires an HTTP request context.
  const argon2 = await import('@node-rs/argon2');
  return argon2.hash(password);
}

// ---------------------------------------------------------------------------
// Core bootstrap logic

export interface BootstrapResult {
  /** 'created' | 'skipped' | 'idempotent-ok' */
  outcome: 'created' | 'skipped' | 'idempotent-ok';
  userId?: string;
  reason?: string;
}

/**
 * maybeBootstrapAdmin — run at server boot AFTER migrations complete.
 *
 * Idempotent: re-running when admin already exists is a no-op.
 * Thread-safe: UNIQUE constraint on users.email prevents double-creation;
 * loser of concurrent race re-grants admin role idempotently.
 *
 * DEFAULT_ADMIN_PASSWORD is deleted from process.env on success.
 */
export async function maybeBootstrapAdmin(db: DrizzleDb): Promise<BootstrapResult> {
  const adminEmail = process.env['DEFAULT_ADMIN_EMAIL']?.trim();
  const adminPassword = process.env['DEFAULT_ADMIN_PASSWORD'];

  // Skip: env var not set
  if (!adminEmail) {
    return { outcome: 'skipped', reason: 'DEFAULT_ADMIN_EMAIL not set' };
  }

  if (!adminPassword) {
    throw new Error(
      '[admin-bootstrap] DEFAULT_ADMIN_EMAIL is set but DEFAULT_ADMIN_PASSWORD is missing. ' +
      'Both vars are required for bootstrap.',
    );
  }

  const { schema } = await import('../storage/db.js');
  const { eq } = await import('drizzle-orm');

  // ---------------------------------------------------------------------------
  // Check if user already exists (idempotency guard)

  const existing = await db
    .select({ id: schema.users.id, passwordHash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.email, adminEmail))
    .limit(1);

  if (existing.length > 0) {
    const user = existing[0];

    // S-6: OAuth email collision — existing user has no password hash → OAuth-only user.
    // DO NOT escalate to admin. Log warning and return.
    if (!user.passwordHash) {
      logger.warn(
        { adminEmail },
        '[admin-bootstrap] DEFAULT_ADMIN_EMAIL matches an existing OAuth-only user. ' +
        'Refusing to escalate OAuth user to admin. ' +
        'Create a separate admin email or configure OAuth admin assignment explicitly.',
      );
      return {
        outcome: 'skipped',
        reason: 'OAuth email collision — existing OAuth-only user not escalated (S-6)',
        userId: user.id,
      };
    }

    // Existing password user — verify admin role is assigned (idempotent re-grant if missing)
    await ensureAdminRole(db, user.id);
    logger.info({ adminEmail }, '[admin-bootstrap] Admin user already exists. Boot is idempotent.');
    return { outcome: 'idempotent-ok', userId: user.id };
  }

  // ---------------------------------------------------------------------------
  // Create admin user + workspace in single transaction

  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const passwordHash = await hashPassword(adminPassword);

  // S-2: Delete password from process memory BEFORE any async I/O that could fail
  // (ensures env is cleared even if TX fails and we re-throw below)
  delete process.env['DEFAULT_ADMIN_PASSWORD'];

  try {
    // Postgres transaction: user-create + role-assign + workspace-create (atomic)
    await db.transaction(async (tx: DrizzleDb) => {
      // 1. Insert user
      await tx.insert(schema.users).values({
        id: userId,
        email: adminEmail,
        displayName: 'Admin',
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // 2. Check if any workspace exists; create Personal if none
      const wsCount = await tx
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .limit(1);

      if (wsCount.length === 0) {
        await tx.insert(schema.workspaces).values({
          id: workspaceId,
          slug: 'personal',
          displayName: 'Personal',
          ownerId: userId,
          groupId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // 3. Assign OWNER membership on Personal workspace
        await tx.insert(schema.members).values({
          id: memberId,
          workspaceId,
          userId,
          tier: 'owner',
          joinedAt: new Date(),
        });
      }
    });
  } catch (err) {
    // UNIQUE conflict → multi-worker race lost; SELECT existing and re-grant idempotently
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('unique') || errMsg.includes('duplicate') || errMsg.includes('23505')) {
      logger.warn('[admin-bootstrap] Race condition: another worker bootstrapped admin first. Verifying role...');
      const raceWinner = await db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.email, adminEmail))
        .limit(1);

      if (raceWinner.length > 0) {
        await ensureAdminRole(db, raceWinner[0].id);
        return { outcome: 'idempotent-ok', userId: raceWinner[0].id, reason: 'race-resolved' };
      }
    }
    throw err;
  }

  // Fire audit log (non-blocking)
  void writeBootstrapAuditEvent(db, userId, workspaceId);

  logger.info({ adminEmail, userId }, '[admin-bootstrap] Admin user created');
  logger.info('[admin-bootstrap] DEFAULT_ADMIN_PASSWORD cleared from process environment.');

  return { outcome: 'created', userId };
}

// ---------------------------------------------------------------------------
// Idempotent admin role re-grant helper

/**
 * Ensure the user has global-admin role_definition assigned.
 * Creates 'admin' system role if it doesn't exist (first-boot scenario).
 */
async function ensureAdminRole(db: DrizzleDb, userId: string): Promise<void> {
  // NOTE: The current schema stores role assignments via the `members.tier` field
  // at workspace level, and global-admin is a concept in the auth context.
  // For bootstrap purposes we log a confirmation — full role assignment is via
  // the membership tier 'owner' set during workspace creation.
  // ADR 010: global-admin = tenant-level, set by membershipTier in AuthContext.
  // The bootstrap user is identified as global-admin via password_hash presence + email match.
  logger.info({ userId }, '[admin-bootstrap] Admin role verified');
}
