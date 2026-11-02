import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FolderOpen, Bot, Gavel, Hourglass, UserPlus, RefreshCw, ShieldAlert, ShieldCheck, Star, XCircle } from 'lucide-react';
import { fetchCaseRequests, fetchDashboardSummary, fetchDisputes, fetchMe, fetchNotifications, requestCases } from '../api/client';
import { Badge, Button, Card, CountUp, EmptyState, ErrorState, Meter, PageHeader, SectionTitle, Skeleton, Textarea, useToast } from '../components/ui/kit';
import { DistributeDialog } from '../components/DistributeDialog';
import { AssignSelect } from '../components/AssignSelect';
import { DecideBy, ScoreRing } from '../components/DisputeBits';
import { cn, money, OPEN_STATUSES, reasonLabel, timeAgo, Tone } from '../lib/format';
import { useNow } from '../lib/hooks';
import { firstName, useCurrentUser } from '../lib/user';

const REFRESH_MS = 30_000;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const KPI_STYLES: Record<string, string> = {
  brand: 'text-brand-soft bg-brand/15', warn: 'text-amber-300 bg-amber-400/10',
  danger: 'text-rose-300 bg-rose-400/10', success: 'text-emerald-300 bg-emerald-400/10',
};

function Kpi({ label, value, hint, icon, tone, onClick }: {
  label: string; value: number; hint: string; icon: React.ReactNode; tone: keyof typeof KPI_STYLES; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="group text-left">
      <Card className="h-full p-5 transition duration-200 group-hover:-translate-y-0.5 group-hover:border-brand/40 group-hover:bg-raised">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted">{label}</span>
          <span className={cn('grid h-9 w-9 place-items-center rounded-xl', KPI_STYLES[tone])}>{icon}</span>
        </div>
        <div className="mt-3 flex items-end justify-between">
          <span className="text-4xl font-semibold tracking-tight text-white tabular"><CountUp value={value} /></span>
          <ArrowRight className="mb-1.5 h-4 w-4 text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
        </div>
        <p className="mt-1 text-[13px] text-muted">{hint}</p>
      </Card>
    </button>
  );
}

