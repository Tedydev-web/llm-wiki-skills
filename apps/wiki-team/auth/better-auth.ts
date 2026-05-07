/**
 * better-auth.ts — Better Auth instance configuration
 *
 * Wires Better Auth v1.x to:
 *   - Drizzle adapter pointing at users table (P03 schema export)
 *   - Google + GitHub OAuth providers (PKCE enabled by default)
 *   - Session cookies: httpOnly, secure (prod), sameSite=lax
 *
 * Better Auth Bun compatibility: confirmed via spike (see Phase 04 report).
 * Better Auth handles PKCE + state for OAuth code flows automatically.
 *
 * BETTER_AUTH_SECRET env var is required at boot (also used as HMAC key for
 * MCP token prefix_lookup — see token-id.ts).
 *
 * NOTE: Drizzle DB instance is injected at runtime (not imported here) to avoid
 * circular dependency with P03 storage layer. Call createAuthInstance(db) from
 * the server entry point after DB is initialised.
 */

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { buildGithubProviderConfig, buildGoogleProviderConfig } from './oauth-providers.js';
import { emailPasswordConfig, accountLinkingConfig } from './email-password-adapter.js';

// ---------------------------------------------------------------------------
// Required env vars

const REQUIRED_AUTH_ENV_VARS = ['BETTER_AUTH_SECRET'] as const;

/**
 * Assert BETTER_AUTH_SECRET is present.
 * Call at server boot before createAuthInstance().
 *
 * @throws Error if secret is missing or too short (<32 chars)
 */
export function assertAuthEnv(): void {
  const missing = REQUIRED_AUTH_ENV_VARS.filter(
    (key) => !process.env[key]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `[auth] Missing required auth env vars: ${missing.join(', ')}. ` +
        'See apps/wiki-team/auth/README.md.',
    );
  }
  const secret = process.env['BETTER_AUTH_SECRET']!;
  if (secret.length < 32) {
    throw new Error(
      '[auth] BETTER_AUTH_SECRET must be at least 32 characters (use: openssl rand -hex 32)',
    );
  }
}

// ---------------------------------------------------------------------------
// Auth instance factory

/**
 * Drizzle DB interface — accept any Drizzle instance to avoid hard-coupling to P03.
 * P03 exports the concrete type; server entry point passes it here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any — intentional: DB type varies by adapter version
type DrizzleDb = any;

/**
 * Create and return the Better Auth instance.
 * Must be called ONCE at server startup after env validation and DB init.
 *
 * @param db  Drizzle ORM database instance (from P03 storage layer)
 */
export function createAuthInstance(db: DrizzleDb) {
  const secret = process.env['BETTER_AUTH_SECRET'];
  if (!secret) {
    throw new Error('[auth] BETTER_AUTH_SECRET is not set — call assertAuthEnv() before createAuthInstance()');
  }

  return betterAuth({
    secret,

    // Drizzle adapter — points at users table defined by P03
    database: drizzleAdapter(db, {
      provider: 'pg',
    }),

    // Session cookie settings (ADR 012 + phase-04 security requirements)
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5-min cache; force re-verify after
      },
    },

    // Email + password auth (P06: admin bootstrap onboarding path)
    // minPasswordLength: 12, autoSignIn: true — see email-password-adapter.ts
    ...emailPasswordConfig,

    // Social OAuth providers (Google + GitHub)
    // PKCE is enabled by default in Better Auth for both providers
    socialProviders: {
      google: buildGoogleProviderConfig(),
      github: buildGithubProviderConfig(),
    },

    // Account linking DISABLED — prevents OAuth email-collision attack (S-6)
    // A Google OAuth user sharing email with bootstrap admin must NOT inherit admin perms.
    ...accountLinkingConfig,

    // Step-up reauth: require fresh session (≤15 min) for sensitive operations
    // Better Auth exposes session.createdAt; mcp-token-service.ts checks freshness.
    // See: issueMcpToken() in mcp-token-service.ts for enforcement logic.
    advanced: {
      cookiePrefix: 'wiki-team',
      // httpOnly, sameSite=lax set by Better Auth defaults
      // secure flag is automatically true when NODE_ENV=production
      generateId: () => crypto.randomUUID(),
    },
  });
}

/** TypeScript type of the Better Auth instance (inferred from factory) */
export type AuthInstance = ReturnType<typeof createAuthInstance>;
