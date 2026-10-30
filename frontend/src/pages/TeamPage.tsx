import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, CheckCircle2, ShieldCheck, Users } from 'lucide-react';
import { fetchTeam, unblockUser } from '../api/client';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton, Textarea, useToast } from '../components/ui/kit';
import { UsersPanel } from '../components/UsersPanel';
import { RequestsPanel } from '../components/RequestsPanel';
import { fetchCaseRequests } from '../api/client';
import { cn, parseServerDate } from '../lib/format';
import { useCurrentUser } from '../lib/user';
import { TeamMember } from '../types';

function StrikeMeter({ m }: { m: TeamMember }) {
  const pct = Math.min(100, (m.strikes / m.block_at) * 100);
  return (
    <div className="w-full max-w-xs">
      <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Strikes</span><span className="font-semibold text-white tabular">{m.strikes} / {m.block_at}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`${m.name} strikes`} aria-valuenow={m.strikes} aria-valuemax={m.block_at}>
        <div className={cn('h-full rounded-full transition-all', m.is_blocked ? 'bg-rose-400' : m.strikes >= m.notify_at ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Unblock({ m }: { m: TeamMember }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const unblock = useMutation({
    mutationFn: () => unblockUser(m.id, note.trim() || undefined),
    onSuccess: () => { toast('success', `${m.name} is unblocked and their strikes are cleared.`); setAsking(false); ['team', 'notifications', 'dashboardSummary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => toast('error', e.message),
  });
  if (!asking) return <Button size="sm" variant="primary" onClick={() => setAsking(true)}>Unblock</Button>;
  return (
    <div className="flex w-full flex-col gap-2 sm:w-80">
      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Note for unblocking ${m.name}`} placeholder="Optional note. Their strikes are cleared." />
      <div className="flex gap-2"><Button size="sm" variant="primary" loading={unblock.isPending} onClick={() => unblock.mutate()}>Unblock {m.name.split(' ')[0]}</Button><Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button></div>
    </div>
  );
}

/** The investigators: how many strikes each has, who is blocked, and the cases behind every strike. */
export function TeamPage() {
  const navigate = useNavigate();
  const { isManager } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const tab = (['strikes', 'users', 'requests'].includes(params.get('tab') ?? '') ? params.get('tab') : 'strikes') as 'strikes' | 'users' | 'requests';
  const setTab = (t: 'strikes' | 'users' | 'requests') => setParams(t === 'strikes' ? {} : { tab: t }, { replace: true });
  const waiting = useQuery({ queryKey: ['caseRequests', 'open'], queryFn: () => fetchCaseRequests('OPEN'), refetchInterval: 20_000, enabled: isManager, retry: 0 });
  const team = useQuery({ queryKey: ['team'], queryFn: fetchTeam, refetchInterval: 20_000, enabled: isManager });

  if (!isManager) return <Card><EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Managers only" hint="Only managers see the team and unblock accounts." /></Card>;
  return (
    <>
      <PageHeader title="Team" subtitle="Manage everyone who signs in, and keep an eye on strikes. An investigator gets a strike when the AI reviewer overturns their decision. You are alerted at each set of strikes, and an account is blocked at the limit until you unblock it." />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'strikes', label: 'Strikes' }, { value: 'requests', label: 'Case requests', count: waiting.data?.length ?? 0 }, { value: 'users', label: 'All users' }]} />
      {tab === 'requests' ? <RequestsPanel /> : tab === 'users' ? <UsersPanel /> : team.isError ? <ErrorState message="Couldn't load the team." onRetry={() => team.refetch()} /> : team.isLoading ? <Skeleton className="h-64 rounded-2xl" /> : !team.data?.length ? (
        <Card><EmptyState icon={<Users className="h-6 w-6" />} title="No investigators" /></Card>
      ) : (
        <ul className="space-y-4" aria-label="Investigators">
          {team.data.map((m) => (
            <li key={m.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[17px] font-semibold text-white">{m.name}</h2>
                      {m.is_blocked ? <Badge tone="danger" dot>Blocked</Badge> : m.strikes >= m.notify_at ? <Badge tone="warn" dot>Needs attention</Badge> : <Badge tone="success" dot>Good standing</Badge>}
                    </div>
                    <p className="text-[13px] text-muted">{m.open_cases} open case{m.open_cases === 1 ? '' : 's'}{m.blocked_reason && ` · ${m.blocked_reason}`}</p>
                    <StrikeMeter m={m} />
                  </div>
                  {m.is_blocked && <div className="flex items-start gap-3"><Ban aria-hidden className="mt-1 h-5 w-5 text-rose-300" /><Unblock m={m} /></div>}
                </div>
                {m.history.length > 0 && (
                  <details className="mt-4">
                    <summary className="cursor-pointer text-[13px] font-medium text-brand-soft">Strike history ({m.history.length})</summary>
                    <ul className="mt-2 divide-y divide-line" aria-label={`${m.name} strike history`}>
                      {m.history.map((h, i) => (
                        <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
                          <span className={cn(h.voided && 'text-muted line-through')}>
                            {h.dispute_id ? <button onClick={() => navigate(`/investigate/${h.dispute_id}`)} className="font-mono text-white hover:underline">{h.dispute_id}</button> : 'Strike'} <span className="text-muted">{h.reason}</span>
                          </span>
                          <span className="flex items-center gap-2 text-xs text-muted">
                            {h.voided && <Badge tone="success"><CheckCircle2 className="h-3 w-3" />Removed</Badge>}
                            {parseServerDate(h.created_at).toLocaleDateString()}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
