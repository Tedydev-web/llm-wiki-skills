/**
 * outlinks-panel.tsx — right panel section: outgoing links (notes this note links to).
 *
 * Reads note.links JSONB (string[] of slugs already on the Note object).
 * Resolves titles by cross-referencing the full notes list passed from parent.
 * No extra HTTP call needed — data already fetched by note-content.tsx + page-tree.tsx.
 * Each item navigates to that note in the three-panel view.
 */

'use client';

import React, { useMemo } from 'react';
import type { NoteSummary } from '@/lib/api-client';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface OutlinksPanelProps {
  /** Raw links JSONB from current note (array of slug strings) */
  noteLinks: unknown;
  /** Full notes list from page-tree for title resolution */
  allNotes: NoteSummary[];
  onNavigate: (slug: string) => void;
  collapsed?: boolean;
}

interface ResolvedLink {
  slug: string;
  title: string;
  kindColor: string;
}

export function OutlinksPanel({ noteLinks, allNotes, onNavigate, collapsed }: OutlinksPanelProps) {
  const slugs = useMemo(() => api.notes.getCrossrefs(noteLinks), [noteLinks]);

  const resolved = useMemo<ResolvedLink[]>(() => {
    const noteMap = new Map(allNotes.map((n) => [n.slug, n]));
    return slugs.map((slug) => {
      const found = noteMap.get(slug);
      return {
        slug,
        title: found?.title ?? slug,
        kindColor: '#6b7280', // default; no kind color in NoteSummary — acceptable per YAGNI
      };
    });
  }, [slugs, allNotes]);

  if (collapsed) return null;

  return (
    <section aria-label="Outlinks panel" className="border-t">
      <div className="border-b px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
          Links to
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums">
            {resolved.length}
          </span>
        </h2>
      </div>

      {resolved.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">No outgoing links.</p>
      ) : (
        <ul aria-label="Notes this note links to" className="max-h-48 overflow-y-auto">
          {resolved.map((ref) => (
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
                  style={{ backgroundColor: ref.kindColor }}
                  aria-hidden="true"
                />
                <span className="truncate">{ref.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
