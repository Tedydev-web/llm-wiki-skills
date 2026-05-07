/**
 * scope-assignment-form.tsx — Assign note kinds to a group (P08 scope assignment UX).
 *
 * Loads all available note kinds + currently assigned kinds for the group.
 * Renders checkbox list with kind color swatches.
 * Toggling a checkbox calls POST or DELETE /note-kinds endpoint immediately.
 *
 * Anti-trace: generic "group" / "kind" naming.
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { api, type NoteKind, WikiTeamApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';

interface ScopeAssignmentFormProps {
  workspaceId: string;
  groupSlug: string;
}

export function ScopeAssignmentForm({ workspaceId, groupSlug }: ScopeAssignmentFormProps) {
  const [allKinds, setAllKinds] = useState<NoteKind[]>([]);
  const [assignedSlugs, setAssignedSlugs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kinds, assigned] = await Promise.all([
        api.noteKinds.list(workspaceId),
        api.groups.listNoteKinds(workspaceId, groupSlug),
      ]);
      setAllKinds(kinds);
      setAssignedSlugs(new Set(assigned.map((a) => a.noteKindSlug)));
    } catch (err) {
      const msg = err instanceof WikiTeamApiError ? err.message : 'Load failed';
      toast({ title: 'Failed to load scope', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [workspaceId, groupSlug]);

  useEffect(() => { void load(); }, [load]);

  async function handleToggle(kindSlug: string, currentlyAssigned: boolean) {
    setToggling(kindSlug);
    try {
      if (currentlyAssigned) {
        await api.groups.removeNoteKind(workspaceId, groupSlug, kindSlug);
        setAssignedSlugs((prev) => { const next = new Set(prev); next.delete(kindSlug); return next; });
        toast({ title: `Removed '${kindSlug}' from group scope` });
      } else {
        await api.groups.assignNoteKind(workspaceId, groupSlug, kindSlug);
        setAssignedSlugs((prev) => new Set([...prev, kindSlug]));
        toast({ title: `Assigned '${kindSlug}' to group scope` });
      }
    } catch (err) {
      const msg = err instanceof WikiTeamApiError ? err.message : 'Toggle failed';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    } finally {
      setToggling(null);
    }
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading scope…</p>;
  }

  const hasRestrictions = assignedSlugs.size > 0;

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Note kind scope</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {hasRestrictions
            ? 'Members of this group see only checked kinds.'
            : 'No restrictions — members see all note kinds.'}
        </p>
      </div>

      <ul className="space-y-1.5">
        {allKinds.map((kind) => {
          const isAssigned = assignedSlugs.has(kind.slug);
          const isToggling = toggling === kind.slug;
          return (
            <li key={kind.slug} className="flex items-center gap-3">
              <input
                type="checkbox"
                id={`kind-${kind.slug}`}
                checked={isAssigned}
                disabled={isToggling}
                onChange={() => void handleToggle(kind.slug, isAssigned)}
                className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
              />
              <span
                className="inline-block h-3 w-3 rounded-full border border-border flex-shrink-0"
                style={{ backgroundColor: kind.color }}
                aria-hidden="true"
              />
              <label
                htmlFor={`kind-${kind.slug}`}
                className="text-sm cursor-pointer select-none flex items-center gap-1.5"
              >
                {kind.label}
                <span className="text-xs text-muted-foreground font-mono">({kind.slug})</span>
                {kind.isSystemDefault && (
                  <span className="text-xs text-muted-foreground bg-muted px-1 rounded">system</span>
                )}
              </label>
              {isToggling && (
                <span className="text-xs text-muted-foreground">Saving…</span>
              )}
            </li>
          );
        })}
      </ul>

      {allKinds.length === 0 && (
        <p className="text-xs text-muted-foreground">No note kinds available.</p>
      )}
    </div>
  );
}
