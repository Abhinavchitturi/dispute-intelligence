import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { managerReview, resolveFlag, reviseDecision } from '../api/client';
import { CaseFlag, DisputeSummary } from '../types';
import { Badge, Button, Field, Textarea, useToast } from './ui/kit';
import { EvidenceChecklist } from './EvidenceChecklist';
import { cn, outcomeMeta, parseServerDate } from '../lib/format';

type Mode = 'idle' | 'override' | 'reopen';
const KEYS = ['disputes', 'urgentDisputes', 'dashboardSummary', 'disputeDetail', 'disputeTimeline', 'messageThreads', 'disputeMessages', 'auditEvents', 'flags', 'training', 'notifications', 'caseEmails', 'team'];

function useRefresh() {
  const qc = useQueryClient();
  return () => KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

const OUTCOMES = [['BUYER_FAVOR', "Buyer's favor", ThumbsUp], ['SELLER_FAVOR', "Seller's favor", ThumbsDown]] as const;

function OutcomePicker({ value, onChange, label }: { value: string; onChange: (v: 'BUYER_FAVOR' | 'SELLER_FAVOR') => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {OUTCOMES.map(([v, text, Icon]) => (
        <button
          key={v} role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={cn('flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition', value === v ? 'border-brand bg-brand/10 text-white' : 'border-line text-slate-300 hover:border-line-strong')}
        >
          <Icon className="h-4 w-4" />{text}
        </button>
      ))}
    </div>
  );
}

/**
 * A case waiting for the AI reviewer. A manager is above it, so they can decide it themselves
 * (confirm what the investigator chose, or decide differently) or send it back.
 */
export function ManagerReviewPanel({ dispute, showEvidence = true }: { dispute: DisputeSummary; showEvidence?: boolean }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [mode, setMode] = useState<Mode>('idle');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<'BUYER_FAVOR' | 'SELLER_FAVOR'>(dispute.proposed_outcome === 'BUYER_FAVOR' ? 'SELLER_FAVOR' : 'BUYER_FAVOR');

  const pending = dispute.status === 'PENDING_AI_REVIEW';
  const proposed = outcomeMeta(dispute.proposed_outcome);

  const review = useMutation({
    mutationFn: (action: 'APPROVE' | 'OVERRIDE' | 'REOPEN') => managerReview(dispute.id, { action, note: note.trim() || undefined, outcome: action === 'OVERRIDE' ? outcome : undefined }),
    onSuccess: (r) => { toast('success', r.message); setMode('idle'); setNote(''); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <div className="space-y-5">
      {pending && (
        <section aria-label="Proposed decision" className="rounded-2xl border border-amber-400/25 bg-amber-400/[.06] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-200">Proposed decision</span>
            {proposed && <Badge tone={proposed.tone}>{proposed.label}</Badge>}
            <span className="text-xs text-muted">
              by {dispute.proposed_by ?? 'an investigator'}
              {dispute.proposed_at && ` · ${parseServerDate(dispute.proposed_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-100">{dispute.proposed_reason}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Bot className="h-3.5 w-3.5" />Waiting for the AI reviewer. You can step in at any time.</p>
        </section>
      )}

      {showEvidence && <EvidenceChecklist disputeId={dispute.id} title="Evidence the decision rests on" />}

      {pending && (
        <section aria-label="Manager actions" className="space-y-3 border-t border-line pt-4">
          {mode === 'idle' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" loading={review.isPending && review.variables === 'APPROVE'} onClick={() => review.mutate('APPROVE')}>
                <Check className="h-4 w-4" />Confirm decision
              </Button>
              <Button onClick={() => setMode('override')}>Decide differently</Button>
              <Button variant="ghost" onClick={() => setMode('reopen')}><RotateCcw className="h-4 w-4" />Send back</Button>
              <p className="basis-full text-xs text-muted">Confirming decides the case now, without waiting for the AI reviewer, and tells the seller and the buyer.</p>
            </div>
          ) : (
            <div className="space-y-3 animate-fade-in">
              {mode === 'override' && <OutcomePicker value={outcome} onChange={setOutcome} label="Your decision" />}
              <Field label={mode === 'override' ? 'Why are you replacing the investigator’s decision?' : 'What needs fixing?'}>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Manager note" placeholder={mode === 'override' ? 'The footage clearly shows no delivery.' : 'The address check is missing. Ask the seller before deciding.'} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" loading={review.isPending} disabled={!note.trim()} onClick={() => review.mutate(mode === 'override' ? 'OVERRIDE' : 'REOPEN')}>
                  {mode === 'override' ? 'Decide and notify both' : 'Send back to the investigator'}
                </Button>
                <Button variant="ghost" onClick={() => { setMode('idle'); setNote(''); }}>Cancel</Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Overturn a decision that has already been made. If the AI made the call, the correction becomes training feedback. */
export function ReviseDecision({ dispute, compact = false }: { dispute: DisputeSummary; compact?: boolean }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const other = dispute.outcome === 'BUYER_FAVOR' ? 'SELLER_FAVOR' : 'BUYER_FAVOR';
  const [outcome, setOutcome] = useState<'BUYER_FAVOR' | 'SELLER_FAVOR'>(other);
  const revise = useMutation({
    mutationFn: () => reviseDecision(dispute.id, outcome, note.trim()),
    onSuccess: () => { toast('success', 'Decision overturned. Both sides have been told.'); setOpen(false); setNote(''); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });
  if (dispute.status !== 'RESOLVED' || (dispute.outcome !== 'BUYER_FAVOR' && dispute.outcome !== 'SELLER_FAVOR')) return null;
  if (!open) return <Button size="sm" variant={compact ? 'ghost' : 'secondary'} onClick={() => setOpen(true)}><RotateCcw className="h-3.5 w-3.5" />Overturn decision</Button>;
  return (
    <div className="w-full space-y-3 rounded-2xl border border-line bg-raised/50 p-4 animate-fade-in sm:max-w-xl">
      <OutcomePicker value={outcome} onChange={setOutcome} label="New decision" />
      <Field label="Why is the decision changing?">
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Why overturn ${dispute.id}`} placeholder="What the first decision missed." />
      </Field>
      <p className="text-xs text-muted">The seller and the buyer are sent the updated decision.{dispute.ai_verdict && ' Because the AI reviewer was involved, your correction is saved for the AI team to train on.'}</p>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" loading={revise.isPending} disabled={note.trim().length < 10 || outcome === dispute.outcome} onClick={() => revise.mutate()}>Overturn and notify both</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

/** An investigator's flag that the AI got a case wrong. The manager sides with the AI, or overturns it. */
export function FlagCard({ flag }: { flag: CaseFlag }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState<'UPHOLD_AI' | 'OVERTURN' | null>(null);
  const resolve = useMutation({
    mutationFn: (action: 'UPHOLD_AI' | 'OVERTURN') => resolveFlag(flag.id, action, note.trim()),
    onSuccess: (f) => { toast('success', f.status === 'OVERTURNED' ? 'The AI was overturned. Your correction is saved for the AI team.' : 'The AI decision stands.'); setAsking(null); setNote(''); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });
  const mine = outcomeMeta(flag.investigator_outcome);
  const ai = outcomeMeta(flag.ai_outcome);
  return (
    <article className="rounded-2xl border border-line bg-raised/40 p-4" aria-label={`Flag on ${flag.dispute_id}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono font-semibold text-white">{flag.dispute_id}</span>
        <Badge tone={flag.status === 'OPEN' ? 'warn' : flag.status === 'OVERTURNED' ? 'success' : 'neutral'}>{flag.status === 'OPEN' ? 'Open' : flag.status === 'OVERTURNED' ? 'AI overturned' : 'AI upheld'}</Badge>
        <span className="text-xs text-muted">raised by {flag.raised_by}</span>
      </div>
      <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
        <div><dt className="text-xs uppercase tracking-wider text-muted">The investigator decided</dt><dd className="mt-1 text-white">{mine?.label ?? '—'}</dd></div>
        <div><dt className="text-xs uppercase tracking-wider text-muted">The AI decided</dt><dd className="mt-1 text-white">{ai?.label ?? '—'}</dd></div>
      </dl>
      {flag.ai_rationale && <p className="mt-3 text-[13px] text-slate-300"><span className="text-muted">AI's reasons: </span>{flag.ai_rationale}</p>}
      <p className="mt-3 rounded-xl bg-white/[.04] p-3 text-[13px] text-slate-200"><span className="text-muted">Investigator says: </span>{flag.points}</p>
      {flag.status !== 'OPEN' && flag.resolution_note && <p className="mt-3 text-[13px] text-slate-300"><span className="text-muted">{flag.resolved_by}: </span>{flag.resolution_note}</p>}
      {flag.status === 'OPEN' && (
        <div className="mt-4 space-y-3">
          {asking ? (
            <>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Your reasons for ${flag.dispute_id}`} placeholder={asking === 'OVERTURN' ? 'What the AI got wrong. This is what it learns from.' : 'Why the AI was right.'} />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" loading={resolve.isPending} disabled={note.trim().length < 10} onClick={() => resolve.mutate(asking)}>
                  {asking === 'OVERTURN' ? 'Overturn the AI' : 'Keep the AI decision'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={() => setAsking('OVERTURN')}>Overturn the AI</Button>
              <Button size="sm" onClick={() => setAsking('UPHOLD_AI')}>Keep the AI decision</Button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
