/**
 * workspaces/[slug]/notes/page.tsx — note browser with keyword + semantic search.
 *
 * P04: semantic search tab added via SearchBar component.
 * Keyword search (existing) uses GET /notes?q= (ILIKE).
 * Semantic search uses GET /notes?q=&mode=semantic (pgvector cosine distance).
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, type NoteSummary, WikiTeamApiError } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';
import { SearchBar } from './components/search-bar';

type SearchMode = 'keyword' | 'semantic';

export default function NotesPage() {
  const { slug } = useParams<{ slug: string }>();
  const [notes, setNotes]       = useState<NoteSummary[]>([]);
  const [query, setQuery]       = useState('');
  const [loading, setLoading]   = useState(true);
  const [mode, setMode]         = useState<SearchMode>('keyword');

  const loadNotes = useCallback(
    (q?: string) => {
      setLoading(true);
      api.notes
        .list(slug, q)
        .then(setNotes)
        .catch((err: WikiTeamApiError) => {
          toast({ title: 'Failed to load notes', description: err.message, variant: 'destructive' });
        })
        .finally(() => setLoading(false));
    },
    [slug],
  );

  useEffect(() => { loadNotes(); }, [loadNotes]);

  // Debounce keyword search by 300 ms
  useEffect(() => {
    if (mode !== 'keyword') return;
    const t = setTimeout(() => loadNotes(query || undefined), 300);
    return () => clearTimeout(t);
  }, [query, loadNotes, mode]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Notes</h3>
        <p className="text-sm text-muted-foreground">{notes.length} note{notes.length !== 1 ? 's' : ''}</p>
      </div>

      {/* Search mode toggle */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => setMode('keyword')}
          className={`px-3 py-1 rounded-md border transition-colors ${mode === 'keyword' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
          aria-pressed={mode === 'keyword'}
        >
          Keyword
        </button>
        <button
          onClick={() => setMode('semantic')}
          className={`px-3 py-1 rounded-md border transition-colors ${mode === 'semantic' ? 'bg-primary text-primary-foreground border-primary' : 'border-border hover:bg-muted'}`}
          aria-pressed={mode === 'semantic'}
        >
          Semantic
        </button>
      </div>

      {/* Semantic search panel */}
      {mode === 'semantic' && (
        <SearchBar workspaceSlug={slug} />
      )}

      {/* Keyword search + list */}
      {mode === 'keyword' && (
        <>
          <Input
            placeholder="Search notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-sm"
            aria-label="Keyword search notes"
          />

          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="text-muted-foreground text-sm">No notes found.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/workspaces/${slug}/notes/${n.slug}`}
                    className="flex items-start justify-between px-4 py-3 hover:bg-muted transition-colors gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      <p className="text-xs text-muted-foreground font-mono">{n.slug}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline">v{n.version}</Badge>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(n.updatedAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
