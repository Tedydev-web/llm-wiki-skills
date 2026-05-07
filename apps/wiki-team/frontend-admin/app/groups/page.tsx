/**
 * groups/page.tsx — Admin: Groups list + create (P08).
 *
 * Route: /groups?wid=<workspaceId>
 * Shows all groups with member count placeholder and assigned note kinds.
 * Admin can create new groups; click row to open scope assignment panel.
 *
 * Anti-trace: generic "group" naming (not department/dept).
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type Group, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { GroupForm } from './components/group-form';
import { ScopeAssignmentForm } from './components/scope-assignment-form';

// ---------------------------------------------------------------------------
// Page

export default function GroupsPage() {
  const params = useSearchParams();
  const workspaceId = params.get('wid') ?? '';

  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadGroups = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    api.groups
      .list(workspaceId)
      .then(setGroups)
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load groups', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => { loadGroups(); }, [loadGroups]);

  function handleCreated(group: Group) {
    setGroups((prev) => [...prev, group].sort((a, b) => a.slug.localeCompare(b.slug)));
    setShowCreate(false);
    toast({ title: `Group '${group.slug}' created` });
  }

  async function handleDelete(slug: string) {
    setDeleting(slug);
    try {
      await api.groups.delete(workspaceId, slug);
      setGroups((prev) => prev.filter((g) => g.slug !== slug));
      if (selectedSlug === slug) setSelectedSlug(null);
      toast({ title: `Group '${slug}' deleted` });
    } catch (err) {
      const msg = err instanceof WikiTeamApiError ? err.message : 'Delete failed';
      toast({ title: 'Delete failed', description: msg, variant: 'destructive' });
    } finally {
      setDeleting(null);
    }
  }

  if (!workspaceId) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-muted-foreground text-sm">
          No workspace selected. Append <code>?wid=&lt;workspaceId&gt;</code> to the URL.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Groups</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Org-level groups for scoped knowledge access.
          </p>
        </div>
        {!showCreate && (
          <Button onClick={() => { setShowCreate(true); setSelectedSlug(null); }}>
            Add group
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border p-4 bg-muted/30">
          <h2 className="text-sm font-semibold mb-4">Create Group</h2>
          <GroupForm
            workspaceId={workspaceId}
            onSaved={handleCreated}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {/* Groups table */}
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-muted-foreground text-sm">No groups found.</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Slug</th>
                <th className="px-4 py-2 text-left font-medium">Display Name</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map((group) => (
                <React.Fragment key={group.slug}>
                  <tr
                    className={`hover:bg-muted/20 transition-colors cursor-pointer ${selectedSlug === group.slug ? 'bg-muted/40' : ''}`}
                    onClick={() => setSelectedSlug((s) => s === group.slug ? null : group.slug)}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs">{group.slug}</td>
                    <td className="px-4 py-2.5 font-medium">{group.displayName}</td>
                    <td className="px-4 py-2.5 text-right space-x-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); void handleDelete(group.slug); }}
                        disabled={deleting === group.slug}
                      >
                        {deleting === group.slug ? 'Deleting…' : 'Delete'}
                      </Button>
                    </td>
                  </tr>
                  {selectedSlug === group.slug && (
                    <tr>
                      <td colSpan={3} className="px-4 py-4 bg-muted/20">
                        <ScopeAssignmentForm workspaceId={workspaceId} groupSlug={group.slug} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
