/**
 * mcp-token-service.ts — MCP bearer token lifecycle (issue / verify / revoke / rotate)
 *
 * Security model per ADR 012 + Phase 04 W0 hardening:
 *
 *   Storage:
 *     prefix_lookup  = HMAC-SHA256(plaintext, BETTER_AUTH_SECRET)[0..16 hex]
 *     token_hash     = argon2id(plaintext, { memoryCost: 65536, timeCost: 3, parallelism: 4 })
 *     plaintext      returned ONCE at issuance — never logged, never re-fetchable
 *
 *   Verify (constant-time, timing-oracle safe):
 *     1. Compute prefix_lookup from presented token
 *     2. SELECT row WHERE prefix_lookup = ? AND revoked_at IS NULL
 *     3. If no row → run argon2id.verify(DUMMY_HASH, presented) then return null
 *     4. If row expired or revoked → run argon2id.verify(DUMMY_HASH, presented) then return null
 *     5. argon2id.verify(row.token_hash, presented) → build AuthContext on match
 *
 *   Rate limit:
 *     Per-user max 10 tokens issued per 24 h (Redis key token-issue-rate:<userId>:<YYYY-MM-DD>)
 *     Reject 429 if exceeded.
 *
 *   Step-up reauth:
 *     Session must be ≤ 15 min old at issuance time — enforced by caller via sessionCreatedAt param.
 *
 * IMPORTANT: This module is a set of pure functions — NO class wrapper.
 *
 * P03 dependency: mcp_tokens table imported from @wiki-team/schema/db.
 * If P03 hasn't landed yet, the DB operations are typed against the column shape
 * documented in the Phase 04 spec: id, prefix_lookup, token_hash, user_id,
 * workspace_id, scopes (JSONB), expires_at, revoked_at, created_at.
 */

import { hash as argon2Hash, verify as argon2Verify } from '@node-rs/argon2';
import type { PermissionGrant } from '@wiki-team/schema';
import type { AuthContext } from './auth-context.js';
import { computePrefixLookup, generateMcpTokenId } from './token-id.js';

// ---------------------------------------------------------------------------
// argon2id parameters (ADR 012 + phase-04 security §)

const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
} as const;

/**
 * DUMMY_HASH — pre-computed argon2id hash of a fixed sentinel string.
 * Used for constant-time burns on verify-path misses.
 * Initialised once at module load; never changes at runtime.
 *
 * We compute it lazily (first call) and cache it — avoids blocking module import
 * while still ensuring the hash is available before any verify call.
 */
let _dummyHash: string | null = null;
const DUMMY_PLAINTEXT = 'wkt_DUMMY_CONSTANT_TIME_BURN_SENTINEL_VALUE_00';

async function getDummyHash(): Promise<string> {
  if (_dummyHash === null) {
    _dummyHash = await argon2Hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS);
  }
  return _dummyHash;
}

// ---------------------------------------------------------------------------
// Rate limit constants

const RATE_LIMIT_MAX_TOKENS_PER_DAY = 10;
const STEP_UP_REAUTH_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------------
// DB row shape (P03 owns the actual Drizzle table; we type against the contract)

