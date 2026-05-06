/**
 * account/page.tsx — user profile and sign-out.
 */

'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/better-auth-client';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export default function AccountPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();

  useEffect(() => {
    if (!isPending && !session) router.replace('/signin');
  }, [session, isPending, router]);

  if (isPending || !session) return null;

  const user = session.user;

  async function handleSignOut() {
    await signOut();
    router.replace('/signin');
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8 space-y-6">
      <h1 className="text-2xl font-semibold">Account</h1>
      <Separator />
      <dl className="grid grid-cols-[120px_1fr] gap-y-3 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{user.name ?? '—'}</dd>
        <dt className="text-muted-foreground">Email</dt>
        <dd>{user.email}</dd>
        <dt className="text-muted-foreground">User ID</dt>
        <dd className="font-mono text-xs break-all">{user.id}</dd>
      </dl>
      <Separator />
      <Button variant="destructive" onClick={handleSignOut}>
        Sign out
      </Button>
    </main>
  );
}
