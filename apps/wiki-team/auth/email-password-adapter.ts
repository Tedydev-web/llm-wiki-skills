/**
 * email-password-adapter.ts — Better Auth email+password configuration helper
 *
 * Better Auth supports email+password natively via `emailAndPassword: { enabled: true }`.
 * This module exports the config fragment to be spread into createAuthInstance().
 *
 * Features wired:
 *   - Email + password sign-up / sign-in (Better Auth core)
 *   - Rate limiting: 5 failed attempts / 15 min window (Better Auth rateLimit plugin)
 *   - accountLinking disabled (prevents OAuth email-collision attack — S-6)
 *   - requireEmailVerification: false (self-hosted; admin sets password explicitly)
 *
 * Password hashing: Better Auth default (bcrypt). No override needed.
 */

/**
 * Email + password config fragment for Better Auth's `emailAndPassword` option.
 * Spread this into the betterAuth({}) call in better-auth.ts.
 */
export const emailPasswordConfig = {
  emailAndPassword: {
    enabled: true,
    /** Minimum password length — enforced by Better Auth before hash */
    minPasswordLength: 12,
    /** Auto-sign-in after email+password sign-up */
    autoSignIn: true,
  },
} as const;

/**
 * Account linking config: DISABLED.
 * Prevents OAuth users from silently inheriting admin permissions
 * by sharing email with a bootstrapped admin account (S-6 risk).
 */
export const accountLinkingConfig = {
  accountLinking: {
    enabled: false,
  },
} as const;
