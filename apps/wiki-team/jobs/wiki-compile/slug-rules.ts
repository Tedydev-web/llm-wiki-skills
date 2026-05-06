/**
 * slug-rules.ts — kebab-case slug validation for wiki note pages
 *
 * Rules per ADR 010 / phase-06:
 *   - lowercase alphanumeric + hyphens only
 *   - max 40 characters (user-authored slugs; sentinel slugs are exempt)
 *   - reserved sentinels: __catalog, __history (double-underscore prefix)
 *   - sentinels are ALWAYS valid; never rejected as malformed
 *
 * Pure module: no I/O, no imports beyond types.
 */

// ---------------------------------------------------------------------------
// Reserved sentinel slugs (internal system pages)

export const SENTINEL_CATALOG = '__catalog' as const;
export const SENTINEL_HISTORY = '__history' as const;

export type SentinelSlug = typeof SENTINEL_CATALOG | typeof SENTINEL_HISTORY;

const SENTINELS: ReadonlySet<string> = new Set([SENTINEL_CATALOG, SENTINEL_HISTORY]);

// ---------------------------------------------------------------------------
// Validation constants

const SLUG_MAX_LEN = 40;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// SlugValidationResult

export type SlugValidationResult =
  | { ok: true; sentinel: boolean }
  | { ok: false; reason: string };

// ---------------------------------------------------------------------------
// validateSlug — check a single slug string

/**
 * Validate a note page slug.
 *
 * Sentinels (__catalog, __history) bypass normal rules and always pass.
 * User-authored slugs must be kebab-case and ≤ 40 chars.
 *
 * @param slug  The slug string to validate.
 * @returns     SlugValidationResult — ok=true with sentinel flag, or ok=false with reason.
 */
export function validateSlug(slug: string): SlugValidationResult {
  if (typeof slug !== 'string' || slug.length === 0) {
    return { ok: false, reason: 'Slug must be a non-empty string' };
  }

  // Sentinel short-circuit — always valid, never subject to length/pattern rules
  if (SENTINELS.has(slug)) {
    return { ok: true, sentinel: true };
  }

  if (slug.length > SLUG_MAX_LEN) {
    return {
      ok: false,
      reason: `Slug exceeds max length of ${SLUG_MAX_LEN} chars (got ${slug.length})`,
    };
  }

  if (!SLUG_PATTERN.test(slug)) {
    return {
      ok: false,
      reason: 'Slug must be lowercase kebab-case (a-z, 0-9, hyphens; no leading/trailing/double hyphens)',
    };
  }

  return { ok: true, sentinel: false };
}

// ---------------------------------------------------------------------------
// assertSlug — throws on invalid slug (use in agent tool handlers)

/**
 * Assert slug is valid, throwing a descriptive error on failure.
 * Intended for use inside tool handlers where invalid slugs should surface
 * as tool errors back to the agent loop.
 */
export function assertSlug(slug: string): void {
  const result = validateSlug(slug);
  if (!result.ok) {
    throw new Error(`Invalid slug "${slug}": ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// isSentinel — narrow type guard

export function isSentinel(slug: string): slug is SentinelSlug {
  return SENTINELS.has(slug);
}

// ---------------------------------------------------------------------------
// toSlug — best-effort conversion from arbitrary string to valid slug

/**
 * Convert a freeform title/name to a valid kebab-case slug.
 * Truncates to SLUG_MAX_LEN. Does NOT guarantee uniqueness — caller must check.
 *
 * @param title  Human-readable title string.
 * @returns      Best-effort slug, or throws if conversion yields empty string.
 */
export function toSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')        // strip non-alphanumeric except spaces+hyphens
    .trim()
    .replace(/[\s-]+/g, '-')             // collapse spaces/hyphens to single hyphen
    .replace(/^-+|-+$/g, '')             // strip leading/trailing hyphens
    .slice(0, SLUG_MAX_LEN)
    .replace(/-+$/, '');                  // strip trailing hyphen after truncation

  if (slug.length === 0) {
    throw new Error(`Cannot derive slug from title: "${title}" (all characters stripped)`);
  }

  return slug;
}
