/**
 * page-tree.tsx — left panel: notes grouped by kind (taxonomy), collapsible.
 *
 * Fetches all notes + note kinds for the workspace.
 * Groups notes by taxonomy slug. Sorts groups and notes alphabetically.
 * Color dot per group uses noteKind.color (#rrggbb).
 * Exposes roving tabindex for keyboard navigation (j/k via keyboard-nav.tsx).
 */

'use client';

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { api, type NoteSummary, type NoteKind, WikiTeamApiError } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface PageTreeProps {
  workspaceSlug: string;
  selectedSlug: string | null;
  onSelect: (noteSlug: string) => void;
  /** Exposed setter so keyboard-nav can call setFocusIndex externally */
  onTreeReady?: (flatNotes: NoteSummary[]) => void;
}

interface KindGroup {
  kind: NoteKind | null;
  slug: string;
  label: string;
  color: string;
  notes: NoteSummary[];
  expanded: boolean;
}

export function PageTree({ workspaceSlug, selectedSlug, onSelect, onTreeReady }: PageTreeProps) {
  const [notes, setNotes]       = useState<NoteSummary[]>([]);
  const [kinds, setKinds]       = useState<NoteKind[]>([]);
  const [filter, setFilter]     = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading]   = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.notes.list(workspaceSlug),
      api.noteKinds.list(workspaceSlug),
    ])
      .then(([n, k]) => {
        setNotes(n);
        setKinds(k);
      })
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load tree', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }, [workspaceSlug]);

  useEffect(() => { load(); }, [load]);

  const filteredNotes = useMemo(() => {
    const q = filter.toLowerCase();
    return q ? notes.filter((n) => n.title.toLowerCase().includes(q) || n.slug.includes(q)) : notes;
  }, [notes, filter]);

  const groups = useMemo<KindGroup[]>(() => {
    const kindMap = new Map(kinds.map((k) => [k.slug, k]));
    const byKind = new Map<string, NoteSummary[]>();

    for (const n of filteredNotes) {
      const ks = n.taxonomy;
      const arr = byKind.get(ks) ?? [];
      arr.push(n);
      byKind.set(ks, arr);
    }

    const result: KindGroup[] = [];
    for (const [ks, ns] of byKind) {
      const kind = kindMap.get(ks) ?? null;
      result.push({
        kind,
        slug: ks,
        label: kind?.label ?? ks,
        color: kind?.color ?? '#6b7280',
        notes: [...ns].sort((a, b) => a.title.localeCompare(b.title)),
        expanded: !collapsed[ks],
      });
    }
    return result.sort((a, b) => a.label.localeCompare(b.label));
  }, [filteredNotes, kinds, collapsed]);

  // Expose flat ordered notes to parent (for keyboard nav)
  const flatNotes = useMemo(() =>
    groups.flatMap((g) => (collapsed[g.slug] ? [] : g.notes)),
    [groups, collapsed],
  );

  useEffect(() => { onTreeReady?.(flatNotes); }, [flatNotes, onTreeReady]);

  function toggleGroup(kindSlug: string) {
    setCollapsed((prev) => ({ ...prev, [kindSlug]: !prev[kindSlug] }));
  }

  if (loading) {
    return <div className="p-3 text-sm text-muted-foreground">Loading tree…</div>;
  }

  return (
    <div className="flex h-full flex-col" role="navigation" aria-label="Page tree">
      <div className="px-3 py-2 border-b">
        <Input
          placeholder="Filter notes…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter notes by title"
          className="h-7 text-xs"
        />
      </div>

      <div className="flex-1 overflow-y-auto" role="tree" aria-label="Notes tree">
        {groups.length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">No notes found.</p>
        ) : (
          groups.map((g) => (
            <div key={g.slug} role="group" aria-label={g.label}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(g.slug)}
                aria-expanded={!collapsed[g.slug]}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide',
                  'text-muted-foreground hover:text-foreground transition-colors',
                )}
              >
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: g.color }}
                  aria-hidden="true"
                />
                <span className="flex-1 text-left">{g.label}</span>
                <span className="tabular-nums">{g.notes.length}</span>
                <span aria-hidden="true">{collapsed[g.slug] ? '▶' : '▼'}</span>
              </button>

              {/* Note list */}
              {!collapsed[g.slug] && (
                <ul role="listitem" aria-label={`${g.label} notes`}>
                  {g.notes.map((n) => (
                    <li key={n.slug} role="treeitem" aria-selected={selectedSlug === n.slug}>
                      <button
                        onClick={() => onSelect(n.slug)}
                        className={cn(
                          'w-full px-4 py-1.5 text-left text-sm truncate transition-colors',
                          selectedSlug === n.slug
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-foreground hover:bg-muted',
                        )}
                        title={n.title}
                        data-note-slug={n.slug}
                      >
                        {n.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
