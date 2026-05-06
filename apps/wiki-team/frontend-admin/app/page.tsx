/**
 * page.tsx — root route: dashboard listing workspaces the current user belongs to.
 * Client component — uses Better Auth session + api client.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from '@/lib/better-auth-client';
import { api, type Workspace, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { WorkspaceCreateDialog } from '@/components/workspace/workspace-create-dialog';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    if (!isPending && !session) {
      router.replace('/signin');
    }
  }, [session, isPending, router]);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    api.workspaces
      .list()
      .then(setWorkspaces)
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load workspaces', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [session]);

  if (isPending || !session) return null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Workspaces</h1>
        <Button onClick={() => setShowCreate(true)}>Create workspace</Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : workspaces.length === 0 ? (
        <p className="text-muted-foreground">No workspaces yet. Create one to get started.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <Link
                href={`/workspaces/${ws.slug}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-muted transition-colors"
              >
                <div>
                  <p className="font-medium">{ws.displayName}</p>
                  <p className="text-xs text-muted-foreground">{ws.slug}</p>
                </div>
                <p className="text-xs text-muted-foreground">{formatDate(ws.createdAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <WorkspaceCreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(ws) => {
          setWorkspaces((prev) => [...prev, ws]);
          setShowCreate(false);
          router.push(`/workspaces/${ws.slug}`);
        }}
      />
    </main>
  );
}
