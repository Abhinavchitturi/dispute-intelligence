import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { searchHistoricalCases } from '../api/client';
import { Badge, Card, EmptyState, ErrorState, Meter, PageHeader, SearchInput, Select, Skeleton } from '../components/ui/kit';
import { money, pastOutcomeLabel, reasonLabel, Tone } from '../lib/format';
import { useDebounced } from '../lib/hooks';

const OUTCOME_TONE: Record<string, Tone> = { MERCHANT_FAVOR: 'success', BUYER_FAVOR: 'danger', SETTLED: 'info', DISMISSED: 'neutral' };

export function SimilarCasesPage() {
  const [reason, setReason] = useState('ALL');
  const [outcome, setOutcome] = useState('ALL');
  const [search, setSearch] = useState('');
  const dq = useDebounced(search);

  const { data: cases, isLoading, error, refetch } = useQuery({
    queryKey: ['historicalCases', reason, outcome, dq],
    queryFn: () => searchHistoricalCases({ reason, outcome, search: dq }),
    placeholderData: (p) => p,
  });

  return (
    <>
      <PageHeader title="Similar cases" subtitle="Historical Precedent Explorer — see how comparable disputes were resolved before." />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_220px]">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by keyword, e.g. tracking delivered" />
        <Select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Filter by reason">
          <option value="ALL">All reasons</option>
          {['MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'UNAUTHORISED', 'CANCELLED_OR_RETURNED', 'DUPLICATE_TRANSACTION'].map((r) => (
            <option key={r} value={r}>{reasonLabel(r)}</option>
          ))}
        </Select>
        <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Filter by outcome">
          <option value="ALL">All outcomes</option>
          <option value="MERCHANT_FAVOR">Seller favor</option>
          <option value="BUYER_FAVOR">Buyer favor</option>
          <option value="SETTLED">Settled</option>
          <option value="DISMISSED">Dismissed</option>
        </Select>
      </div>

      {error ? <ErrorState message="Couldn't load past cases." onRetry={() => refetch()} /> : isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : !cases?.length ? (
        <Card><EmptyState icon={<SearchX className="h-6 w-6" />} title="No past cases match" hint="Try a broader search or clear a filter." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cases.map((c) => (
            <Card key={c.id} className="flex flex-col gap-3 p-5 transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-semibold text-white">{c.id}</div>
                  <div className="text-[13px] text-muted">{reasonLabel(c.reason)}{c.amount != null && ` · ${money(c.amount, c.currency)}`}</div>
                </div>
                <Badge tone={OUTCOME_TONE[c.outcome ?? ''] ?? 'neutral'}>{pastOutcomeLabel(c.outcome)}</Badge>
              </div>
              <p className="flex-1 text-sm leading-relaxed text-slate-300">{c.case_summary}</p>
              {typeof c.similarity_score === 'number' && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted"><span>Similarity</span><span className="tabular">{c.similarity_score}%</span></div>
                  <Meter value={c.similarity_score} tone="success" />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
