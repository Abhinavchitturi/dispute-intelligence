import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clock, ScrollText, ShieldCheck, XCircle } from 'lucide-react';
import { fetchAuditTrail } from '../api/client';
import { Badge, Card, EmptyState, ErrorState, PageHeader, SearchInput, Segmented, Select, Skeleton } from '../components/ui/kit';
import { cn, parseServerDate, timeAgo, titleCase } from '../lib/format';
import { useDebounced, useNow } from '../lib/hooks';

const STATUS_UI: Record<string, { icon: React.ElementType; cls: string }> = {
  SUCCESS: { icon: CheckCircle2, cls: 'bg-emerald-400/10 text-emerald-300' },
  FAILED: { icon: XCircle, cls: 'bg-rose-400/10 text-rose-300' },
  PENDING_APPROVAL: { icon: Clock, cls: 'bg-sky-400/10 text-sky-300' },
};

export function AuditTrailPage() {
  const navigate = useNavigate();
  const now = useNow(15_000);
  const [dispute, setDispute] = useState('');
  const [action, setAction] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const dq = useDebounced(dispute);

  const { data: events, isLoading, error, refetch } = useQuery({
    queryKey: ['auditEvents', dq, action, status],
    queryFn: () => fetchAuditTrail({ dispute_id: dq || undefined, action, status }),
    refetchInterval: 15_000,
    placeholderData: (p) => p,
  });

  return (
    <>
      <PageHeader
        title="Activity log"
        subtitle="A permanent record of every brief generated, score computed, and action taken."
        actions={<Badge tone="success"><ShieldCheck className="h-3.5 w-3.5" />Credentials are never logged</Badge>}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'ALL', label: 'All' }, { value: 'SUCCESS', label: 'Success' },
            { value: 'FAILED', label: 'Failed' }, { value: 'PENDING_APPROVAL', label: 'Pending' },
          ]}
        />
        <SearchInput value={dispute} onChange={setDispute} placeholder="Filter by dispute ID" className="lg:w-72" />
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="lg:w-56" aria-label="Filter by action">
          <option value="ALL">All actions</option>
          <option value="BRIEF_GENERATED">Brief generated</option>
          <option value="PROVIDE_EVIDENCE">Provide evidence</option>
          <option value="ACCEPT_CLAIM">Accept claim</option>
          <option value="PRIORITY_SCORED">Priority scored</option>
          <option value="DISPUTE_INGESTED">Dispute ingested</option>
        </Select>
        <span className="flex items-center gap-2 text-[13px] text-muted lg:ml-auto"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />Updates every 15s</span>
      </div>

      {error ? <ErrorState message="Couldn't load the activity log." onRetry={() => refetch()} /> : (
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="space-y-px">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-none" />)}</div>
          ) : !events?.length ? (
            <EmptyState icon={<ScrollText className="h-6 w-6" />} title="No events match" hint="Change the filters to see more activity." />
          ) : (
            <ul className="divide-y divide-line">
              {events.map((e) => {
                const ui = STATUS_UI[e.status] ?? STATUS_UI.PENDING_APPROVAL;
                return (
                  <li key={e.id} className="flex items-start gap-4 px-5 py-4 transition hover:bg-white/[.02]">
                    <span className={cn('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl', ui.cls)}><ui.icon className="h-[18px] w-[18px]" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium text-white">{titleCase(e.action)}</span>
                        {e.dispute_id && (
                          <button onClick={() => navigate(`/investigate/${e.dispute_id}`)} className="font-mono text-xs text-brand-soft hover:underline">{e.dispute_id}</button>
                        )}
                        <Badge>{e.actor}</Badge>
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{e.result_summary}</p>
                      {e.error_code && <p className="mt-1 font-mono text-xs text-rose-300">{e.error_code}</p>}
                    </div>
                    <span className="shrink-0 text-xs text-muted" title={parseServerDate(e.created_at).toLocaleString()}>{timeAgo(e.created_at, now)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
