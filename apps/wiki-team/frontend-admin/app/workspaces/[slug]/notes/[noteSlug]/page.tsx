/**
 * notes/[noteSlug]/page.tsx — read note + PATCH with If-Match + 409 conflict UX.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, type Note, OptimisticConflictError, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';

const patchSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string(),
});
type PatchForm = z.infer<typeof patchSchema>;

export default function NoteDetailPage() {
  const { slug, noteSlug } = useParams<{ slug: string; noteSlug: string }>();
  const [note, setNote] = useState<Note | null>(null);
  const [etag, setEtag] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [conflictVersion, setConflictVersion] = useState<number | null>(null);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<PatchForm>({
    resolver: zodResolver(patchSchema),
  });

  async function loadNote() {
    setLoading(true);
    try {
      const { note: n, etag: tag } = await api.notes.get(slug, noteSlug);
      setNote(n);
      setEtag(tag);
      reset({ title: n.title, body: n.body });
    } catch (err) {
      toast({ title: 'Failed to load note', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadNote(); }, [slug, noteSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(data: PatchForm) {
    if (!etag) {
      toast({ title: 'Cannot save', description: 'Missing ETag — please reload.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const updated = await api.notes.update(slug, noteSlug, etag, data);
      setNote(updated);
      // Refresh ETag from reloaded note
      const { etag: newTag } = await api.notes.get(slug, noteSlug);
      setEtag(newTag);
      toast({ title: 'Note saved' });
    } catch (err) {
      if (err instanceof OptimisticConflictError) {
        setConflictVersion(err.currentVersion);
      } else {
        toast({ title: 'Save failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConflictReload() {
    setConflictVersion(null);
    await loadNote();
    toast({ title: 'Note reloaded — review changes and save again.' });
  }

  if (loading) return <p className="text-muted-foreground text-sm">Loading…</p>;
  if (!note) return <p className="text-muted-foreground text-sm">Note not found.</p>;

  return (
    <section className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Badge variant="outline">v{note.version}</Badge>
        <span className="text-xs text-muted-foreground">Updated {formatDate(note.updatedAt)}</span>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="note-title">Title</Label>
          <Input id="note-title" {...register('title')} />
          {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
        </div>

        <div className="space-y-1">
          <Label htmlFor="note-body">Body</Label>
          <textarea
            id="note-body"
            {...register('body')}
            rows={16}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono
              shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
          />
        </div>

        {note.taxonomy.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {note.taxonomy.map((tag) => (
              <Badge key={tag} variant="secondary">{tag}</Badge>
            ))}
          </div>
        )}

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </form>

      {/* 409 Conflict modal */}
      <Dialog open={conflictVersion !== null} onOpenChange={(open) => { if (!open) setConflictVersion(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Note updated by someone else</DialogTitle>
            <DialogDescription>
              Current version on server: <strong>v{conflictVersion}</strong>. Your local version is v{note.version}.
              Reload to fetch the latest, then re-apply your changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflictVersion(null)}>
              Keep editing
            </Button>
            <Button onClick={handleConflictReload}>
              Reload latest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
