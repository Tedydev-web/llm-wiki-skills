/**
 * members-table.tsx — table of workspace members with role-change + remove actions.
 */

'use client';

import React, { useState } from 'react';
import { api, type Member, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { formatDate } from '@/lib/utils';

const TIERS = ['observer', 'contributor', 'steward', 'owner'] as const;
type Tier = Member['tier'];

interface Props {
  members: Member[];
  workspaceId: string;
  onChanged: () => void;
}

export function MembersTable({ members, workspaceId, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null);

  async function handleTierChange(userId: string, tier: Tier) {
    setBusy(userId);
    try {
      await api.members.updateTier(workspaceId, userId, tier);
      toast({ title: 'Role updated' });
      onChanged();
    } catch (err) {
      toast({ title: 'Failed to update role', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(userId: string) {
    if (!window.confirm('Remove this member from the workspace?')) return;
    setBusy(userId);
    try {
      await api.members.remove(workspaceId, userId);
      toast({ title: 'Member removed' });
      onChanged();
    } catch (err) {
      toast({ title: 'Failed to remove member', description: (err as WikiTeamApiError).message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  if (members.length === 0) {
    return <p className="text-muted-foreground text-sm">No members yet.</p>;
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="px-4 py-2 text-left font-medium">User ID</th>
            <th className="px-4 py-2 text-left font-medium">Role</th>
            <th className="px-4 py-2 text-left font-medium">Joined</th>
            <th className="px-4 py-2 text-left font-medium sr-only">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {members.map((m) => (
            <tr key={m.id} className="hover:bg-muted/50 transition-colors">
              <td className="px-4 py-2 font-mono text-xs break-all max-w-[180px]">{m.userId}</td>
              <td className="px-4 py-2">
                <Select
                  defaultValue={m.tier}
                  onValueChange={(v) => handleTierChange(m.userId, v as Tier)}
                  disabled={busy === m.userId}
                >
                  <SelectTrigger className="w-36 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIERS.map((t) => (
                      <SelectItem key={t} value={t}>
                        <span className="capitalize">{t}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
              <td className="px-4 py-2 text-muted-foreground text-xs whitespace-nowrap">
                {formatDate(m.joinedAt)}
              </td>
              <td className="px-4 py-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => handleRemove(m.userId)}
                  disabled={busy === m.userId}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
