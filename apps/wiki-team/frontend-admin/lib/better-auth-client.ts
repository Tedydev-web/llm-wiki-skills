/**
 * better-auth-client.ts — Better Auth React client wrapper.
 *
 * Exports createAuthClient-based hooks for session management and OAuth sign-in.
 * Session is managed via httpOnly cookie set by Better Auth server.
 */

import { createAuthClient } from 'better-auth/react';

const BASE_URL =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL']) ||
  'http://localhost:3333';

// Better Auth's `createAuthClient` return type embeds deep package paths that
// aren't portable across the monorepo's strict declaration-emit; suppressing
// the explicit annotation requirement with `any` here is acceptable because
// the public surface (`useSession`, `signIn`, `signOut`) is consumed by RSC
// pages that don't re-export the inferred type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authClient: any = createAuthClient({
  baseURL: BASE_URL,
});

export const { useSession, signIn, signOut } = authClient;

/** Sign in via OAuth provider. Redirects to provider consent screen. */
export async function signInWithProvider(
  provider: 'google' | 'github',
): Promise<void> {
  const callbackURL =
    typeof window !== 'undefined'
      ? `${window.location.origin}/auth/callback`
      : '/auth/callback';

  await signIn.social({ provider, callbackURL });
}
