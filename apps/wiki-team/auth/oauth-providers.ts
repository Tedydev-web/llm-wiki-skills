/**
 * oauth-providers.ts — Google + GitHub OAuth provider config for Better Auth
 *
 * Providers are env-driven. Boot-time assertAuthEnv() fast-fails on missing vars
 * to prevent silent auth failures in production (ADR 012 risk mitigation).
 *
 * Required env vars (document in auth/README.md — coordinator merges to .env.example):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 *
 * Better Auth handles PKCE + state validation by default for both providers.
 * Integration test in auth-oauth-roundtrip.test.ts asserts forged callback → 400.
 */

// ---------------------------------------------------------------------------
// Env validation

/** Names of required OAuth env vars */
const REQUIRED_OAUTH_ENV_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
] as const;

/**
 * Assert all OAuth env vars are present.
 * Call at server boot — never silently continue with missing credentials.
 *
 * @throws Error listing every missing variable (not just the first)
 */
export function assertOAuthEnv(): void {
  const missing = REQUIRED_OAUTH_ENV_VARS.filter(
    (key) => !process.env[key]?.trim(),
  );
  if (missing.length > 0) {
    throw new Error(
      `[auth] Missing required OAuth env vars: ${missing.join(', ')}. ` +
        'See apps/wiki-team/auth/README.md for setup instructions.',
    );
  }
}

// ---------------------------------------------------------------------------
// Provider config builders
// Better Auth's socialProviders accept { clientId, clientSecret }.
// We export plain objects; better-auth.ts composes them into the auth instance.

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Build Google provider config from environment.
 * PKCE is enabled by default in Better Auth for Google.
 */
export function buildGoogleProviderConfig(): OAuthProviderConfig {
  const clientId = process.env['GOOGLE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('[auth] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set');
  }
  return { clientId, clientSecret };
}

/**
 * Build GitHub provider config from environment.
 * PKCE is enabled by default in Better Auth for GitHub.
 */
export function buildGithubProviderConfig(): OAuthProviderConfig {
  const clientId = process.env['GITHUB_CLIENT_ID'];
  const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('[auth] GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET not set');
  }
  return { clientId, clientSecret };
}
