/**
 * note-kinds/page.tsx — Admin Settings: Knowledge Types (NoteKind) CRUD (ADR 014 / P02).
 *
 * Table shows all NoteKinds with color swatch, label, slug, system-default badge.
 * Admin can: create custom kinds, edit color/description, delete custom kinds.
 * System-default kinds (fact/analysis/procedure/reference) show a lock icon;
 * their color/description are editable but slug+label are immutable.
 *
 * Route: /note-kinds (standalone admin settings page, workspace-picker via query param)
  * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, type NoteKind, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { KindForm } from './components/kind-form';

// ---------------------------------------------------------------------------
// Helpers

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-4 w-4 rounded-full border border-border"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Page

export default function NoteKindsPage() {
  const params = useSearchParams();
  const workspaceId = params.get('wid') ?? '';

  const [kinds, setKinds] = useState<NoteKind[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<NoteKind | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadKinds = useCallback(() => {
    if (!workspaceId) return;
    setLoading(true);
    api.noteKinds
      .list(workspaceId)
      .then(setKinds)
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load note kinds', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [workspaceId]);

  useEffect(() => { loadKinds(); }, [loadKinds]);

  function handleSaved(kind: NoteKind) {
    setKinds((prev) => {
      const idx = prev.findIndex((k) => k.slug === kind.slug);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = kind;
        return next;
      }
      return [...prev, kind].sort((a, b) => a.slug.localeCompare(b.slug));
    });
    setShowCreate(false);
    setEditing(null);
  }

  async function handleDelete(slug: string) {
    setDeleting(slug);
    try {
      await api.noteKinds.delete(workspaceId, slug);
      setKinds((prev) => prev.filter((k) => k.slug !== slug));
      toast({ title: `NoteKind '${slug}' deleted` });
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

  const isFormOpen = showCreate || editing !== null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Note Kinds</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Taxonomy types for notes. System defaults are protected.
          </p>
        </div>
        {!isFormOpen && (
          <Button onClick={() => setShowCreate(true)}>Add kind</Button>
        )}
      </div>

      {/* Create / Edit form panel */}
      {isFormOpen && (
        <div className="rounded-lg border p-4 bg-muted/30">
          <h2 className="text-sm font-semibold mb-4">
            {editing ? `Edit: ${editing.label}` : 'Create NoteKind'}
          </h2>
          <KindForm
            workspaceId={workspaceId}
            editing={editing}
            onSaved={handleSaved}
            onCancel={() => { setShowCreate(false); setEditing(null); }}
          />
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : kinds.length === 0 ? (
        <p className="text-muted-foreground text-sm">No note kinds found.</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Color</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Slug</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground">Description</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {kinds.map((kind) => (
                <tr key={kind.slug} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <ColorSwatch color={kind.color} />
                  </td>
                  <td className="px-4 py-2.5 font-medium">
                    {kind.label}
                    {kind.isSystemDefault && (
                      <span className="ml-2 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        system
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{kind.slug}</td>
                  <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate">
                    {kind.description ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right space-x-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setEditing(kind); setShowCreate(false); }}
                      disabled={isFormOpen}
                    >
                      Edit
                    </Button>
                    {!kind.isSystemDefault && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleDelete(kind.slug)}
                        disabled={deleting === kind.slug || isFormOpen}
                      >
                        {deleting === kind.slug ? 'Deleting…' : 'Delete'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
