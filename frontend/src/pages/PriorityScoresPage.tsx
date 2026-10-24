import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Flame } from 'lucide-react';
import { fetchDisputes } from '../api/client';
import { DisputeSummary } from '../types';
import { Button, Card, EmptyState, ErrorState, Meter, PageHeader, SectionTitle, Segmented, Skeleton } from '../components/ui/kit';
import { Countdown, ScoreRing } from '../components/DisputeBits';
import { cn, money, OPEN_STATUSES, priorityMeta, reasonLabel } from '../lib/format';

// Stable colors per scoring factor so the same factor is the same color everywhere on the page.
const FACTOR_COLORS = ['bg-brand', 'bg-amber-400', 'bg-rose-400', 'bg-emerald-400', 'bg-sky-400', 'bg-violet-400'];

type Band = 'all' | 'high' | 'medium' | 'low';
const inBand = (d: DisputeSummary, band: Band) => band === 'all' || (band === 'high' ? d.priority_score >= 70 : band === 'medium' ? d.priority_score >= 40 && d.priority_score < 70 : d.priority_score < 40);

export function PriorityScoresPage() {
  const navigate = useNavigate();
  const [band, setBand] = useState<Band>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['urgentDisputes'],
    queryFn: () => fetchDisputes({ sort_by: 'priority_score', sort_order: 'desc' }),
    refetchInterval: 30_000,
  });

  const open = useMemo(() => (data ?? []).filter((d) => OPEN_STATUSES.includes(d.status)), [data]);
  const rows = open.filter((d) => inBand(d, band));

  // Order factors by their weight; colors follow that order.
  const factors = useMemo(() => {
    const seen = new Map<string, { name: string; weight: number }>();
    open.forEach((d) => d.priority_factors.forEach((f) => seen.has(f.name) || seen.set(f.name, { name: f.name, weight: f.weight })));
    return [...seen.values()].sort((a, b) => b.weight - a.weight).map((f, i) => ({ ...f, color: FACTOR_COLORS[i % FACTOR_COLORS.length] }));
  }, [open]);
  const colorOf = (name: string) => factors.find((f) => f.name === name)?.color ?? 'bg-slate-400';

  const avg = open.length ? open.reduce((a, d) => a + d.priority_score, 0) / open.length : 0;

  if (error) return <ErrorState message="Couldn't load priority scores." onRetry={() => refetch()} />;

  return (
    <>
      <PageHeader title="Priority scores" subtitle="Every open dispute is scored 0–100. The higher the score, the sooner it needs you. Expand a row to see exactly why." />

      <Card className="p-6">
        <SectionTitle title="How a score is built" hint={open.length ? `Average score across ${open.length} open disputes: ${avg.toFixed(0)}` : undefined} />
        {isLoading ? <Skeleton className="h-10" /> : (
          <ul className="flex flex-wrap gap-x-6 gap-y-3">
            {factors.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-sm text-slate-300">
                <span className={cn('h-2.5 w-2.5 rounded-full', f.color)} />
                {f.name}
                <span className="text-xs text-muted">up to {f.weight.toFixed(0)} pts</span>
              </li>
            ))}
            <li className="flex w-full flex-wrap items-center gap-4 border-t border-line pt-3 text-[13px] text-muted">
              <span><span className="font-medium text-rose-300">70+</span> urgent</span>
              <span><span className="font-medium text-amber-300">40–69</span> medium</span>
              <span><span className="font-medium text-emerald-300">under 40</span> low</span>
            </li>
          </ul>
        )}
      </Card>

      <Segmented
        value={band}
        onChange={setBand}
        options={[
          { value: 'all', label: 'All open', count: open.length },
          { value: 'high', label: 'Urgent', count: open.filter((d) => inBand(d, 'high')).length },
          { value: 'medium', label: 'Medium', count: open.filter((d) => inBand(d, 'medium')).length },
          { value: 'low', label: 'Low', count: open.filter((d) => inBand(d, 'low')).length },
        ]}
      />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-px">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-none" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Flame className="h-6 w-6" />} title="Nothing in this band" hint="Pick another band to see more disputes." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((d, i) => {
              const expanded = openId === d.id;
              const { label, tone } = priorityMeta(d.priority_score);
              return (
                <li key={d.id}>
                  <button
                    onClick={() => setOpenId(expanded ? null : d.id)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-white/[.03]"
                  >
                    <span className="w-6 text-center text-sm font-medium text-muted tabular">{i + 1}</span>
                    <ScoreRing score={d.priority_score} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3">
                        <span className="font-mono text-[13px] font-semibold text-white">{d.id}</span>
                        <span className="text-[13px] text-muted">{reasonLabel(d.reason)} · {money(d.amount, d.currency)}</span>
                      </div>
                      {/* The bar's length is the score; each segment is one factor's contribution. */}
                      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-white/5" role="img" aria-label={`Score ${d.priority_score.toFixed(0)} out of 100, ${label}`}>
                        {d.priority_factors.map((f) => (
                          <div key={f.name} className={cn('h-full transition-all duration-700', colorOf(f.name))} style={{ width: `${f.contribution}%` }} title={`${f.name}: +${f.contribution.toFixed(1)}`} />
                        ))}
                      </div>
                    </div>
                    <div className="hidden w-40 justify-end sm:flex"><Countdown due={d.response_due_date} /></div>
                    <span className={cn('hidden w-20 text-right text-xs font-semibold md:block', tone === 'danger' ? 'text-rose-300' : tone === 'warn' ? 'text-amber-300' : 'text-emerald-300')}>{label}</span>
                    <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition', expanded && 'rotate-180')} />
                  </button>

                  {expanded && (
                    <div className="animate-fade-in space-y-4 border-t border-line bg-raised/30 px-5 py-5 pl-[84px]">
                      {d.priority_factors.map((f) => (
                        <div key={f.name}>
                          <div className="mb-1 flex items-center justify-between text-[13px]">
                            <span className="flex items-center gap-2 text-slate-200"><span className={cn('h-2 w-2 rounded-full', colorOf(f.name))} />{f.name}</span>
                            <span className="font-mono text-slate-300">+{f.contribution.toFixed(1)} <span className="text-muted">of {f.weight.toFixed(0)}</span></span>
                          </div>
                          <Meter value={(f.contribution / (f.weight || 1)) * 100} />
                          <p className="mt-1 text-xs text-muted">{f.explanation}</p>
                        </div>
                      ))}
                      <Button size="sm" variant="primary" onClick={() => navigate(`/investigate/${d.id}`)}>Investigate this case</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
