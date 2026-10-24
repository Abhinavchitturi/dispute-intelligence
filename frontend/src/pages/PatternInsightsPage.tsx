import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Info, Sparkles } from 'lucide-react';
import { fetchPatternInsights } from '../api/client';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui/kit';
import { cn, titleCase } from '../lib/format';

export function PatternInsightsPage() {
  const navigate = useNavigate();
  const { data: patterns, isLoading, error, refetch } = useQuery({ queryKey: ['patternInsights'], queryFn: fetchPatternInsights });

  return (
    <>
      <PageHeader
        title="Patterns"
        subtitle="Authorized Dataset Pattern Insights — recurring problems across your open disputes."
      />
      <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-soft" />
        <p>These patterns come only from your own sample dataset. They are not PayPal-wide statistics or fraud scores.</p>
      </div>

      {error ? <ErrorState message="Couldn't load patterns." onRetry={() => refetch()} /> : isLoading ? (
        <div className="space-y-4"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /></div>
      ) : !patterns?.length ? (
        <Card><EmptyState icon={<Sparkles className="h-6 w-6" />} title="No patterns detected" hint="Patterns appear when several disputes share the same problem." /></Card>
      ) : (
        <div className="space-y-4">
          {patterns.map((p) => {
            const high = p.severity === 'HIGH';
            return (
              <Card key={p.pattern_id} className={cn('relative overflow-hidden p-6 transition hover:border-line-strong')}>
                <span className={cn('absolute inset-y-0 left-0 w-1', high ? 'bg-rose-400' : 'bg-amber-400')} />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', high ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300')}>
                      <AlertTriangle className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 className="text-[15px] font-semibold text-white">{p.title}</h2>
                      <p className="mt-0.5 text-[13px] text-muted">{titleCase(p.category)} · {p.time_window}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{p.case_count} Disputed Cases</Badge>
                    <Badge tone={high ? 'danger' : 'warn'}>{p.severity} SEVERITY</Badge>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-300"><span className="font-medium text-white">Why it matters: </span>{p.why_noteworthy}</p>
                <p className="mt-2 text-sm text-slate-300"><span className="font-medium text-brand-soft">Suggested fix: </span>{p.recommended_action}</p>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                  <span className="text-xs text-muted">Affected</span>
                  {p.supporting_record_ids.map((id: string) => (
                    <button key={id} onClick={() => navigate(`/investigate/${id}`)} className="group inline-flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 font-mono text-xs text-brand-soft ring-1 ring-brand/20 transition hover:bg-brand/20">
                      {id}<ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
