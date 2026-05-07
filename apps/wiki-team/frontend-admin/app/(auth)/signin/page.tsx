/**
 * signin/page.tsx — Sign-in page: OAuth buttons + email/password form.
 *
 * Shows Google + GitHub OAuth buttons, then a divider, then email+password
 * form (P06: admin bootstrap onboarding path via DEFAULT_ADMIN_EMAIL).
 * Handles ?reason=fresh-required for step-up reauth.
 */

'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { signInWithProvider } from '@/lib/better-auth-client';
import { PasswordForm } from './components/password-form';

export default function SignInPage() {
  const params = useSearchParams();
  const reason = params.get('reason');

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use your organisation account to continue.
          </p>
        </div>

        {reason === 'fresh-required' && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            Fresh authentication is required to issue tokens. Please sign in again.
          </div>
        )}

        {/* OAuth providers */}
        <div className="flex flex-col gap-3">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signInWithProvider('google')}
          >
            Continue with Google
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signInWithProvider('github')}
          >
            Continue with GitHub
          </Button>
        </div>

        {/* Divider */}
        <div className="relative flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">Or sign in with email</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Email + password form (P06: admin bootstrap onboarding path) */}
        <PasswordForm callbackURL="/" />
      </div>
    </main>
  );
}
