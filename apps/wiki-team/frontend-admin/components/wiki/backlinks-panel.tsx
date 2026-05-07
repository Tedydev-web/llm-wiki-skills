/**
 * backlinks-panel.tsx — right panel: incoming links (notes that reference current note).
 *
 * Queries GET /api/workspaces/:id/notes/:slug/backlinks.
 * Each item is clickable — navigates to that note in same three-panel view.
 * Color dot uses kindColor from API response.
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { api, type NoteRef, WikiTeamApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface BacklinksPanelProps {
  workspaceSlug: string;
  noteSlug: string | null;
  onNavigate: (slug: string) => void;
  /** Collapsed state controlled by parent (keyboard shortcut `b`) */
  collapsed?: boolean;
}

export function BacklinksPanel({ workspaceSlug, noteSlug, onNavigate, collapsed }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<NoteRef[]>([]);
  const [loading, setLoading]     = useState(false);

  const load = useCallback(() => {
    if (!noteSlug) { setBacklinks([]); return; }
    setLoading(true);
    api.notes
      .getBacklinks(workspaceSlug, noteSlug)
      .then(setBacklinks)
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load backlinks', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [workspaceSlug, noteSlug]);

  useEffect(() => { load(); }, [load]);

  if (collapsed) return null;

  return (
    <section
      aria-label="Backlinks panel"
      className="flex h-full flex-col border-l"
    >
      <div className="border-b px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          Linked from
          {!loading && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
              {backlinks.length}
            </span>
          )}
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Loading…</p>
        ) : !noteSlug ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Select a note to see backlinks.</p>
        ) : backlinks.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">No backlinks yet.</p>
        ) : (
          <ul aria-label="Notes linking to this note">
            {backlinks.map((ref) => (
              <li key={ref.slug}>
                <button
                  onClick={() => onNavigate(ref.slug)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                    'hover:bg-muted',
                  )}
                  aria-label={`Navigate to ${ref.title}`}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: ref.kindColor ?? '#6b7280' }}
                    aria-hidden="true"
                  />
                  <span className="truncate">{ref.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
