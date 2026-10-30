import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ChevronRight, Eye, FilterX, Gavel, HandHelping, Inbox, RefreshCw } from 'lucide-react';
import { assignDispute, fetchDisputeDetail, fetchDisputes } from '../api/client';
import { DisputeSummary } from '../types';
import { Badge, Button, Card, Drawer, EmptyState, ErrorState, KeyValue, Meter, PageHeader, SearchInput, Segmented, Select, Skeleton } from '../components/ui/kit';
import { EvidenceBadge, StatusBadge } from '../components/ui/StatusBadges';
import { DecideBy, Countdown, ScoreRing } from '../components/DisputeBits';
import { cn, isUrgent, money, OPEN_STATUSES, reasonLabel, timeLeft, WAITING_STATUSES } from '../lib/format';
import { useDebounced, useNow } from '../lib/hooks';
import { useCurrentUser } from '../lib/user';

type View = 'all' | 'mine' | 'new' | 'waiting' | 'ready' | 'review' | 'urgent' | 'due';
const VIEWS: View[] = ['all', 'mine', 'new', 'waiting', 'ready', 'review', 'urgent', 'due'];
const SORTS = {
  priority: { by: 'priority_score', order: 'desc', label: 'Most urgent' },
  amount: { by: 'amount', order: 'desc', label: 'Highest amount' },
  deadline: { by: 'response_due_date', order: 'asc', label: 'Soonest deadline' },
} as const;
type SortKey = keyof typeof SORTS;

const REASON_OPTIONS = [
  'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  'UNAUTHORISED', 'CANCELLED_OR_RETURNED', 'DUPLICATE_TRANSACTION',
];

function matchesView(d: DisputeSummary, view: View, now: number, me: string) {
  switch (view) {
    case 'mine': return d.assigned_to === me; // open and finished, so a case you decided doesn't vanish
    case 'review': return d.status === 'PENDING_ADMIN_REVIEW';
    case 'new': return d.status === 'OPEN';
    case 'waiting': return WAITING_STATUSES.includes(d.status);
    case 'ready': return d.status === 'UNDER_REVIEW';
    case 'urgent': return OPEN_STATUSES.includes(d.status) && isUrgent(d.priority_score);
    case 'due': { const h = timeLeft(d.response_due_date, now).hours; return OPEN_STATUSES.includes(d.status) && h !== null && h <= 48; }
    default: return true;
  }
}

