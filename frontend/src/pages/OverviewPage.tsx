import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Gavel, Hourglass, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { fetchDashboardSummary, fetchDisputes } from '../api/client';
import { Badge, Button, Card, CountUp, EmptyState, ErrorState, Meter, PageHeader, SectionTitle, Skeleton } from '../components/ui/kit';
import { DecideBy, ScoreRing } from '../components/DisputeBits';
import { cn, money, OPEN_STATUSES, reasonLabel, timeAgo, Tone } from '../lib/format';
import { useNow } from '../lib/hooks';
import { CURRENT_USER, firstName } from '../lib/user';

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

  const summary = useQuery({ queryKey: ['dashboardSummary'], queryFn: fetchDashboardSummary, refetchInterval: REFRESH_MS });
  const urgent = useQuery({
    queryKey: ['urgentDisputes'],
    queryFn: () => fetchDisputes({ sort_by: 'priority_score', sort_order: 'desc' }),
    refetchInterval: REFRESH_MS,
  });

  const data = summary.data;
  const top = (urgent.data ?? []).filter((d) => OPEN_STATUSES.includes(d.status)).slice(0, 5);

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
        title={`${greeting()}, ${firstName(CURRENT_USER.name)}`}
        subtitle="Dispute Overview. Here's what needs your attention first."
        actions={
          <>
            <span className="hidden text-[13px] text-muted sm:block">
              {summary.dataUpdatedAt ? `Updated ${timeAgo(summary.dataUpdatedAt, now)}` : 'Loading…'}
            </span>
            <Button size="sm" onClick={refresh} aria-label="Refresh data">
              <RefreshCw className={cn('h-4 w-4', (summary.isFetching || urgent.isFetching) && 'animate-spin')} /> Refresh
            </Button>
            <Button size="sm" variant="primary" onClick={() => navigate('/investigate/DEMO-DSP-1042')}>Open demo case</Button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)
        ) : (
          <>
            <Kpi label="Open disputes" value={data.total_open_disputes} hint={`${data.new_cases_count} new, nobody asked yet`} tone="brand" icon={<ShieldAlert className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue')} />
            <Kpi label="Decide within 48 hours" value={data.approaching_deadline_count} hint="Target date is close or passed" tone="warn" icon={<Clock className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue?view=due')} />
            <Kpi label="Waiting on replies" value={data.waiting_on_parties_count} hint="Seller or buyer owes us evidence" tone="danger" icon={<Hourglass className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue?view=waiting')} />
            <Kpi label="Ready to decide" value={data.awaiting_review_count} hint="The evidence is in" tone="success" icon={<Gavel className="h-[18px] w-[18px]" />} onClick={() => navigate('/queue?view=ready')} />
          </>
        )}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <SectionTitle
            title="Needs attention now"
            hint="Open disputes with the highest priority score, so you can decide what to chase first"
            action={<Button size="sm" variant="ghost" onClick={() => navigate('/queue')}>View all <ArrowRight className="h-3.5 w-3.5" /></Button>}
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
    </>
  );
}
