/**
 * workspaces/[slug]/members/page.tsx — member management tab.
 */

'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type Member, WikiTeamApiError } from '@/lib/api-client';
import { MembersTable } from '@/components/members/members-table';
import { InviteMemberForm } from '@/components/members/invite-member-form';
import { toast } from '@/components/ui/toast';
import { Separator } from '@/components/ui/separator';

export default function MembersPage() {
  const { slug } = useParams<{ slug: string }>();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  function loadMembers() {
    setLoading(true);
    api.members
      .list(slug)
      .then(setMembers)
      .catch((err: WikiTeamApiError) => {
        toast({ title: 'Failed to load members', description: err.message, variant: 'destructive' });
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadMembers(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-base font-semibold mb-1">Members</h3>
        <p className="text-sm text-muted-foreground">Manage who has access to this workspace.</p>
      </div>

      <InviteMemberForm
        workspaceId={slug}
        onInvited={() => loadMembers()}
      />

      <Separator />

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (
        <MembersTable
          members={members}
          workspaceId={slug}
          onChanged={() => loadMembers()}
        />
      )}
    </section>
  );
}
