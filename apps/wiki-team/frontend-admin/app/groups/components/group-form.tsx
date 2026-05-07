/**
 * group-form.tsx — Create group form (P08).
 *
 * Validates slug + displayName client-side before POST.
 * Anti-trace: generic "group" naming.
 */

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { api, type Group, WikiTeamApiError } from '@/lib/api-client';

const SLUG_RE = /^[a-z0-9-]{1,64}$/;

interface GroupFormProps {
  workspaceId: string;
  onSaved: (group: Group) => void;
  onCancel: () => void;
}

export function GroupForm({ workspaceId, onSaved, onCancel }: GroupFormProps) {
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!SLUG_RE.test(slug)) errs['slug'] = 'Slug: 1–64 lowercase alphanumeric or hyphen';
    if (!displayName.trim()) errs['displayName'] = 'Display name is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const group = await api.groups.create(workspaceId, { slug, displayName });
      onSaved(group);
    } catch (err) {
      const msg = err instanceof WikiTeamApiError ? err.message : 'Save failed';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="group-slug">Slug</label>
        <input
          id="group-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="e.g. sales"
          className="w-full rounded-md border px-3 py-2 text-sm"
          autoFocus
        />
        {errors['slug'] && <p className="text-xs text-red-500">{errors['slug']}</p>}
      </div>

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="group-display-name">Display Name</label>
        <input
          id="group-display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Sales Team"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        {errors['displayName'] && <p className="text-xs text-red-500">{errors['displayName']}</p>}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
