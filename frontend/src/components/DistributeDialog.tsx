import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { distributeCases, fetchDistributionPlan } from '../api/client';
import { Button, Modal, Skeleton, useToast } from './ui/kit';
import { cn } from '../lib/format';

const KEYS = ['disputes', 'urgentDisputes', 'dashboardSummary', 'distributionPlan', 'caseRequests', 'notifications', 'team', 'users'];

/** Shares `waiting` cases among the people as evenly as possible. Anyone left over goes to whoever has the fewest cases already. */
function evenSplit(people: { id: string; open_cases: number }[], waiting: number): Record<string, number> {
  const out: Record<string, number> = {};
  if (!people.length) return out;
  const base = Math.floor(waiting / people.length);
  let extra = waiting - base * people.length;
  [...people].sort((a, b) => a.open_cases - b.open_cases).forEach((p) => { out[p.id] = base + (extra-- > 0 ? 1 : 0); });
  return out;
}

/**
 * The manager hands out the cases nobody owns. Each person has a minus and a plus for how many they get,
 * and "Split evenly" fills them all in for you.
 */
export function DistributeDialog({ open, onClose, preselect, perPerson }: { open: boolean; onClose: () => void; preselect?: string; perPerson?: number }) {
  const toast = useToast();
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ['distributionPlan'], queryFn: fetchDistributionPlan, enabled: open });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [high, setHigh] = useState(false);

  const waiting = (plan.data?.unassigned ?? 0) + (high ? plan.data?.unassigned_high_profile ?? 0 : 0);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const people = plan.data?.people ?? [];

  // Starting point: nobody gets anything, except when opened for one person who asked.
  useEffect(() => {
    if (!open) return;
    setHigh(false);
    setCounts({});
  }, [open]);
  useEffect(() => {
    if (open && preselect && perPerson && plan.data) setCounts({ [preselect]: Math.min(perPerson, plan.data.unassigned) });
  }, [open, preselect, perPerson, plan.data]);
  // Taking the high-profile cases out of the pile can leave fewer than were chosen. Trim the biggest numbers until it fits.
  useEffect(() => {
    if (total <= waiting) return;
    const next = { ...counts };
    let over = total - waiting;
    while (over > 0) {
      const biggest = Object.keys(next).reduce((a, b) => (next[b] > next[a] ? b : a));
      next[biggest] -= 1; over -= 1;
    }
    setCounts(next);
  }, [total, waiting, counts]);

  const give = useMutation({
    mutationFn: () => distributeCases({ counts, include_high_profile: high }),
    onSuccess: (r) => {
      const parts = Object.entries(r.assigned).filter(([, n]) => n > 0).map(([name, n]) => `${name} ${n}`);
      toast(r.total ? 'success' : 'info', r.total ? `Handed out ${r.total} case${r.total === 1 ? '' : 's'}: ${parts.join(', ')}.` : 'There were no cases to hand out.');
      KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    },
    onError: (e: Error) => toast('error', e.message),
  });

  const step = (id: string, by: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + by) }));

  return (
    <Modal
      open={open} onClose={onClose} title="Distribute cases"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={give.isPending} disabled={!total} onClick={() => give.mutate()}>Hand out {total || ''} case{total === 1 ? '' : 's'}</Button>
      </>}
    >
      {plan.isLoading || !plan.data ? <Skeleton className="h-40" /> : (
        <>
          <p className="text-sm text-slate-300" role="status">
            <span className="font-semibold text-white">{waiting} case{waiting === 1 ? '' : 's'}</span> {waiting === 1 ? 'is' : 'are'} waiting for an owner.
            {!high && plan.data.unassigned_high_profile > 0 && <span className="text-muted"> {plan.data.unassigned_high_profile} high-profile {plan.data.unassigned_high_profile === 1 ? 'case is' : 'cases are'} kept for you.</span>}
          </p>

          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">How many each</h3>
            <Button size="sm" disabled={!waiting || !people.length} onClick={() => setCounts(evenSplit(people, waiting))}>Split evenly</Button>
          </div>

          <ul className="space-y-2" aria-label="Cases for each person">
            {people.map((p) => {
              const n = counts[p.id] ?? 0;
              return (
                <li key={p.id} className={cn('flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition', n > 0 ? 'border-brand/50 bg-brand/10' : 'border-line bg-raised/40')}>
                  <div className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-white">{p.name}</span>
                    <span className="text-xs text-muted tabular">{p.open_cases} open{p.requested && <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 font-medium text-amber-300">Asked for cases</span>}</span>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-raised p-1">
                    <button type="button" onClick={() => step(p.id, -1)} disabled={n === 0} aria-label={`Fewer cases for ${p.name}`} className="grid h-8 w-8 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"><Minus className="h-4 w-4" /></button>
                    <span role="spinbutton" aria-label={`Cases for ${p.name}`} aria-valuemin={0} aria-valuenow={n} className="min-w-[2.25rem] text-center text-[15px] font-semibold text-white tabular">{n}</span>
                    <button type="button" onClick={() => step(p.id, 1)} disabled={total >= waiting} aria-label={`More cases for ${p.name}`} className="grid h-8 w-8 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"><Plus className="h-4 w-4" /></button>
                  </div>
                </li>
              );
            })}
          </ul>

          <label className="flex cursor-pointer items-center gap-3 text-sm text-slate-200">
            <input type="checkbox" checked={high} onChange={(e) => setHigh(e.target.checked)} className="h-4 w-4 accent-[#0A84FF]" />
            Include high-profile cases (normally you keep those)
          </label>

          <p className="rounded-xl bg-white/[.04] px-3.5 py-2.5 text-[13px] text-slate-300" aria-live="polite">
            {!waiting ? 'Nothing to hand out.' : !total ? 'Press plus next to a name, or split them evenly.'
              : `${total} of ${waiting} will go out. ${waiting - total === 0 ? 'None stay unassigned.' : `${waiting - total} stay unassigned.`} The most urgent go first.`}
          </p>
        </>
      )}
    </Modal>
  );
}
