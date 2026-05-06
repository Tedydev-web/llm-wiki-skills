/**
 * invite-member-form.tsx — form to invite a user by userId + assign initial tier.
 */

'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, WikiTeamApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';

const schema = z.object({
  userId: z.string().uuid('Must be a valid user UUID'),
  tier: z.enum(['observer', 'contributor', 'steward', 'owner']),
});
type FormValues = z.infer<typeof schema>;

interface Props {
  workspaceId: string;
  onInvited: () => void;
}

export function InviteMemberForm({ workspaceId, onInvited }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { tier: 'observer' },
  });

  const tier = watch('tier');

  async function onSubmit(data: FormValues) {
    try {
      await api.members.invite(workspaceId, data.userId, data.tier);
      toast({ title: 'Member invited', description: data.userId });
      reset();
      onInvited();
    } catch (err) {
      toast({
        title: 'Invite failed',
        description: (err as WikiTeamApiError).message,
        variant: 'destructive',
      });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1 flex-1 min-w-[200px]">
        <Label htmlFor="invite-uid">User ID</Label>
        <Input
          id="invite-uid"
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          {...register('userId')}
        />
        {errors.userId && (
          <p className="text-xs text-destructive">{errors.userId.message}</p>
        )}
      </div>

      <div className="space-y-1 w-36">
        <Label htmlFor="invite-tier">Role</Label>
        <Select
          value={tier}
          onValueChange={(v) => setValue('tier', v as FormValues['tier'])}
        >
          <SelectTrigger id="invite-tier">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="observer">Observer</SelectItem>
            <SelectItem value="contributor">Contributor</SelectItem>
            <SelectItem value="steward">Steward</SelectItem>
            <SelectItem value="owner">Owner</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Inviting…' : 'Invite'}
      </Button>
    </form>
  );
}
