/**
 * search-bar.tsx — semantic search input + results panel for the notes browser.
 *
 * Spec (P04):
 *   - Input + debounced search (300ms)
 *   - Calls GET /api/workspaces/:wid/notes?q=<query>&mode=semantic
 *   - Loading skeleton while pending
 *   - Empty-state: "No matches. Try keywords or check provider config."
 *   - Error-state: EMBEDDING_PROVIDER_NOT_CONFIGURED → link to /settings
 *   - Scores displayed as cosine similarity (1 - distance), formatted to 2 dp
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { WikiTeamApiError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types

interface SemanticResult {
  id: string;
  slug: string;
  title: string;
  content: string;
  taxonomy: string;
  score: number;                       // cosine distance (0 = identical, 2 = opposite)
  embeddingProvider: string | null;
  embeddingDimensions: number | null;
}

interface SearchBarProps {
  /** Workspace slug — used in both API path and note links (matches URL param :id convention) */
  workspaceSlug: string;
}

// ---------------------------------------------------------------------------
// Helpers

const BASE_URL =
  (typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL']) ||
  'http://localhost:3333';

async function semanticSearch(workspaceId: string, q: string): Promise<SemanticResult[]> {
  const url = `${BASE_URL}/api/workspaces/${workspaceId}/notes?q=${encodeURIComponent(q)}&mode=semantic`;
  const res = await fetch(url, { credentials: 'include' });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string; code?: string };
    throw new WikiTeamApiError(res.status, body.code ?? 'unknown', body.message ?? `Error ${res.status}`);
  }

  const data = await res.json() as { notes: SemanticResult[] };
  return data.notes;
}

/** Convert cosine distance → similarity score (0–100) for display */
function toSimilarity(distance: number): number {
  return Math.round((1 - Math.min(distance, 1)) * 100);
}

/** First 140 chars of content as excerpt */
function excerpt(content: string): string {
  return content.length > 140 ? `${content.slice(0, 137)}…` : content;
}

// ---------------------------------------------------------------------------
// LoadingSkeleton

function LoadingSkeleton() {
  return (
    <ul className="space-y-2" aria-busy="true" aria-label="Loading search results">
      {[1, 2, 3].map((i) => (
        <li key={i} className="rounded-md border px-4 py-3 space-y-2 animate-pulse">
          <div className="h-4 bg-muted rounded w-1/2" />
          <div className="h-3 bg-muted rounded w-full" />
          <div className="h-3 bg-muted rounded w-3/4" />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// SearchBar

export function SearchBar({ workspaceSlug }: SearchBarProps) {
  const workspaceId = workspaceSlug; // API route param :id accepts slug directly
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<SemanticResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<WikiTeamApiError | null>(null);
  const debounceRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "/" hotkey — focus the search input
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('semantic-search-input')?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Debounced search trigger (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults(null);
      setError(null);
      setLoading(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await semanticSearch(workspaceId, query.trim());
        setResults(data);
      } catch (err) {
        setError(err instanceof WikiTeamApiError ? err : new WikiTeamApiError(500, 'unknown', String(err)));
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, workspaceId]);

  // -------------------------------------------------------------------------
  // Render

  return (
    <div className="space-y-3">
      <Input
        id="semantic-search-input"
        placeholder="Semantic search… (press / to focus)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); } }}
        className="max-w-lg"
        aria-label="Semantic search notes"
        aria-controls="search-results"
      />

      <div id="search-results" role="region" aria-live="polite">
        {/* Loading state */}
        {loading && <LoadingSkeleton />}

        {/* Error: provider not configured → link to settings */}
        {!loading && error?.code === 'EMBEDDING_PROVIDER_NOT_CONFIGURED' && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No embedding provider configured for this workspace.{' '}
            <Link
              href={`/workspaces/${workspaceSlug}/settings`}
              className="underline font-medium hover:text-amber-900"
            >
              Go to Settings to configure one.
            </Link>
          </div>
        )}

        {/* Other errors */}
        {!loading && error && error.code !== 'EMBEDDING_PROVIDER_NOT_CONFIGURED' && (
          <p className="text-sm text-destructive">
            Search failed: {error.message}
          </p>
        )}

        {/* Empty state */}
        {!loading && !error && results !== null && results.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No matches. Try different keywords or check provider config.
          </p>
        )}

        {/* Results list */}
        {!loading && !error && results && results.length > 0 && (
          <ul className="divide-y divide-border rounded-md border">
            {results.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/workspaces/${workspaceSlug}/notes/${r.slug}`}
                  className="flex items-start justify-between px-4 py-3 hover:bg-muted transition-colors gap-4"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted-foreground font-mono">{r.slug}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{excerpt(r.content)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant="secondary" title="Semantic similarity score">
                      {toSimilarity(r.score)}%
                    </Badge>
                    {r.taxonomy && (
                      <Badge variant="outline" className="text-xs">{r.taxonomy}</Badge>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
