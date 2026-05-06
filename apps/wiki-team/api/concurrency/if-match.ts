/**
 * if-match.ts — RFC 7232 If-Match header parser + 409/428 helpers
 *
 * Optimistic concurrency contract (ADR 011):
 *   Client sends:  If-Match: "3"          (quoted version integer)
 *   Server parses: expectedVersion = 3
 *   UPDATE ... WHERE version = 3 RETURNING version
 *   0 rows → 409 Conflict  (version mismatch)
 *   1 row  → 200 OK + ETag: "4"
 *
 * Never read-then-check. Only the atomic UPDATE result matters.
 */

import type { Context } from 'hono';
import { errorResponse } from '../middleware/error-handler.js';
import type { AuthContextEnv } from '../middleware/auth.js';

/**
 * Parse the If-Match header and return the expected version integer.
 *
 * @returns parsed version number
 * @throws Response(428) if header is absent or malformed
 *
 * RFC 7232 ETag format: "N" (quoted-string). We accept both quoted and bare integers.
 */
export function parseIfMatch(c: Context<AuthContextEnv>): number {
  const raw = c.req.header('if-match');

  if (!raw) {
    // 428 Precondition Required — If-Match is mandatory for PATCH on notes
    throw errorResponse(
      c,
      428,
      'precondition_required',
      'If-Match header is required for this operation. ' +
        'Read the resource first and supply its ETag as If-Match: "<version>".',
    );
  }

  // Strip surrounding quotes: "3" → "3", 3 → 3
  const stripped = raw.replace(/^"|"$/g, '').trim();
  const parsed = parseInt(stripped, 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    throw errorResponse(
      c,
      428,
      'precondition_required',
      `Malformed If-Match value: "${raw}". Expected a positive integer in quotes, e.g. If-Match: "3".`,
    );
  }

  return parsed;
}

/**
 * Build a 409 Conflict response for an optimistic concurrency version mismatch.
 *
 * @param c             Hono context
 * @param currentVersion  The actual current version from DB (from a SELECT after the failed UPDATE)
 */
export function versionMismatchResponse(
  c: Context<AuthContextEnv>,
  currentVersion: number,
): Response {
  return errorResponse(
    c,
    409,
    'version_mismatch',
    'The resource was modified by another request. Fetch the current version and retry.',
    {
      currentVersion,
      etag: `"${currentVersion}"`,
      message: 'version_mismatch',
    },
  );
}

/**
 * Build the ETag header value for a given version number.
 * RFC 7232 format: quoted-string.
 */
export function buildETag(version: number): string {
  return `"${version}"`;
}
