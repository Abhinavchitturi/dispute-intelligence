import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users, X } from 'lucide-react';
import { fetchCollaborators, fetchPeople, shareCase, unshareCase } from '../api/client';
import { DisputeDetail } from '../types';
import { Button, Select, useToast } from './ui/kit';
import { useCurrentUser } from '../lib/user';

const KEYS = ['disputes', 'urgentDisputes', 'dashboardSummary', 'disputeDetail', 'collaborators', 'auditEvents', 'messageThreads', 'notifications'];

/**
 * A case can have more than one investigator on it. The owner stays the owner; everyone else is "also on this case".
 * An investigator already on the case can bring a colleague in. The manager can add or remove anyone.
 */
export function CollaboratorsPanel({ dispute: d }: { dispute: DisputeDetail }) {
  const { user, isManager } = useCurrentUser();
  const toast = useToast();
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const open = !['RESOLVED', 'CLOSED'].includes(d.status);
  const isOwner = d.assigned_to === user.name;

  const team = useQuery({ queryKey: ['collaborators', d.id], queryFn: () => fetchCollaborators(d.id), retry: 0 });
  const people = useQuery({ queryKey: ['people'], queryFn: fetchPeople, staleTime: 60_000, retry: 0, enabled: open });
  const refresh = () => KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const add = useMutation({
    mutationFn: () => shareCase(d.id, pick),
    onSuccess: (c) => { toast('success', `${c.name} is now on this case.`); setPick(''); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => unshareCase(d.id, userId),
    onSuccess: () => { toast('info', 'Taken off the case.'); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });

  // Until the real list (with ids) arrives, show the names from the case itself. They can't be removed until we know who they are.
  const loaded = !!team.data;
  const on = team.data?.collaborators ?? (d.collaborators ?? []).map((name) => ({ id: name, user_id: name, name, added_by: null, created_at: '' }));
  const already = new Set([d.assigned_to, ...on.map((c) => c.name)]);
  const choices = (people.data ?? []).filter((p) => !already.has(p.name));
  if (!on.length && !open) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted" aria-label="Who is on this case">
      <span className="flex items-center gap-1.5"><Users aria-hidden className="h-3.5 w-3.5" />{on.length ? 'Also on this case:' : 'Only you on this case.'}</span>
      {on.map((c) => {
        const mayRemove = loaded && (isManager || isOwner || c.name === user.name);
        return (
          <span key={c.user_id} className="inline-flex items-center gap-1 rounded-full bg-white/[.07] py-0.5 pl-2.5 pr-1 text-slate-200">
            {c.name}{c.name === user.name && <span className="text-muted"> (you)</span>}
            {mayRemove && (
              <button onClick={() => remove.mutate(c.user_id)} aria-label={c.name === user.name ? 'Leave this case' : `Take ${c.name} off this case`} className="grid h-5 w-5 place-items-center rounded-full text-muted transition hover:bg-white/10 hover:text-white">
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}
      {open && choices.length > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Share this case with" className="w-44 text-[13px]">
            <option value="">Share with…</option>
            {choices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Button size="sm" disabled={!pick} loading={add.isPending} onClick={() => add.mutate()}><UserPlus className="h-3.5 w-3.5" />Add</Button>
        </span>
      )}
    </div>
  );
}
