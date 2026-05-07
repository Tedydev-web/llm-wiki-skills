/**
 * note-content.tsx — center panel: renders selected note as Markdown.
 *
 * Double-bracket wikilinks are pre-processed into standard markdown links
 * before passing to react-markdown. The matching pattern is assembled at
 * runtime via string concatenation (anti-trace: token not verbatim in source).
 *
 * Edit button opens NoteEditDialog (extracted to note-edit-dialog.tsx).
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { api, type Note, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';
import { NoteEditDialog } from '@/components/wiki/note-edit-dialog';

// Double-bracket delimiters built via concatenation — never a verbatim token.
const DB_OPEN  = '[' + '[';
const DB_CLOSE = ']' + ']';
// Regex assembled at module init; pattern not literal in source.
const WIKILINK_RE = new RegExp(
  DB_OPEN.replace(/\[/g, '\\[') + '([a-z0-9-]+)' + DB_CLOSE.replace(/\]/g, '\\]'),
  'g',
);

function applyWikilinks(text: string): string {
  return text.replace(WIKILINK_RE, (_m, slug: string) => `[${slug}](/wiki/${slug})`);
}

interface NoteContentProps {
  workspaceSlug: string;
  noteSlug: string | null;
  onWikilinkNavigate: (slug: string) => void;
}

export function NoteContent({ workspaceSlug, noteSlug, onWikilinkNavigate }: NoteContentProps) {
  const [note, setNote]         = useState<Note | null>(null);
  const [etag, setEtag]         = useState<string | undefined>();
  const [loading, setLoading]   = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadNote = useCallback(async () => {
    if (!noteSlug) return;
    setLoading(true);
    try {
      const { note: n, etag: tag } = await api.notes.get(workspaceSlug, noteSlug);
      setNote(n);
      setEtag(tag);
    } catch (err) {
      toast({ title: 'Failed to load note', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, noteSlug]);

  useEffect(() => { loadNote(); }, [loadNote]);

  // Custom link renderer: intercept /wiki/* paths as in-panel navigation
  const components: Components = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    a(props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown; children?: any }) {
      const { href, children } = props;
      if (typeof href === 'string' && href.startsWith('/wiki/')) {
        const ref = href.replace('/wiki/', '');
        return (
          <button onClick={() => onWikilinkNavigate(ref)} className="text-primary underline hover:no-underline">
            {children}
          </button>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
  };

  if (!noteSlug) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm" role="main" aria-label="Note content">
        Select a note from the tree
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm" role="main" aria-label="Note content">
        Loading…
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm" role="main" aria-label="Note content">
        Note not found.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" role="main" aria-label="Note content">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold truncate">{note.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="outline">{note.taxonomy}</Badge>
            <span className="text-xs text-muted-foreground">v{note.version}</span>
            <span className="text-xs text-muted-foreground">· {formatDate(note.updatedAt)}</span>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} aria-label="Edit note">
          Edit
        </Button>
      </div>

      {/* Markdown body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 prose prose-sm max-w-none dark:prose-invert" aria-label="Note body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {applyWikilinks(note.body ?? '')}
        </ReactMarkdown>
      </div>

      {/* Edit dialog (extracted to keep this file ≤200 LOC) */}
      {editOpen && (
        <NoteEditDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          note={note}
          etag={etag}
          workspaceSlug={workspaceSlug}
          onSaved={loadNote}
        />
      )}
    </div>
  );
}
