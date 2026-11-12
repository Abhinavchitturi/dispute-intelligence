import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { BrainCircuit, CheckCircle2, ShieldCheck } from 'lucide-react';
import { fetchTraining } from '../api/client';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui/kit';
import { cn, outcomeMeta, parseServerDate, reasonLabel } from '../lib/format';
import { useCurrentUser } from '../lib/user';
import { TrainingRow } from '../types';

const SIDE_LABEL: Record<string, string> = { seller: 'Seller sent', buyer: 'Buyer sent', records: 'PayPal records' };

/** One thing the AI got wrong, laid out as the lesson it teaches: what it saw, what it ruled, what was right, and what it missed. */
function Lesson({ r }: { r: TrainingRow }) {
  const navigate = useNavigate();
  const wrong = outcomeMeta(r.ai_outcome);
  const right = outcomeMeta(r.correct_outcome);
  const sides = (['seller', 'buyer', 'records'] as const).map((k) => ({ k, items: (r.evidence?.[k] ?? []).filter((i) => i.status === 'PROVIDED') })).filter((x) => x.items.length);
  return (
    <article className="rounded-2xl border border-line bg-raised/40 p-5" aria-label={`Lesson from ${r.dispute_id}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => navigate(`/investigate/${r.dispute_id}`)} className="font-mono font-semibold text-white hover:underline">{r.dispute_id}</button>
        {r.case && <span className="text-[13px] text-muted">{reasonLabel(r.case.reason)} · {r.case.currency} {r.case.amount.toFixed(2)}</span>}
        <Badge tone="success" dot>Learned</Badge>
        <span className="ml-auto text-xs text-muted">{r.source === 'INVESTIGATOR_FLAG' ? 'Reported by an investigator' : 'Found in your review'} · {r.corrected_by} · {parseServerDate(r.corrected_at).toLocaleDateString()}</span>
      </div>

      {r.lesson && (
        <div className="mt-4 rounded-xl border border-brand/30 bg-brand/[.07] p-4" aria-label="What it learned">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-soft">What it learned</p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-white">{r.lesson.summary}</p>
          <p className="mt-2 text-[13px] text-slate-300">
            {r.lesson.times_applied > 0
              ? <>Used on {r.lesson.times_applied} new case{r.lesson.times_applied === 1 ? '' : 's'}: {r.lesson.applied_to.map((id, i) => <React.Fragment key={id}>{i > 0 && ', '}<button onClick={() => navigate(`/investigate/${id}`)} className="font-mono text-brand-soft hover:underline">{id}</button></React.Fragment>)}.</>
              : 'Not used yet. It applies this the next time a case looks like this one.'}
          </p>
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-rose-400/20 bg-rose-400/[.05] p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-300">What it ruled before (the mistake)</p>
          <p className="mt-1.5 text-sm font-medium text-white">{wrong?.label ?? r.ai_outcome}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{r.ai_analysis?.reasoning ?? r.ai_rationale}</p>
        </div>
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[.06] p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">What was right (your correction)</p>
          <p className="mt-1.5 text-sm font-medium text-white">{right?.label ?? r.correct_outcome}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{r.correction_note}</p>
        </div>
      </div>

      {sides.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">The evidence it saw</p>
          <div className="space-y-1.5">
            {sides.map(({ k, items }) => (
              <div key={k} className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="w-24 shrink-0 text-muted">{SIDE_LABEL[k]}</span>
                {items.map((i) => (
                  <span key={i.type} title={i.concern ?? undefined} className={cn('rounded-full px-2.5 py-0.5 ring-1 ring-inset', i.concern ? 'bg-amber-400/10 text-amber-300 ring-amber-400/30' : 'bg-white/[.04] text-slate-300 ring-white/10')}>{i.label}{i.concern ? ' (doubtful)' : ''}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

/** Everything the AI has been corrected on, so a manager can see exactly what it is being taught. */
export function AITrainingPage() {
  const { isManager } = useCurrentUser();
  const training = useQuery({ queryKey: ['training'], queryFn: fetchTraining, refetchInterval: 20_000, enabled: isManager });
  if (!isManager) return <Card><EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Managers only" hint="Managers see what the AI is being taught." /></Card>;
  const rows = training.data ?? [];
  const lessons = rows.filter((r) => r.lesson);
  const used = lessons.reduce((n, r) => n + (r.lesson?.times_applied ?? 0), 0);
  const pulled = rows.filter((r) => r.already_exported).length;
  const stats = [
    { label: 'Lessons learned', value: lessons.length, hint: 'Each one changes how it rules' },
    { label: 'Times it used a lesson', value: used, hint: 'New cases ruled by what it was taught' },
    { label: 'Taught by investigators', value: rows.filter((r) => r.source === 'INVESTIGATOR_FLAG').length, hint: 'Reported, then confirmed by you' },
    { label: 'Shared with the AI Agent', value: `${pulled} of ${rows.length}`, hint: 'Pulled by the separate agent' },
  ];
  return (
    <>
      <PageHeader title="AI Training" subtitle="Every time you correct the AI, it keeps a lesson. The built-in reviewer applies each lesson to new cases that look the same, and says so when it does. The separate AI Agent can also pull these to train on." />
      <Card className="p-2" aria-label="Training summary">
        <dl className="grid grid-cols-2 sm:grid-cols-4 sm:divide-x sm:divide-line">
          {stats.map((s) => <div key={s.label} className="px-5 py-3"><dt className="text-xs text-muted">{s.label}</dt><dd className="mt-0.5 text-2xl font-semibold tabular text-white">{s.value}</dd><p className="mt-0.5 text-[11px] text-muted">{s.hint}</p></div>)}
        </dl>
      </Card>
      {training.isError ? <ErrorState message="Couldn't load the lessons." onRetry={() => training.refetch()} />
        : training.isLoading ? <Skeleton className="h-64 rounded-2xl" />
        : !rows.length ? <Card><EmptyState icon={<BrainCircuit className="h-6 w-6" />} title="Nothing taught yet" hint="When you overturn the decision on a case an investigator reported, or overturn an AI ruling, it shows up here as a lesson." /></Card>
        : <ul className="space-y-4" aria-label="Lessons">{rows.map((r) => <li key={r.review_id}><Lesson r={r} /></li>)}</ul>}
      <p className="flex items-center gap-2 text-xs text-muted"><CheckCircle2 aria-hidden className="h-3.5 w-3.5" />The separate AI Agent reads the same lessons from the feedback endpoint. Shared lessons are counted above.</p>
    </>
  );
}