export function DisputeQueuePage() {
  const navigate = useNavigate();
  const now = useNow();
  const { user, isAdmin } = useCurrentUser();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();

  const initialView: View = VIEWS.includes(params.get('view') as View) ? (params.get('view') as View) : params.get('priority_level') === 'high' ? 'urgent' : 'all';

  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState(params.get('q') || params.get('search') || '');
  const [reason, setReason] = useState(params.get('reason') || 'ALL');
  const [status, setStatus] = useState(params.get('status') || 'ALL');
  const [sort, setSort] = useState<SortKey>((params.get('sort') as SortKey) in SORTS ? (params.get('sort') as SortKey) : 'priority');
  const openId = params.get('open');
  const dq = useDebounced(search, 250);

  // Keep the URL shareable.
  useEffect(() => {
    const next = new URLSearchParams();
    if (view !== 'all') next.set('view', view);
    if (dq) next.set('q', dq);
    if (reason !== 'ALL') next.set('reason', reason);
    if (status !== 'ALL') next.set('status', status);
    if (sort !== 'priority') next.set('sort', sort);
    if (openId) next.set('open', openId);
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dq, reason, status, sort, openId]);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['disputes', dq, reason, status, sort],
    queryFn: () => fetchDisputes({ search: dq, reason, status, sort_by: SORTS[sort].by, sort_order: SORTS[sort].order }),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const counts = useMemo(() => {
    const list = data ?? [];
    const c = (v: View) => list.filter((d) => matchesView(d, v, now, user.name)).length;
    return { all: list.length, mine: c('mine'), new: c('new'), waiting: c('waiting'), ready: c('ready'), review: c('review'), urgent: c('urgent'), due: c('due') };
  }, [data, now, user.name]);

  const rows = useMemo(() => (data ?? []).filter((d) => matchesView(d, view, now, user.name)), [data, view, now, user.name]);
  const take = useMutation({
    mutationFn: (id: string) => assignDispute(id, user.name),
    onSuccess: () => ['disputes', 'urgentDisputes', 'dashboardSummary', 'disputeDetail'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })),
  });
  const filtered = view !== 'all' || !!dq || reason !== 'ALL' || status !== 'ALL';
  const clearAll = () => { setView('all'); setSearch(''); setReason('ALL'); setStatus('ALL'); setSort('priority'); };

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    id ? next.set('open', id) : next.delete('open');
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="All Disputes"
        subtitle="Most urgent first. Click a dispute to investigate it, or use the eye for a quick look."
        actions={
          <Button size="sm" onClick={() => refetch()} aria-label="Refresh disputes">
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} /> Refresh
          </Button>
        }
      />

      <div className="space-y-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'mine', label: 'Your cases', count: counts.mine },
            { value: 'new', label: 'New', count: counts.new },
            { value: 'waiting', label: 'Waiting on replies', count: counts.waiting },
            { value: 'ready', label: 'Ready to decide', count: counts.ready },
            ...(isAdmin ? [{ value: 'review' as View, label: 'With admin', count: counts.review }] : []),
            { value: 'urgent', label: 'Urgent', count: counts.urgent },
            { value: 'due', label: 'Due soon', count: counts.due },
          ]}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_200px_200px_190px_auto]">
          <SearchInput value={search} onChange={setSearch} placeholder="Search case, buyer, seller or transaction" />
          <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Filter by reason">
            <option value="ALL">All reasons</option>
            {REASON_OPTIONS.map((r) => <option key={r} value={r}>{reasonLabel(r)}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="ALL">All statuses</option>
            <option value="OPEN">New</option>
            <option value="WAITING_FOR_SELLER_RESPONSE">Waiting on seller</option>
            <option value="WAITING_FOR_BUYER_RESPONSE">Waiting on buyer</option>
            <option value="WAITING_FOR_BOTH_RESPONSES">Waiting on both</option>
            <option value="UNDER_REVIEW">Ready to decide</option>
            <option value="PENDING_ADMIN_REVIEW">With admin</option>
            <option value="RESOLVED">Resolved</option>
            <option value="CLOSED">Closed</option>
          </Select>
          <div className="relative">
            <ArrowDownUp className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-full pl-10" aria-label="Sort disputes">
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </div>
          {filtered && (
            <Button variant="ghost" onClick={clearAll}><FilterX className="h-4 w-4" /> Clear</Button>
          )}
        </div>
      </div>

      {view === 'ready' && (
        <div role="note" className="flex items-start gap-3 rounded-2xl border border-brand/30 bg-brand/10 p-4 text-sm text-slate-100">
          <Gavel aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand-soft" />
          <p><span className="font-medium text-white">Time to decide.</span> Every request is answered, or its reply deadline has passed. Open a case, check what arrived and what is missing, then make the call.</p>
        </div>
      )}

      {error ? (
        <ErrorState message="Couldn't load disputes." onRetry={() => refetch()} />
      ) : (
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-px">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[76px] rounded-none" />)}</div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-6 w-6" />}
              title="No disputes match"
              hint="Try a different search or clear the filters."
              action={<Button onClick={clearAll}>Clear filters</Button>}
            />
          ) : (
            <ul className={cn('divide-y divide-line transition-opacity', isFetching && 'opacity-80')}>
              {rows.map((d) => (
                <li key={d.id} className={cn('flex items-center transition hover:bg-white/[.03]', openId === d.id && 'bg-brand/[.06]')}>
                  {/* Clicking a dispute opens it in Investigation. The eye is a quick peek that doesn't leave the list. */}
                  <button
                    onClick={() => navigate(`/investigate/${d.id}`)}
                    className="group flex min-w-0 flex-1 items-center gap-4 px-5 py-4 text-left"
                  >
                    <ScoreRing score={d.priority_score} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono text-[13px] font-semibold text-white">{d.id}</span>
                        <span className="text-[13px] text-muted">{reasonLabel(d.reason)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm text-slate-300">
                        {d.buyer_reference ?? 'Buyer'} <span className="text-muted">vs {d.merchant_reference ?? 'Seller'}</span>
                        {d.buyer_claim && <span className="text-muted"> · “{d.buyer_claim}”</span>}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">{d.assigned_to ? (d.assigned_to === user.name ? 'Yours' : `Owner: ${d.assigned_to}`) : 'Unassigned'}</p>
                    </div>
                    <div className="hidden w-40 flex-col items-start gap-1.5 lg:flex">
                      <StatusBadge status={d.status} />
                      <EvidenceBadge status={d.evidence_status} />
                    </div>
                    <div className="hidden w-36 text-right md:block">
                      <div className="text-sm font-semibold text-white tabular">{money(d.amount, d.currency)}</div>
                      <div className="mt-1 flex justify-end"><DecideBy status={d.status} due={d.response_due_date} outcome={d.outcome} /></div>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-white" />
                  </button>
                  {!d.assigned_to && OPEN_STATUSES.includes(d.status) && !isAdmin && (
                    <Button size="sm" variant="ghost" loading={take.isPending && take.variables === d.id} onClick={() => take.mutate(d.id)} aria-label={`Take case ${d.id}`}>
                      <HandHelping className="h-3.5 w-3.5" />Take
                    </Button>
                  )}
                  <button
                    onClick={() => setOpen(d.id)}
                    aria-label={`Quick view ${d.id}`}
                    title="Quick view"
                    className="mr-4 shrink-0 rounded-lg p-2 text-muted transition hover:bg-white/5 hover:text-white"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {!isLoading && rows.length > 0 && <p className="text-[13px] text-muted">Showing {rows.length} of {counts.all} disputes</p>}

      <PreviewDrawer id={openId} onClose={() => setOpen(null)} onOpenCase={(id) => navigate(`/investigate/${id}`)} />
    </>
  );
}

function PreviewDrawer({ id, onClose, onOpenCase }: { id: string | null; onClose: () => void; onOpenCase: (id: string) => void }) {
  const { data: d, isLoading } = useQuery({
    queryKey: ['disputeDetail', id],
    queryFn: () => fetchDisputeDetail(id!),
    enabled: !!id,
  });

  return (
    <Drawer
      open={!!id}
      onClose={onClose}
      title={
        <div>
          <div className="font-mono text-lg font-semibold text-white">{id}</div>
          {d && <div className="mt-1.5 flex flex-wrap items-center gap-2"><StatusBadge status={d.status} /><Badge>{reasonLabel(d.reason)}</Badge></div>}
        </div>
      }
      footer={<Button variant="primary" className="w-full" onClick={() => id && onOpenCase(id)}>Open full case <ChevronRight className="h-4 w-4" /></Button>}
    >
      {isLoading || !d ? (
        <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      ) : (
        <>
          <div className="flex items-center gap-4 rounded-2xl border border-line bg-raised/60 p-4">
            <ScoreRing score={d.priority_score} size={56} />
            <div className="flex-1">
              <div className="text-2xl font-semibold text-white tabular">{money(d.amount, d.currency)}</div>
              <div className="mt-1"><DecideBy status={d.status} due={d.response_due_date} outcome={d.outcome} /></div>
            </div>
          </div>

          {d.buyer_claim && (
            <blockquote className="rounded-xl border-l-2 border-brand bg-raised/60 px-4 py-3 text-sm italic text-slate-200">“{d.buyer_claim}”</blockquote>
          )}

          <dl className="grid grid-cols-2 gap-4">
            <KeyValue label="Buyer">{d.buyer_reference ?? '—'}</KeyValue>
            <KeyValue label="Seller">{d.merchant_reference ?? '—'}</KeyValue>
            <KeyValue label="Transaction" mono>{d.transaction_id ?? '—'}</KeyValue>
            <KeyValue label="Evidence"><EvidenceBadge status={d.evidence_status} /></KeyValue>
            <KeyValue label="Owner">{d.assigned_to ?? 'Unassigned'}</KeyValue>
          </dl>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-white">Evidence ({d.evidence_items.length})</h3>
            <ul className="space-y-2">
              {d.evidence_items.map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised/40 px-3 py-2.5 text-sm">
                  <span className="text-slate-200">{ev.evidence_type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>
                  <EvidenceBadge status={ev.availability_status} />
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-white">Why this priority</h3>
            <ul className="space-y-3">
              {d.priority_factors.map((f) => (
                <li key={f.name}>
                  <div className="mb-1 flex justify-between text-[13px]">
                    <span className="text-slate-200">{f.name}</span>
                    <span className="font-mono text-brand-soft">+{f.contribution.toFixed(1)}</span>
                  </div>
                  <Meter value={f.contribution} />
                  <p className="mt-1 text-xs text-muted">{f.explanation}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </Drawer>
  );
}
