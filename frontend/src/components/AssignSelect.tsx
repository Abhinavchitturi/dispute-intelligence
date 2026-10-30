import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignDispute, fetchUsers } from '../api/client';
import { Select, useToast } from './ui/kit';

/** The manager's control for giving a case to someone. Blocked and deactivated people can't be picked. */
export function AssignSelect({ disputeId, assignedTo, label }: { disputeId: string; assignedTo: string | null; label?: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: fetchUsers, staleTime: 30_000 });
  const assign = useMutation({
    mutationFn: (name: string) => assignDispute(disputeId, name || null),
    onSuccess: (r) => {
      toast('success', r.assigned_to ? `Assigned to ${r.assigned_to}.` : 'Now unassigned.');
      ['disputes', 'urgentDisputes', 'dashboardSummary', 'disputeDetail', 'users', 'distributionPlan', 'caseRequests', 'notifications'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast('error', e.message),
  });
  const people = (users.data ?? []).filter((u) => u.is_active && !u.is_blocked);
  // The current owner stays in the list even if they can no longer be given new cases, so the select never shows the wrong name.
  const owner = assignedTo && !people.some((p) => p.name === assignedTo) ? assignedTo : null;
  return (
    <Select
      value={assignedTo ?? ''} disabled={assign.isPending} aria-label={label ?? `Assign ${disputeId}`} className="w-44 text-[13px]"
      onClick={(e) => e.stopPropagation()} onChange={(e) => assign.mutate(e.target.value)}
    >
      <option value="">Unassigned</option>
      {owner && <option value={owner}>{owner}</option>}
      {people.map((p) => <option key={p.id} value={p.name}>{p.name}{p.role === 'MANAGER' ? ' (manager)' : ''}</option>)}
    </Select>
  );
}