interface McpTokenRow {
  id: string;
  prefixLookup: string;
  tokenHash: string;
  userId: string;
  workspaceId: string | null;
  scopes: PermissionGrant[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// DB + Redis interface (injected — avoids hard coupling to P03 / BullMQ internals)

export interface McpTokenDb {
  /** Insert a new token row; returns the created row's id */
  insertMcpToken(row: Omit<McpTokenRow, 'createdAt'>): Promise<string>;
  /** Find a non-revoked token by its prefix_lookup value */
  findMcpTokenByPrefixLookup(prefixLookup: string): Promise<McpTokenRow | null>;
  /** Find a token by its row id (for rotate / revoke operations) */
  findMcpTokenById(id: string): Promise<McpTokenRow | null>;
  /** Soft-delete: set revoked_at = now() for the given row id */
  revokeMcpTokenById(id: string): Promise<void>;
  /** Soft-delete all tokens for a user */
  revokeAllMcpTokensByUserId(userId: string): Promise<number>;
  /** Count tokens issued by user in the last 24 h (for rate limiting) */
  countMcpTokensIssuedToday(userId: string, dateKey: string): Promise<number>;
}

export interface McpTokenRedis {
  /** Increment daily issuance counter; returns new count */
  incrIssuanceCounter(userId: string, dateKey: string): Promise<number>;
  /** Set TTL on the rate-limit key (call after incr) */
  expireIssuanceCounter(userId: string, dateKey: string, ttlSeconds: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// issueMcpToken

export interface IssueMcpTokenInput {
  userId: string;
  workspaceId: string | null;
  scopes: PermissionGrant[];
  /** ISO datetime string; null = 90-day default */
  expiresAt: string | null;
  /** Session creation timestamp — enforces step-up reauth (≤ 15 min) */
  sessionCreatedAt: Date;
}

export interface IssueMcpTokenResult {
  /** Plaintext token — return to caller ONCE; never store or log */
  plaintext: string;
  /** DB row id (UUID) — use for revoke/rotate operations */
  tokenId: string;
}

/**
 * Issue a new MCP bearer token.
 *
 * Enforces:
 *   - Step-up reauth: session must be ≤ 15 min old
 *   - Rate limit: ≤ 10 tokens per user per calendar day (UTC)
 *
 * @throws { status: 401, message } if session is stale (step-up required)
 * @throws { status: 429, message } if daily rate limit exceeded
 */
export async function issueMcpToken(
  input: IssueMcpTokenInput,
  db: McpTokenDb,
  redis: McpTokenRedis,
): Promise<IssueMcpTokenResult> {
  // Step-up reauth check
  const sessionAgeMs = Date.now() - input.sessionCreatedAt.getTime();
  if (sessionAgeMs > STEP_UP_REAUTH_MAX_AGE_MS) {
    throw Object.assign(new Error('[auth] Step-up reauth required: session older than 15 minutes'), {
      status: 401,
    });
  }

  // Rate limit check (Redis counter, UTC date key)
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const redisKey = `token-issue-rate:${input.userId}:${dateKey}`;

  // Increment first, then check — atomic-ish (Redis INCR is atomic)
  const newCount = await redis.incrIssuanceCounter(input.userId, dateKey);
  // Set 25-hour TTL on first insert (covers midnight rollover buffer)
  if (newCount === 1) {
    await redis.expireIssuanceCounter(input.userId, dateKey, 25 * 60 * 60);
  }
  if (newCount > RATE_LIMIT_MAX_TOKENS_PER_DAY) {
    throw Object.assign(
      new Error(`[auth] Token issuance rate limit exceeded: max ${RATE_LIMIT_MAX_TOKENS_PER_DAY} per 24 h`),
      { status: 429, retryAfterKey: redisKey },
    );
  }

  // Generate token
  const { plaintext } = generateMcpTokenId();
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) throw new Error('[auth] BETTER_AUTH_SECRET not set');

  const prefixLookup = computePrefixLookup(plaintext, secret);
  const tokenHash = await argon2Hash(plaintext, ARGON2_OPTIONS);

  // Compute expiry: caller-supplied or default 90 days
  const expiresAt = input.expiresAt
    ? new Date(input.expiresAt)
    : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  const tokenId = crypto.randomUUID();

  await db.insertMcpToken({
    id: tokenId,
    prefixLookup,
    tokenHash,
    userId: input.userId,
    workspaceId: input.workspaceId,
    scopes: input.scopes,
    expiresAt,
    revokedAt: null,
  });

  // plaintext returned ONCE — never log, never re-expose
  return { plaintext, tokenId };
}

// ---------------------------------------------------------------------------
// verifyMcpToken

/**
 * Verify a presented MCP bearer token (constant-time path).
 *
 * Returns AuthContext on success, null on any failure.
 * Always runs argon2id regardless of DB lookup result (timing-oracle defence).
 */
export async function verifyMcpToken(
  presented: string,
  db: McpTokenDb,
): Promise<AuthContext | null> {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) throw new Error('[auth] BETTER_AUTH_SECRET not set');

  // Fast format check — still burn time if format is wrong
  if (!presented.startsWith('wkt_')) {
    await argon2Verify(await getDummyHash(), presented, ARGON2_OPTIONS);
    return null;
  }

  const prefixLookup = computePrefixLookup(presented, secret);
  const row = await db.findMcpTokenByPrefixLookup(prefixLookup);

  // Constant-time burn on: no row, revoked, or expired
  if (row === null) {
    await argon2Verify(await getDummyHash(), presented, ARGON2_OPTIONS);
    return null;
  }

  if (row.revokedAt !== null) {
    await argon2Verify(await getDummyHash(), presented, ARGON2_OPTIONS);
    return null;
  }

  if (row.expiresAt !== null && row.expiresAt < new Date()) {
    await argon2Verify(await getDummyHash(), presented, ARGON2_OPTIONS);
    return null;
  }

  // Real verify — only reached when row exists, not revoked, not expired
  const match = await argon2Verify(row.tokenHash, presented, ARGON2_OPTIONS);
  if (!match) return null;

  // Build AuthContext from verified token row
  // membershipTier resolved from scopes: highest tier wins
  const membershipTier = resolveHighestTierFromScopes(row.scopes, row.workspaceId);

  const ctx: AuthContext = {
    userId: row.userId,
    workspaceId: row.workspaceId,
    membershipTier,
    permissions: row.scopes,
    source: 'mcp-token',
  };

  return ctx;
}

// ---------------------------------------------------------------------------
// revokeMcpToken

/**
 * Soft-delete a single token by id.
 * Caller must hold `mcp.manage.all` or be the token owner (`mcp.view.own`).
 * Permission enforcement is the caller's responsibility (P08 HTTP handler).
 *
 * @throws Error if token not found or already revoked
 */
export async function revokeMcpToken(
  tokenId: string,
  callerId: string,
  db: McpTokenDb,
): Promise<void> {
  const row = await db.findMcpTokenById(tokenId);
  if (!row) {
    throw Object.assign(new Error(`[auth] Token not found: ${tokenId}`), { status: 404 });
  }
  if (row.userId !== callerId) {
    throw Object.assign(
      new Error(`[auth] Caller ${callerId} does not own token ${tokenId}`),
      { status: 403 },
    );
  }
  if (row.revokedAt !== null) {
    // Idempotent: already revoked is not an error for revoke operations
    return;
  }
  await db.revokeMcpTokenById(tokenId);
}

// ---------------------------------------------------------------------------
// rotateMcpToken

export interface RotateMcpTokenResult {
  /** New plaintext token — return to caller ONCE */
  plaintext: string;
  /** New DB row id */
  newTokenId: string;
}

/**
 * Revoke the old token and issue a fresh one in a logical transaction.
 * The DB adapter is expected to handle atomicity (P03 responsibility).
 *
 * @throws { status: 404 } if old token not found
 * @throws { status: 403 } if caller doesn't own the token
 */
export async function rotateMcpToken(
  oldTokenId: string,
  callerId: string,
  sessionCreatedAt: Date,
  db: McpTokenDb,
  redis: McpTokenRedis,
): Promise<RotateMcpTokenResult> {
  const old = await db.findMcpTokenById(oldTokenId);
  if (!old) {
    throw Object.assign(new Error(`[auth] Token not found: ${oldTokenId}`), { status: 404 });
  }
  if (old.userId !== callerId) {
    throw Object.assign(
      new Error(`[auth] Caller ${callerId} does not own token ${oldTokenId}`),
      { status: 403 },
    );
  }

  // Revoke old token
  await db.revokeMcpTokenById(oldTokenId);

  // Issue new token with same scopes + workspaceId
  const result = await issueMcpToken(
    {
      userId: callerId,
      workspaceId: old.workspaceId,
      scopes: old.scopes,
      expiresAt: old.expiresAt ? old.expiresAt.toISOString() : null,
      sessionCreatedAt,
    },
    db,
    redis,
  );

  return { plaintext: result.plaintext, newTokenId: result.tokenId };
}

// ---------------------------------------------------------------------------
// revokeAllMcpTokens

/**
 * Soft-delete all MCP tokens belonging to a user.
 * Used for account deletion or security incident response.
 * P08 endpoint: POST /api/me/tokens/revoke-all
 *
 * @returns count of tokens revoked
 */
export async function revokeAllMcpTokens(
  userId: string,
  db: McpTokenDb,
): Promise<number> {
  return db.revokeAllMcpTokensByUserId(userId);
}

// ---------------------------------------------------------------------------
// Internal helpers

/**
 * Derive highest MembershipTier from granted scopes.
 * Falls back to 'observer' if no workspace-relevant scopes present.
 * If workspaceId is null (global admin context), returns 'global-admin'.
 */
function resolveHighestTierFromScopes(
  scopes: PermissionGrant[],
  workspaceId: string | null,
): AuthContext['membershipTier'] {
  if (workspaceId === null) return 'global-admin';

  // Check for owner-level capabilities
  if (scopes.some((s) => s.resource === 'kb' && s.verb === 'manage')) return 'owner';
  // steward: can upload / manage membership
  if (scopes.some((s) => s.resource === 'kb' && s.verb === 'edit')) return 'steward';
  // contributor: can edit pages
  if (scopes.some((s) => s.resource === 'page' && s.verb === 'edit')) return 'contributor';
  // default
  return 'observer';
}
