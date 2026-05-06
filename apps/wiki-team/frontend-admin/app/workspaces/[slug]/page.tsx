/**
 * workspaces/[slug]/page.tsx — workspace overview (redirect to members tab by default).
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type Workspace, WikiTeamApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export default function WorkspaceOverviewPage() {
  const { slug } = useParams<{ slug: string }>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.workspaces
      .get(slug)
      .then(({ workspace: ws }) => setWorkspace(ws))
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load workspace', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!workspace) return <p className="text-muted-foreground text-sm">Workspace not found.</p>;

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{workspace.displayName}</h2>
        <Badge variant="outline">{workspace.slug}</Badge>
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-2 text-sm">
        <dt className="text-muted-foreground">Owner ID</dt>
        <dd className="font-mono text-xs break-all">{workspace.ownerId}</dd>
        <dt className="text-muted-foreground">Created</dt>
        <dd>{formatDate(workspace.createdAt)}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          {workspace.deletedAt ? (
            <Badge variant="destructive">Deleted</Badge>
          ) : (
            <Badge variant="success">Active</Badge>
          )}
        </dd>
      </dl>
    </section>
  );
}
