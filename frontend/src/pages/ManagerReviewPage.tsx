import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Bot, CheckCircle2, ShieldCheck } from 'lucide-react';
import { fetchDisputes, fetchFlags, fetchTraining } from '../api/client';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from '../components/ui/kit';
import { FlagCard, ManagerReviewPanel, ReviseDecision } from '../components/ManagerPanels';
import { money, outcomeMeta, outcomeText, parseServerDate, reasonLabel } from '../lib/format';
import { useCurrentUser } from '../lib/user';

type Tab = 'waiting' | 'flags' | 'decided' | 'training';

/** Where a manager looks over everything below them: decisions waiting on the AI, the investigators' flags, decided cases, and what the AI is being taught. */
export function ManagerReviewPage() {
  const navigate = useNavigate();
  const { isManager } = useCurrentUser();
  const [tab, setTab] = useState<Tab>('waiting');

  const waiting = useQuery({ queryKey: ['disputes', 'aiPending'], queryFn: () => fetchDisputes({ status: 'PENDING_AI_REVIEW', sort_by: 'priority_score', sort_order: 'desc' }), refetchInterval: 15_000, enabled: isManager });
  const flags = useQuery({ queryKey: ['flags', 'all'], queryFn: () => fetchFlags(), refetchInterval: 15_000, enabled: isManager });
  const decided = useQuery({ queryKey: ['disputes', 'managerDecided'], queryFn: () => fetchDisputes({ status: 'RESOLVED', sort_by: 'updated_at', sort_order: 'desc' }), enabled: isManager && tab === 'decided' });
  const training = useQuery({ queryKey: ['training'], queryFn: fetchTraining, enabled: isManager && tab === 'training' });

  if (!isManager) {
    return <Card><EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Managers only" hint="Managers review decisions, deal with flags and correct the AI reviewer." /></Card>;
  }
  const openFlags = flags.data?.filter((f) => f.status === 'OPEN') ?? [];

  return (
    <>
      <PageHeader
        title="Manager review"
        subtitle="Investigators decide, the AI reviewer checks them, and you have the last word. Overturn anyone, including the AI. Corrections to the AI are saved for the team that trains it."
      />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'waiting', label: 'With the AI', count: waiting.data?.length ?? 0 },
          { value: 'flags', label: 'Flags', count: openFlags.length },
          { value: 'decided', label: 'Decided cases' },
          { value: 'training', label: 'AI feedback' },
        ]}
      />

      {tab === 'waiting' && (waiting.isError ? <ErrorState message="Couldn't load the decisions." onRetry={() => waiting.refetch()} /> : waiting.isLoading ? <Skeleton className="h-64 rounded-2xl" /> : !waiting.data?.length ? (
        <Card><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="Nothing waiting for the AI" hint="When an investigator decides a case, it goes to the AI reviewer. You can step in on any of them here." /></Card>
      ) : (
        <ul className="space-y-5" aria-label="Decisions waiting for the AI reviewer">
          {waiting.data.map((d) => (
            <li key={d.id}>
              <Card className="p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="font-mono text-lg font-semibold text-white">{d.id}</h2>
                      <Badge tone="warn" dot>With AI review</Badge>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{d.buyer_reference ?? 'Buyer'} vs {d.merchant_reference ?? 'Seller'} · {reasonLabel(d.reason)} · {money(d.amount, d.currency)}</p>
                  </div>
                  <Button size="sm" onClick={() => navigate(`/investigate/${d.id}`)}>Open case <ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
                <ManagerReviewPanel dispute={d} />
              </Card>
            </li>
          ))}
        </ul>
      ))}

      {tab === 'flags' && (flags.isError ? <ErrorState message="Couldn't load the flags." onRetry={() => flags.refetch()} /> : flags.isLoading ? <Skeleton className="h-48 rounded-2xl" /> : !flags.data?.length ? (
        <Card><EmptyState icon={<CheckCircle2 className="h-6 w-6" />} title="No flags" hint="When an investigator thinks the AI reviewer got their case wrong, they flag it with their reasons and it lands here." /></Card>
      ) : (
        <ul className="space-y-4" aria-label="Flags">{flags.data.map((f) => <li key={f.id}><FlagCard flag={f} /></li>)}</ul>
      ))}

      {tab === 'decided' && (
        <Card className="p-6">
          {decided.isLoading ? <Skeleton className="h-32" /> : !decided.data?.length ? <p className="text-sm text-muted">No decided cases yet.</p> : (
            <ul className="divide-y divide-line" aria-label="Decided cases">
              {decided.data.slice(0, 20).map((d) => (
                <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <button onClick={() => navigate(`/investigate/${d.id}`)} className="font-mono text-[13px] font-semibold text-white hover:underline">{d.id}</button>
                    <p className="text-[13px] text-muted">{reasonLabel(d.reason)} · {money(d.amount, d.currency)}{d.decided_by && ` · decided by ${d.decided_by === 'AI' ? 'the AI (it overturned the investigator)' : d.decided_by === 'MANAGER' ? 'a manager' : 'the investigator (the AI agreed)'}`}</p>
                  </div>
                  <div className="flex flex-wrap items-start gap-3">
                    <Badge tone={outcomeMeta(d.outcome)?.tone ?? 'success'}>{outcomeText(d.outcome) ?? 'Resolved'}</Badge>
                    <ReviseDecision dispute={d} compact />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'training' && (
        <Card className="p-6">
          <p className="mb-4 flex items-start gap-2 text-[13px] text-muted"><Bot className="mt-0.5 h-4 w-4 shrink-0" />Every time you overturn the AI, the right answer and your reasons are saved here. The AI team pulls these to train it. Nothing here changes the AI by itself.</p>
          {training.isLoading ? <Skeleton className="h-32" /> : !training.data?.length ? <p className="text-sm text-muted">No corrections yet.</p> : (
            <ul className="space-y-3" aria-label="AI feedback">
              {training.data.map((r) => (
                <li key={r.review_id} className="rounded-xl border border-line bg-raised/40 p-4 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-white">{r.dispute_id}</span>
                    <Badge tone={r.already_exported ? 'neutral' : 'info'}>{r.already_exported ? 'Pulled by the AI team' : 'Not pulled yet'}</Badge>
                    <span className="text-xs text-muted">{r.source === 'INVESTIGATOR_FLAG' ? 'from an investigator’s flag' : 'from your review'} · {parseServerDate(r.corrected_at).toLocaleDateString()}</span>
                  </div>
                  <p className="mt-2 text-slate-300"><span className="text-muted">AI said: </span>{outcomeMeta(r.ai_outcome)?.label} <span className="text-muted">({r.ai_rationale})</span></p>
                  <p className="mt-1 text-slate-300"><span className="text-muted">Correct answer: </span>{outcomeMeta(r.correct_outcome)?.label}. {r.correction_note}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
