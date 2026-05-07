/**
 * note-edit-dialog.tsx — PATCH edit modal for a wiki note.
 *
 * Extracts the Dialog + form from note-content.tsx to keep that file ≤200 LOC.
 * Handles If-Match / ETag optimistic concurrency and 409 conflict UX.
 */

'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Note } from '@/lib/api-client';
import { api, OptimisticConflictError, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';

const patchSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  body: z.string(),
});
export type PatchForm = z.infer<typeof patchSchema>;

interface NoteEditDialogProps {
  open: boolean;
  onClose: () => void;
  note: Note;
  etag: string | undefined;
  workspaceSlug: string;
  onSaved: () => void;
}

export function NoteEditDialog({ open, onClose, note, etag, workspaceSlug, onSaved }: NoteEditDialogProps) {
  const [saving, setSaving] = React.useState(false);
  const [conflictVer, setConflictVer] = React.useState<number | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<PatchForm>({
    resolver: zodResolver(patchSchema),
    defaultValues: { title: note.title, body: note.body },
  });

  async function onSubmit(data: PatchForm) {
    if (!etag) {
      toast({ title: 'Cannot save', description: 'Missing ETag — reload first.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await api.notes.update(workspaceSlug, note.slug, etag, data);
      onClose();
      onSaved();
      toast({ title: 'Note saved' });
    } catch (err) {
      if (err instanceof OptimisticConflictError) {
        setConflictVer(err.currentVersion);
      } else {
        toast({ title: 'Save failed', description: (err as WikiTeamApiError).message, variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
            <DialogDescription>
              Uses optimistic concurrency (If-Match). Save fails with 409 on simultaneous edits.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3 mt-2">
            <div className="space-y-1">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" {...register('title')} />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-body">Body</Label>
              <textarea
                id="edit-body"
                {...register('body')}
                rows={14}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono
                  shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 409 Conflict modal */}
      <Dialog open={conflictVer !== null} onOpenChange={(o) => { if (!o) setConflictVer(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conflict: note updated by someone else</DialogTitle>
            <DialogDescription>
              Server version: <strong>v{conflictVer}</strong>. Your draft is based on v{note.version}.
              Reload to fetch latest, then re-apply changes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflictVer(null)}>Keep editing</Button>
            <Button onClick={() => { setConflictVer(null); onClose(); onSaved(); }}>Reload latest</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