export function OverviewPage() {
  const navigate = useNavigate();
  const now = useNow(10_000);
  const { user, isManager } = useCurrentUser();
  const toast = useToast();
  const qc = useQueryClient();
  const [distributing, setDistributing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');

  const summary = useQuery({ queryKey: ['dashboardSummary', user.name], queryFn: () => fetchDashboardSummary(user.name), refetchInterval: REFRESH_MS });
  const urgent = useQuery({
    queryKey: ['urgentDisputes'],
    queryFn: () => fetchDisputes({ sort_by: 'priority_score', sort_order: 'desc' }),
    refetchInterval: REFRESH_MS,
  });

  const me = useQuery({ queryKey: ['me', user.id], queryFn: fetchMe, refetchInterval: REFRESH_MS, enabled: !isManager, retry: 0 });
  const strikes = me.data?.strikes ?? user.strikes;
  const myRequests = useQuery({ queryKey: ['caseRequests', 'mine'], queryFn: () => fetchCaseRequests(), enabled: !isManager, retry: 0 });
  const ask = useMutation({
    mutationFn: () => requestCases(note.trim() || undefined),
    onSuccess: () => { toast('success', 'Your manager has been alerted.'); setAsking(false); setNote(''); qc.invalidateQueries({ queryKey: ['caseRequests'] }); },
    onError: (e: Error) => toast('error', e.message),
  });
  const unowned = useQuery({ queryKey: ['disputes', 'unassigned'], queryFn: () => fetchDisputes({ unassigned: true, sort_by: 'priority_score', sort_order: 'desc' }), refetchInterval: REFRESH_MS, enabled: isManager, retry: 0 });
  const needOwner = (unowned.data ?? []).filter((d) => OPEN_STATUSES.includes(d.status) && !d.assigned_to).slice(0, 5);
  const alerts = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: REFRESH_MS, enabled: isManager, retry: 0 });
  const data = summary.data;
  // A manager's list is the high-profile cases, since those are theirs.
  const top = (urgent.data ?? []).filter((d) => OPEN_STATUSES.includes(d.status) && (!isManager || d.is_high_profile)).slice(0, 5);

  const refresh = () => { summary.refetch(); urgent.refetch(); };

  if (summary.isError) return <ErrorState message="Couldn't load the dashboard." onRetry={refresh} />;

  const totalReasons = data?.disputes_by_reason.reduce((a, r) => a + r.count, 0) || 1;
  const prio = data?.priority_distribution;
  const prioTotal = prio ? prio.high + prio.medium + prio.low || 1 : 1;
  const prioRows: { label: string; value: number; tone: Tone; bar: string }[] = prio ? [
    { label: 'Urgent (70+)', value: prio.high, tone: 'danger', bar: 'bg-rose-400' },
    { label: 'Medium (40–69)', value: prio.medium, tone: 'warn', bar: 'bg-amber-400' },
    { label: 'Low (under 40)', value: prio.low, tone: 'success', bar: 'bg-emerald-400' },
  ] : [];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user.name)}`}
        subtitle="Dispute Overview. Here's what needs your attention first."
        actions={
          <>
            <span className="hidden text-[13px] text-muted sm:block">
              {summary.dataUpdatedAt ? `Updated ${timeAgo(summary.dataUpdatedAt, now)}` : 'Loading…'}
            </span>
            <Button size="sm" onClick={refresh} aria-label="Refresh data">
              <RefreshCw className={cn('h-4 w-4', (summary.isFetching || urgent.isFetching) && 'animate-spin')} /> Refresh
            </Button>
            {isManager && <Button size="sm" onClick={() => setDistributing(true)}>Distribute cases</Button>}
            <Button size="sm" onClick={() => navigate('/queue')}>{isManager ? 'View all cases' : 'View your cases'}</Button>
            <Button size="sm" variant="primary" onClick={() => navigate('/investigate/DEMO-DSP-1042')}>Open demo case</Button>
          </>
        }
      />

      {isManager && needOwner.length > 0 && (
        <Card className="border-amber-400/30 p-5" aria-label="Nobody owns these yet">
          <SectionTitle
            title="Nobody owns these yet"
            hint="Most urgent first. The score climbs every day. If you don't assign a case within a day, or it has 3 days or less left, it goes to an investigator at random."
            action={<Button size="sm" variant="ghost" onClick={() => navigate('/queue?view=unassigned')}>All {data?.unassigned_count ?? needOwner.length} <ArrowRight className="h-3.5 w-3.5" /></Button>}
          />
          <ul className="-mx-2 divide-y divide-line">
            {needOwner.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-4 px-2 py-3">
                <button onClick={() => navigate(`/investigate/${d.id}`)} className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <ScoreRing score={d.priority_score} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-medium text-white">{d.id}</span><span className="text-[13px] text-muted">{reasonLabel(d.reason)}</span></div>
                    <p className="mt-0.5 truncate text-sm text-slate-300">{money(d.amount, d.currency)} · {d.buyer_claim ?? 'No buyer statement recorded.'}</p>
                  </div>
                  <DecideBy status={d.status} due={d.response_due_date} outcome={d.outcome} />
                </button>
                <AssignSelect disputeId={d.id} assignedTo={d.assigned_to} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isManager ? (
        !data ? (
          <div className="grid gap-4 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[148px] rounded-2xl" />)}</div>
        ) : (() => {
          const open = alerts.data?.open_alerts ?? [];
          const count = (k: string) => open.filter((a) => a.kind === k).length;
          const flags = count('FLAG');
          const overturns = count('AI_OVERTURN');
          const rest = open.length - flags - overturns;
          const todo = [
            { label: 'To assign', value: data.unassigned_count, hint: data.high_profile_count ? `${data.high_profile_count} high profile` : 'Cases nobody owns yet', tone: 'warn' as const, icon: <UserPlus className="h-5 w-5" />, to: '/queue?view=unassigned' },
            { label: 'Needs you', value: open.length, hint: open.length ? [overturns && `${overturns} AI overturn${overturns === 1 ? '' : 's'}`, flags && `${flags} conflict${flags === 1 ? '' : 's'}`, rest > 0 && `${rest} other`].filter(Boolean).join(' · ') : 'Nothing is waiting on you', tone: 'danger' as const, icon: <ShieldCheck className="h-5 w-5" />, to: '/team' },
            { label: 'Conflicts to settle', value: flags, hint: flags ? 'An investigator disagrees with the AI. Settle in 1 to 2 days' : 'No investigator is disputing the AI', tone: 'brand' as const, icon: <Bot className="h-5 w-5" />, to: '/manager?tab=flags' },
          ];
          const stats = [
            { label: 'High profile', value: data.high_profile_count, to: '/queue?view=high' },
            { label: 'Decide within 48 hours', value: data.approaching_deadline_count, to: '/queue?view=due' },
            { label: 'Waiting on replies', value: data.waiting_on_parties_count, to: '/queue?view=waiting' },
            { label: 'Ready to decide', value: data.awaiting_review_count, to: '/queue?view=ready' },
          ];
          return (
            <>
              <section aria-label="What needs you" className="grid gap-4 sm:grid-cols-3">
                {todo.map((t) => (
                  <button key={t.label} onClick={() => navigate(t.to)} className="group text-left">
                    <Card className={cn('flex h-full flex-col justify-between p-6 transition duration-200 group-hover:-translate-y-0.5 group-hover:bg-raised', t.value > 0 ? 'border-white/20' : '')}>
                      <div className="flex items-center gap-2.5 text-[13px] font-medium text-muted">
                        <span className={cn('grid h-8 w-8 place-items-center rounded-full', KPI_STYLES[t.tone])}>{t.icon}</span>{t.label}
                      </div>
                      <div className="mt-5">
                        <span className={cn('text-5xl font-semibold tracking-tight tabular', t.value > 0 ? 'text-white' : 'text-muted')}><CountUp value={t.value} /></span>
                        <p className="mt-1.5 text-[13px] text-muted">{t.hint}</p>
                      </div>
                    </Card>
                  </button>
                ))}
              </section>
              <Card className="p-2" aria-label="Across the team">
                <dl className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
                  {stats.map((st) => (
                    <button key={st.label} onClick={() => navigate(st.to)} className="rounded-xl px-5 py-3 text-left transition hover:bg-white/[.04]">
                      <dt className="text-xs text-muted">{st.label}</dt>
                      <dd className="mt-0.5 text-2xl font-semibold tabular text-white"><CountUp value={st.value} /></dd>
                    </button>
                  ))}
                </dl>
              </Card>
            </>
          );
        })()
      ) : (
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {!data ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)
          ) : (
            <>
              <Kpi label="Your cases" value={data.my_cases_count} hint="Open cases you are working" tone="brand" icon={<FolderOpen className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue?view=mine')} />
              <Kpi label="Decide within 48 hours" value={data.approaching_deadline_count} hint="Target date is close or passed" tone="warn" icon={<Clock className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue?view=due')} />
              <Kpi label="Waiting on replies" value={data.waiting_on_parties_count} hint="Seller or buyer owes us evidence" tone="danger" icon={<Hourglass className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue?view=waiting')} />
              <Kpi label="Ready to decide" value={data.awaiting_review_count} hint="Both sides have answered, or time is up. Decide now" tone="success" icon={<Gavel className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue?view=ready')} />
            </>
          )}
        </section>
      )}

      {!isManager && data && data.my_cases_count === 0 && (() => {
        const pending = myRequests.data?.find((r) => r.status === 'OPEN');
        const last = myRequests.data?.find((r) => r.status === 'DECLINED');
        return (
          <Card className="p-5" aria-label="You have no cases">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-white">You have no cases right now</h2>
                <p className="mt-0.5 max-w-xl text-[13px] text-muted">
                  {pending ? 'You asked for more. Your manager has been alerted and will give you some.' : 'Your manager hands out cases. Ask for more and they will be alerted straight away.'}
                  {!pending && last?.resolution_note && <> Last time: <span className="text-slate-300">{last.resolved_by}: {last.resolution_note}</span></>}
                </p>
              </div>
              {pending ? <Badge tone="info" dot>Asked, waiting for your manager</Badge> : !asking && <Button variant="primary" onClick={() => setAsking(true)}>Ask for cases</Button>}
            </div>
            {asking && !pending && (
              <div className="mt-4 flex flex-col gap-2 sm:max-w-lg animate-fade-in">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Message to your manager" placeholder="Optional. For example: I can take the harder ones." />
                <div className="flex gap-2"><Button size="sm" variant="primary" loading={ask.isPending} onClick={() => ask.mutate()}>Send request</Button><Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button></div>
              </div>
            )}
          </Card>
        );
      })()}

      {!isManager && (
        <Card className="p-5" aria-label="Your strikes">
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-white">Your strikes</h2>
              <p className="mt-0.5 max-w-xl text-[13px] text-muted">
                You get a strike when the AI reviewer overturns one of your decisions. Your manager is alerted every {user.notify_at} strikes, and your account is blocked at {user.block_at}.
                {strikes > 0 && ' If you think the AI got a case wrong, flag it on that case.'}
              </p>
            </div>
            <div className="w-full sm:w-64">
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className={cn('text-3xl font-semibold tabular', strikes > 0 ? 'text-rose-400' : 'text-white')}>{strikes}</span>
                <span className="text-sm text-muted tabular">of {user.block_at}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Your strikes" aria-valuenow={strikes} aria-valuemax={user.block_at}>
                <div className={cn('h-full rounded-full transition-all duration-700', strikes > 0 ? 'bg-rose-500' : 'bg-emerald-400')} style={{ width: `${Math.min(100, (strikes / user.block_at) * 100)}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-muted">{strikes === 0 ? 'No strikes. Keep it up.' : strikes >= user.block_at - 2 ? `${user.block_at - strikes} more and your account is blocked.` : `${user.block_at - strikes} until your account is blocked.`}</p>
            </div>
          </div>
        </Card>
      )}

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <SectionTitle
            title={isManager ? 'High-profile cases' : 'Needs attention now'}
            hint={isManager ? 'Cases for big amounts. These are yours to handle' : 'Open disputes with the highest priority score, so you can decide what to chase first'}
            action={<Button size="sm" variant="ghost" onClick={() => navigate(isManager ? '/queue?view=high' : '/queue')}>View all <ArrowRight className="h-3.5 w-3.5" /></Button>}
          />
          {urgent.isLoading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : top.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="You're all caught up" hint="No open disputes need action right now." />
          ) : (
            <ul className="-mx-2 divide-y divide-line">
              {top.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => navigate(`/investigate/${d.id}`)}
                    className="flex w-full items-center gap-4 rounded-xl px-2 py-3.5 text-left transition hover:bg-white/[.03]"
                  >
                    <ScoreRing score={d.priority_score} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[13px] font-medium text-white">{d.id}</span>
                        <span className="truncate text-[13px] text-muted">{reasonLabel(d.reason)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-300">{d.buyer_claim ?? 'No buyer statement recorded.'}</p>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="text-sm font-medium text-white tabular">{money(d.amount, d.currency)}</div>
                      <div className="mt-1"><DecideBy status={d.status} due={d.response_due_date} outcome={d.outcome} /></div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <SectionTitle title="How urgent" hint="Open disputes by priority score" />
          {!data ? <Skeleton className="h-40" /> : (
            <>
              <div className="flex h-3 gap-1 overflow-hidden rounded-full">
                {prioRows.map((r) => (
                  <div key={r.label} className={cn('transition-all duration-700', r.bar)} style={{ width: `${(r.value / prioTotal) * 100}%` }} title={`${r.label}: ${r.value}`} />
                ))}
              </div>
              <ul className="mt-5 space-y-3">
                {prioRows.map((r) => (
                  <li key={r.label}>
                    <button onClick={() => navigate(r.tone === 'danger' ? '/queue?view=urgent' : '/queue')} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition hover:bg-white/5">
                      <span className="flex items-center gap-2.5 text-slate-300"><span className={cn('h-2.5 w-2.5 rounded-full', r.bar)} />{r.label}</span>
                      <span className="font-semibold text-white tabular">{r.value}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6">
          <SectionTitle title="Disputes by reason" hint={data ? `${data.total_open_disputes} open` : undefined} />
          {!data ? <Skeleton className="h-40" /> : (
            <ul className="space-y-4">
              {data.disputes_by_reason.map((r) => (
                <li key={r.reason}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-slate-300">{reasonLabel(r.reason)}</span>
                    <span className="font-medium text-white tabular">{r.count}</span>
                  </div>
                  <Meter value={(r.count / totalReasons) * 100} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-6 lg:col-span-2">
          <SectionTitle
            title="Recent activity"
            hint="Latest events from the activity log"
            action={<Button size="sm" variant="ghost" onClick={() => navigate('/audit')}>See all <ArrowRight className="h-3.5 w-3.5" /></Button>}
          />
          {data && (
            <div className="mb-5 grid grid-cols-3 gap-3">
              {([
                ['Done', data.action_outcomes_summary.success, 'text-emerald-300', <CheckCircle2 key="a" className="h-4 w-4" />],
                ['Failed', data.action_outcomes_summary.failed, 'text-rose-300', <XCircle key="b" className="h-4 w-4" />],
                ['Awaiting approval', data.action_outcomes_summary.pending, 'text-sky-300', <AlertTriangle key="c" className="h-4 w-4" />],
              ] as const).map(([label, n, color, icon]) => (
                <div key={label} className="rounded-xl border border-line bg-raised/60 p-3">
                  <div className={cn('flex items-center gap-1.5 text-xs font-medium', color)}>{icon}{label}</div>
                  <div className="mt-1 text-2xl font-semibold text-white tabular">{n}</div>
                </div>
              ))}
            </div>
          )}
          {!data ? <Skeleton className="h-32" /> : data.recent_activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="space-y-1">
              {data.recent_activity.map((evt) => (
                <li key={evt.id}>
                  <button
                    onClick={() => evt.dispute_id && navigate(`/investigate/${evt.dispute_id}`)}
                    className="flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-white/[.03]"
                  >
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', evt.status === 'FAILED' ? 'bg-rose-400' : evt.status === 'SUCCESS' ? 'bg-emerald-400' : 'bg-sky-400')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-white">{String(evt.action).replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase())}</span>
                        {evt.dispute_id && <span className="font-mono text-xs text-muted">{evt.dispute_id}</span>}
                      </div>
                      <p className="truncate text-[13px] text-muted">{evt.result_summary}</p>
                    </div>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(evt.created_at, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
      {isManager && <DistributeDialog open={distributing} onClose={() => setDistributing(false)} />}
    </>
  );
}
