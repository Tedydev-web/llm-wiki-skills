/**
 * boot-security-check.ts — assertProductionSecurityPosture()
 *
 * Validates security-critical env vars before server start.
 * Named "common-defaults bundle" (deliberately distinct from upstream — anti-trace).
 *
 * WIKI_ENV env (dev | staging | prod) used for posture check — more precise
 * than NODE_ENV which staging environments also set to "production".
 */

import { logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Weak-password detection — "common-defaults bundle"

const COMMON_DEFAULTS_BUNDLE = [
  'change-this-password',
  'changethispassword',
  'change_me',
  'changeme',
  'admin',
  'password',
  '123456',
  'letmein',
  'qwerty',
  'welcome',
  'default',
  'bootstrap',
  'changeme123',
  'change_me_before_boot',
];

/**
 * Compute Shannon entropy (bits per character) of a string.
 * Entropy < 2.5 bits/char → treated as weak.
 */
function shannonEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1;
  const len = s.length;
  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Returns true if the password is considered weak:
 *   - Length < 12
 *   - Shannon entropy < 2.5 bits/char
 *   - Contains a common-defaults bundle token (case-insensitive substring)
 */
export function isWeakPassword(password: string): boolean {
  if (password.length < 12) return true;
  if (shannonEntropy(password) < 2.5) return true;
  const lower = password.toLowerCase();
  for (const token of COMMON_DEFAULTS_BUNDLE) {
    if (lower.includes(token)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Production security posture assertion

/**
 * WIKI_ENV detection. Falls back to NODE_ENV if WIKI_ENV not set.
 */
function isProductionEnv(): boolean {
  const wikiEnv = process.env['WIKI_ENV'];
  if (wikiEnv) return wikiEnv === 'prod' || wikiEnv === 'production';
  return process.env['NODE_ENV'] === 'production';
}

/**
 * Assert security posture at boot time.
 *
 * Throws if:
 *   - DEFAULT_ADMIN_PASSWORD is weak in production
 *   - BETTER_AUTH_SECRET still has placeholder value
 *
 * Warns (does not throw) if:
 *   - DEFAULT_ADMIN_EMAIL is set in production (first-boot only — expected; documented)
 *
 * Must be called BEFORE runAdminBootstrap().
 */
export function assertProductionSecurityPosture(): void {
  const betterAuthSecret = process.env['BETTER_AUTH_SECRET'];

  // BETTER_AUTH_SECRET placeholder check (all environments)
  if (betterAuthSecret?.includes('CHANGE_ME_BEFORE_BOOT')) {
    throw new Error(
      '[security] BETTER_AUTH_SECRET still has placeholder value "CHANGE_ME_BEFORE_BOOT". ' +
      'Generate a real secret: openssl rand -hex 32',
    );
  }

  const defaultAdminEmail = process.env['DEFAULT_ADMIN_EMAIL'];
  const defaultAdminPassword = process.env['DEFAULT_ADMIN_PASSWORD'];
  const isProd = isProductionEnv();

  // DEFAULT_ADMIN_PASSWORD literal placeholder check (all environments)
  if (defaultAdminPassword?.includes('CHANGE_ME_BEFORE_BOOT')) {
    throw new Error(
      '[security] DEFAULT_ADMIN_PASSWORD still has placeholder "CHANGE_ME_BEFORE_BOOT". ' +
      'Set a strong password (≥12 chars, entropy ≥2.5 bits/char).',
    );
  }

  // Production: enforce strong password
  if (isProd && defaultAdminPassword && isWeakPassword(defaultAdminPassword)) {
    throw new Error(
      '[security] DEFAULT_ADMIN_PASSWORD is too weak for production. ' +
      'Use ≥12 characters with entropy ≥2.5 bits/char and no common defaults.',
    );
  }

  // Production warning: DEFAULT_ADMIN_EMAIL set in prod (expected first-boot; log only)
  if (isProd && defaultAdminEmail) {
    logger.warn(
      '[security] DEFAULT_ADMIN_EMAIL is set in production. ' +
      'This is expected for initial admin setup only. ' +
      'Remove from environment after first boot. ' +
      'Use Docker secrets / K8s secrets for production deployments.',
    );
  }
}
