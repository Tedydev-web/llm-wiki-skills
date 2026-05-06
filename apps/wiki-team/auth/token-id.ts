/**
 * token-id.ts — MCP token generation + prefix-lookup computation
 *
 * Token format per ADR 012 + Phase 04 (W0 hardening):
 *   plaintext: "wkt_<32 base62 chars>"   (32 chars = ~190 bits entropy)
 *
 * prefix_lookup stored in DB:
 *   HMAC-SHA256(plaintext, BETTER_AUTH_SECRET) truncated to 16 hex chars
 *   — NEVER first-N chars of plaintext (that leaks entropy bits).
 *
 * base62 alphabet: [0-9A-Za-z] (62 chars → no URL-special chars, no padding)
 */

import { createHmac, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Constants

/** Fixed 4-char class prefix (all wiki-team MCP tokens share this) */
export const MCP_TOKEN_CLASS_PREFIX = 'wkt_' as const;

/** Length of the random suffix in base62 chars (32 chars ≈ 190 bits entropy) */
const RANDOM_SUFFIX_LENGTH = 32;

/** Base62 alphabet (digits + uppercase + lowercase) */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Hex chars in prefix_lookup stored in DB */
const PREFIX_LOOKUP_HEX_LENGTH = 16;

// ---------------------------------------------------------------------------
// Token generation

/**
 * Generate a new MCP token ID.
 * Returns the plaintext token — caller MUST return it to the user ONCE and
 * NEVER log or store it; only the hash + prefix_lookup go into the database.
 */
export function generateMcpTokenId(): { plaintext: string } {
  const bytes = randomBytes(32); // 256 bits raw randomness
  let suffix = '';
  for (let i = 0; i < RANDOM_SUFFIX_LENGTH; i++) {
    // Each byte mapped to base62 via modulo; minor bias is acceptable for tokens
    // (not key material) — 256 chars → 62 buckets: max 1.3 % bias, negligible.
    suffix += BASE62[bytes[i]! % 62];
  }
  const plaintext = `${MCP_TOKEN_CLASS_PREFIX}${suffix}`;
  return { plaintext };
}

// ---------------------------------------------------------------------------
// Prefix-lookup computation

/**
 * Compute the 16-hex-char prefix_lookup value for DB storage + querying.
 *
 * HMAC-SHA256(plaintext, secret) → take first 16 hex chars of the hex digest.
 * This is a keyed one-way function: DB compromise without the secret reveals
 * nothing about the plaintext token.
 *
 * @param plaintext  Full token string (e.g. "wkt_ABCD…")
 * @param secret     BETTER_AUTH_SECRET env var — never store this
 */
export function computePrefixLookup(plaintext: string, secret: string): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(plaintext);
  const hexDigest = hmac.digest('hex'); // 64 hex chars
  return hexDigest.slice(0, PREFIX_LOOKUP_HEX_LENGTH);
}

// ---------------------------------------------------------------------------
// Sanity assertions (non-test env; surfaces regressions at import time)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _env: string | undefined = (globalThis as any)?.process?.env?.['NODE_ENV'];
if (_env !== 'test') {
  const { plaintext } = generateMcpTokenId();
  console.assert(plaintext.startsWith('wkt_'), 'token must start with wkt_');
  console.assert(plaintext.length === 36, `token length must be 36, got ${plaintext.length}`);

  const lookup = computePrefixLookup(plaintext, 'test-secret');
  console.assert(lookup.length === 16, `prefix_lookup must be 16 hex chars, got ${lookup.length}`);
  console.assert(/^[0-9a-f]+$/.test(lookup), 'prefix_lookup must be lowercase hex');
}
