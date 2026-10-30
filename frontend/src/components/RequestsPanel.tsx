import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Inbox } from 'lucide-react';
import { declineCaseRequest, fetchCaseRequests } from '../api/client';
import { CaseRequest } from '../types';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton, Textarea, useToast } from './ui/kit';
import { DistributeDialog } from './DistributeDialog';
import { parseServerDate, timeAgo } from '../lib/format';
import { useNow } from '../lib/hooks';

function Row({ r, onGive }: { r: CaseRequest; onGive: (r: CaseRequest) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const decline = useMutation({
    mutationFn: () => declineCaseRequest(r.id, note.trim()),
    onSuccess: () => { toast('info', `${r.name} was told.`); setDeclining(false); ['caseRequests', 'notifications', 'dashboardSummary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => toast('error', e.message),
  });
  return (
    <li className="py-4" aria-label={`Request from ${r.name}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-white">{r.name}</span>
            <Badge tone={r.status === 'OPEN' ? 'warn' : r.status === 'FULFILLED' ? 'success' : 'neutral'}>{r.status === 'OPEN' ? 'Has no cases' : r.status === 'FULFILLED' ? 'Given cases' : 'Declined'}</Badge>
            <span className="text-xs text-muted" title={parseServerDate(r.created_at).toLocaleString()}>asked {timeAgo(r.created_at, now)}</span>
          </div>
          {r.note && <p className="mt-1 text-[13px] text-slate-300">“{r.note}”</p>}
          {r.status === 'FULFILLED' && <p className="mt-1 text-[13px] text-muted">{r.resolved_by} gave them {r.cases_given} case{r.cases_given === 1 ? '' : 's'}.</p>}
          {r.status === 'DECLINED' && <p className="mt-1 text-[13px] text-muted">{r.resolved_by}: {r.resolution_note}</p>}
        </div>
        {r.status === 'OPEN' && !declining && (
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={() => onGive(r)}>Give cases</Button>
            <Button size="sm" variant="ghost" onClick={() => setDeclining(true)}>Decline</Button>
          </div>
        )}
      </div>
      {declining && (
        <div className="mt-3 flex w-full flex-col gap-2 sm:w-96 animate-fade-in">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Why decline ${r.name}`} placeholder="Tell them why, or when to ask again." />
          <div className="flex gap-2"><Button size="sm" variant="primary" loading={decline.isPending} disabled={note.trim().length < 5} onClick={() => decline.mutate()}>Decline</Button><Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>Cancel</Button></div>
        </div>
      )}
    </li>
  );
}

/** Investigators who have run out of cases and asked for more. Giving them cases closes the request. */
export function RequestsPanel() {
  const requests = useQuery({ queryKey: ['caseRequests', 'all'], queryFn: () => fetchCaseRequests(), refetchInterval: 20_000 });
  const [giving, setGiving] = useState<CaseRequest | null>(null);
  const open = requests.data?.filter((r) => r.status === 'OPEN') ?? [];
  const past = requests.data?.filter((r) => r.status !== 'OPEN') ?? [];
  return (
    <>
      {requests.isError ? <ErrorState message="Couldn't load the requests." onRetry={() => requests.refetch()} /> : requests.isLoading ? <Skeleton className="h-40 rounded-2xl" /> : !requests.data?.length ? (
        <Card><EmptyState icon={<Inbox className="h-6 w-6" />} title="No requests" hint="When an investigator has no cases left, they can ask you for more. You'll see it here and as an alert." /></Card>
      ) : (
        <Card className="p-6">
          {open.length === 0 && <p className="flex items-center gap-2 pb-3 text-sm text-muted"><CheckCircle2 className="h-4 w-4 text-emerald-400" />Nobody is waiting for cases.</p>}
          <ul className="divide-y divide-line" aria-label="Case requests">
            {[...open, ...past.slice(0, 10)].map((r) => <Row key={r.id} r={r} onGive={setGiving} />)}
          </ul>
        </Card>
      )}
      <DistributeDialog open={!!giving} onClose={() => setGiving(null)} preselect={giving?.user_id} perPerson={5} />
    </>
  );
}
