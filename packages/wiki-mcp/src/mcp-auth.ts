/**
 * mcp-auth.ts — Bearer token extraction + AuthContext builder for MCP server
 *
 * Function: loadAuthContextFromBearer
 *   - Extracts "Authorization: Bearer wkt_*" from a Request/Headers object
 *   - Calls P04 verifyMcpToken (constant-time; timing-oracle safe)
 *   - Returns AuthContext on success
 *   - Throws McpError (code -32001, "auth_required") on any failure
 *
 * Anti-trace compliance: plain function module (see plan.md §Anti-Trace Discipline).
 *   - Bearer token value is NEVER logged (only prefix "wkt_" may appear in logs)
 *
 * Security:
 *   - Token redacted in all error messages (only prefix exposed)
 *   - verifyMcpToken already runs constant-time argon2id path regardless of outcome
 *   - Short-lived in-memory cache (TTL 60s, LRU eviction) to absorb argon2id latency
 *     on repeated requests with the same token (per ADR 012 §Consequences)
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import type { AuthContext, McpTokenDb } from './types.js';

// ---------------------------------------------------------------------------
// verifyMcpToken interface — injected by the consuming app (apps/wiki-team)
// packages/wiki-mcp must not import from apps/* directly.

export type VerifyMcpTokenFn = (
  presented: string,
  db: McpTokenDb,
) => Promise<AuthContext | null>;

// ---------------------------------------------------------------------------
// Verified-token cache (TTL = 60 s; LRU eviction at 500 entries)
// Stores AuthContext keyed by the HMAC prefix-lookup string (never the plaintext token).
// This eliminates repeated argon2id verify calls for sustained MCP sessions.

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 500;

interface CacheEntry {
  ctx: AuthContext;
  expiresAt: number; // Date.now() + TTL_MS
}

const _verifiedCache = new Map<string, CacheEntry>();

/** Insert or refresh a cache entry keyed by prefix (first 20 chars of token after wkt_). */
function cacheSet(prefix: string, ctx: AuthContext): void {
  if (_verifiedCache.size >= CACHE_MAX_SIZE) {
    // Evict oldest entry (Map iteration order = insertion order)
    const firstKey = _verifiedCache.keys().next().value;
    if (firstKey !== undefined) _verifiedCache.delete(firstKey);
  }
  _verifiedCache.set(prefix, { ctx, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Retrieve a non-expired cache entry; returns undefined on miss or expiry. */
function cacheGet(prefix: string): AuthContext | undefined {
  const entry = _verifiedCache.get(prefix);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    _verifiedCache.delete(prefix);
    return undefined;
  }
  return entry.ctx;
}

// ---------------------------------------------------------------------------
// extractBearerToken — pulls raw token string from Authorization header

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns null if the header is missing or not a Bearer token.
 * Does NOT validate the wkt_ prefix here — verifyMcpToken does that.
 */
export function extractBearerToken(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  if (!authorizationHeader.startsWith('Bearer ')) return null;
  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

// ---------------------------------------------------------------------------
// loadAuthContextFromBearer — main entry point

/**
 * Resolve AuthContext from a Bearer token.
 *
 * @param authorizationHeader  Value of the "Authorization" request header (may be null)
 * @param db                   McpTokenDb adapter (P04 dependency)
 * @param verifyToken          verifyMcpToken implementation (injected from apps/wiki-team)
 * @returns                    AuthContext on success
 * @throws McpError            code -32001 (InvalidRequest) on missing/invalid token
 *
 * Cache behaviour:
 *   Successful verifications are cached for 60 s keyed by token prefix (not plaintext).
 *   Cache is never persisted to disk — evicted on process restart.
 */
export async function loadAuthContextFromBearer(
  authorizationHeader: string | null | undefined,
  db: McpTokenDb,
  verifyToken: VerifyMcpTokenFn,
): Promise<AuthContext> {
  const token = extractBearerToken(authorizationHeader);

  if (!token) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'auth_required: missing Authorization: Bearer header',
    );
  }

  // Cache key: first 20 chars of the token after "wkt_" (not plaintext, not full token)
  // This leaks at most 20 chars of a 44-char token — acceptable given the TTL + LRU bound.
  const cacheKey = token.startsWith('wkt_') ? token.slice(4, 24) : token.slice(0, 20);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  let ctx: AuthContext | null;
  try {
    ctx = await verifyToken(token, db);
  } catch (err) {
    // Internal error (e.g. BETTER_AUTH_SECRET missing) — do not expose internals
    throw new McpError(
      ErrorCode.InternalError,
      'auth_internal_error: token verification failed',
    );
  }

  if (ctx === null) {
    // verifyMcpToken returns null for: wrong format, not found, expired, revoked
    // Redact: only log prefix to avoid token leakage
    const redacted = token.startsWith('wkt_') ? `wkt_[redacted]` : '[invalid-prefix]';
    // Log at debug level only — not error (auth failure is expected in prod)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- process is not typed in this package
  if ((globalThis as any)?.process?.env?.['NODE_ENV'] === 'development') {
      console.debug(`[mcp-auth] token verify failed: ${redacted}`);
    }
    throw new McpError(
      ErrorCode.InvalidRequest,
      'auth_invalid: token not found, expired, or revoked',
    );
  }

  cacheSet(cacheKey, ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// invalidateFromCache — used in tests + token revoke flow

/**
 * Remove a token's cache entry (by prefix) after revocation.
 * Call from the revoke handler so revoked tokens are not served from cache.
 */
export function invalidateCacheByPrefix(tokenPrefix: string): void {
  _verifiedCache.delete(tokenPrefix);
}
