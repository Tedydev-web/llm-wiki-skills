/**
 * auth/callback/page.tsx — OAuth callback handler.
 * Better Auth processes the code server-side; this page just shows a loading
 * state while the session cookie is being set, then redirects to dashboard.
 */

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/better-auth-client';

export default function AuthCallbackPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!isPending) {
      // Session resolved — go to dashboard regardless of success/fail.
      // If auth failed, dashboard will redirect to /signin.
      router.replace('/');
    }
  }, [session, isPending, router]);

  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground text-sm">Completing sign-in…</p>
    </main>
  );
}
