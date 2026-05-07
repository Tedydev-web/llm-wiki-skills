/**
 * kind-form.tsx — Create / Edit NoteKind dialog form (ADR 014 / P02).
 *
 * Used by note-kinds/page.tsx for both create and patch operations.
 * Validates slug (create only) and color client-side before submit.
 *
  * Anti-trace: own naming throughout (see plan.md §Anti-Trace Discipline).
 */

'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { api, type NoteKind, WikiTeamApiError } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Validation helpers (mirror server-side rules)

const SLUG_RE = /^[a-z0-9-]{1,32}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

function validateSlug(v: string): string | null {
  return SLUG_RE.test(v) ? null : 'Slug: 1–32 lowercase alphanumeric or hyphen chars';
}
function validateColor(v: string): string | null {
  return COLOR_RE.test(v) ? null : 'Color must be a 6-digit hex (e.g. #3b82f6)';
}

// ---------------------------------------------------------------------------
// Props

interface KindFormProps {
  workspaceId: string;
  /** When provided: edit mode (PATCH). When null: create mode (POST). */
  editing: NoteKind | null;
  onSaved: (kind: NoteKind) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Component

export function KindForm({ workspaceId, editing, onSaved, onCancel }: KindFormProps) {
  const isEdit = editing !== null;

  const [slug, setSlug] = useState(editing?.slug ?? '');
  const [label, setLabel] = useState(editing?.label ?? '');
  const [color, setColor] = useState(editing?.color ?? '#6b7280');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset when switching between create/edit targets
  useEffect(() => {
    setSlug(editing?.slug ?? '');
    setLabel(editing?.label ?? '');
    setColor(editing?.color ?? '#6b7280');
    setDescription(editing?.description ?? '');
    setErrors({});
  }, [editing]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!isEdit) {
      const slugErr = validateSlug(slug);
      if (slugErr) errs['slug'] = slugErr;
      if (!label.trim()) errs['label'] = 'Label is required';
    }
    const colorErr = validateColor(color);
    if (colorErr) errs['color'] = colorErr;
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      let saved: NoteKind;
      if (isEdit) {
        saved = await api.noteKinds.patch(workspaceId, editing!.slug, {
          color,
          description: description || undefined,
        });
      } else {
        saved = await api.noteKinds.create(workspaceId, {
          slug,
          label,
          color,
          description: description || undefined,
        });
      }
      toast({ title: isEdit ? 'NoteKind updated' : 'NoteKind created' });
      onSaved(saved);
    } catch (err) {
      const msg = err instanceof WikiTeamApiError ? err.message : 'Save failed';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Slug — create only */}
      {!isEdit && (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="kind-slug">Slug</label>
          <input
            id="kind-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="e.g. runbook"
            className="w-full rounded-md border px-3 py-2 text-sm"
            autoFocus
          />
          {errors['slug'] && <p className="text-xs text-red-500">{errors['slug']}</p>}
        </div>
      )}

      {/* Label — create only (immutable after creation per ADR 014) */}
      {!isEdit && (
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="kind-label">Label</label>
          <input
            id="kind-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Runbook"
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          {errors['label'] && <p className="text-xs text-red-500">{errors['label']}</p>}
        </div>
      )}

      {/* Color hex + swatch */}
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="kind-color">Color</label>
        <div className="flex items-center gap-2">
          <div
            className="h-8 w-8 rounded border"
            style={{ backgroundColor: COLOR_RE.test(color) ? color : '#6b7280' }}
            aria-hidden="true"
          />
          <input
            id="kind-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#6b7280"
            maxLength={7}
            className="w-36 rounded-md border px-3 py-2 text-sm font-mono"
          />
          {/* Native color picker — syncs with hex input */}
          <input
            type="color"
            value={COLOR_RE.test(color) ? color : '#6b7280'}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border p-0"
            aria-label="Pick color"
          />
        </div>
        {errors['color'] && <p className="text-xs text-red-500">{errors['color']}</p>}
      </div>

      {/* Description */}
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="kind-description">Description</label>
        <textarea
          id="kind-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
