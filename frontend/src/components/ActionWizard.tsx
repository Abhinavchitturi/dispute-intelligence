import React, { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Bot, Check, Clock, Flag, Gavel, Info, Send, ShieldAlert, ShieldCheck, Sparkles, Store, ThumbsDown, ThumbsUp, User } from 'lucide-react';
import {
  AIReviewAssessment,
  draftActionMessage,
  executeAction,
  fetchDisputeDetail,
  fetchEvidenceOptions,
  previewAction,
  requestAiReview,
  submitDecision,
  dismissNoResponse,
} from '../api/client';
import { EvidenceChecklist } from './EvidenceChecklist';
import { ClaimPoints } from './ClaimPoints';
import { useCurrentUser } from '../lib/user';
import { ActionExecuteResult, EvidenceRequestOption } from '../types';
import { Badge, Button, Field, Modal, Select, Skeleton, Textarea, useToast } from './ui/kit';
import { cn, titleCase } from '../lib/format';

export const ACTIONS = [
  { value: 'REQUEST_SELLER_EVIDENCE', label: 'Ask the seller for evidence', hint: 'Request documents that back up their side', icon: Store },
  { value: 'REQUEST_BUYER_EVIDENCE', label: 'Ask the buyer for evidence', hint: 'Request footage, photos or a statement', icon: User },
] as const;
export type ActionValue = (typeof ACTIONS)[number]['value'];

const STEPS = ['Choose', 'Message', 'Review'] as const;
const DECISION_STEPS = ['Choose', 'Decide'] as const;
const MIN_REASON = 10;
const partyOf = (a: ActionValue) => (a === 'REQUEST_SELLER_EVIDENCE' ? 'seller' : 'buyer');

export interface ActionResult { message: string; env: string; audit: string }

const HINTS: Record<string, string> = {
  OPEN: 'Nobody has been asked for anything yet. Most cases start by asking the seller and the buyer for their side.',
  WAITING_FOR_SELLER_RESPONSE: 'Waiting on the seller. You can ask more, or decide with what you have.',
  WAITING_FOR_BUYER_RESPONSE: 'Waiting on the buyer. You can ask more, or decide with what you have.',
  WAITING_FOR_BOTH_RESPONSES: 'Waiting on the seller and the buyer. You can ask more, or decide with what you have.',
  IN_PROGRESS: 'Some evidence is in, but not from both sides yet. Ask the rest, or decide with what you have.',
  UNDER_REVIEW: 'Both sides have answered, or the reply deadline has passed. Review what you have and decide.',
  PENDING_AI_REVIEW: 'A decision on this case is with the AI reviewer. A manager has to reopen it before you can act.',
};

function hintFor(status: string, onFile: number): string | undefined {
  if (status === 'UNDER_REVIEW') return HINTS.UNDER_REVIEW;
  if (onFile > 0 && HINTS[status]) {
    const wait = status.startsWith('WAITING') ? ' You can also wait for the reply.' : '';
    return `${onFile} piece${onFile === 1 ? '' : 's'} of evidence on file. That's enough to decide now, or you can ask for more.${wait}`;
  }
  return HINTS[status];
}

function useActionDraft({ disputeId, action, active, step, open, days, choices }: {
  disputeId: string; action: ActionValue; active: boolean; step: number; open: boolean; days: number; choices?: EvidenceRequestOption[];
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[] | undefined>();
  const [edit, setEdit] = useState<string | undefined>();
  useEffect(() => { if (open) { setPicked(undefined); setEdit(undefined); } }, [open]);

  const chosen: string[] = picked ?? choices?.filter((o) => o.suggested).map((o) => o.evidence_type) ?? [];
  const resetForChange = () => { if (edit !== undefined) { setEdit(undefined); toast('info', 'The list changed, so the message was rebuilt.'); } };
  const toggle = (t: string) => { resetForChange(); setPicked(chosen.includes(t) ? chosen.filter((x) => x !== t) : [...chosen, t]); };

  const draft = useQuery({
    queryKey: ['actionDraft', disputeId, action, [...chosen].sort().join(','), days],
    queryFn: () => draftActionMessage(disputeId, { action_type: action, requested_evidence: chosen, deadline_days: days }),
    enabled: open && active && step >= 1 && !!choices,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const holdingOther = !!draft.data && draft.data.action_type !== action;
  const loading = draft.isLoading || draft.isPlaceholderData || holdingOther;
  const message = edit ?? (draft.data && !holdingOther ? draft.data.body : '');

  return { action, chosen, toggle, draft, loading, message, edit, setEdit, resetEdit: () => setEdit(undefined), resetForChange, choicesReady: !!choices };
}
type Slot = ReturnType<typeof useActionDraft>;

function useActionPreview({ disputeId, slot, active, enabled, open, days, notes }: {
  disputeId: string; slot: Slot; active: boolean; enabled: boolean; open: boolean; days: number; notes: string;
}) {
  return useQuery({
    queryKey: ['actionPreview', disputeId, slot.action, slot.chosen.length, days],
    queryFn: () => previewAction(disputeId, { action_type: slot.action, notes, requested_evidence: slot.chosen, deadline_days: days }),
    enabled: open && active && enabled,
    staleTime: 0,
  });
}

/** The AI's second opinion on a decision, before it is sent. Plain words first, the evidence behind it second. */
export function AiReviewPanel({ a, mine, reviewer }: { a: AIReviewAssessment; mine: 'BUYER_FAVOR' | 'SELLER_FAVOR' | null; reviewer?: string }) {
  const verdict = a.ai_verdict || (a.verdict === 'AGREE' ? 'AGREES' : a.verdict === 'DISAGREE' ? 'DISAGREES' : 'INCONCLUSIVE');
  const decision = a.ai_decision || a.recommendation || '';
  const side = decision === 'FULFILL_BUYER' ? "the buyer's favor" : decision === 'FULFILL_SELLER' ? "the seller's favor" : decision === 'DISMISS_NO_RESPONSE' ? 'dismissing the case' : null;
  const tone = verdict === 'AGREES' ? 'ok' : verdict === 'DISAGREES' ? 'bad' : 'wait';
  const headline = reviewer ? (verdict === 'AGREES' ? `The AI agrees with ${reviewer}: ${side ?? 'the decision'}.` : verdict === 'DISAGREES' ? `The AI disagrees with ${reviewer}: it points to ${side ?? 'the other side'}.` : "The AI can't decide this on the evidence on file.")
    : verdict === 'AGREES' ? `The AI agrees with you: ${side ?? 'your decision'}.`
    : verdict === 'DISAGREES' ? `The AI sees it differently: ${side ?? 'the other side'}.`
    : "The AI can't decide yet.";
  const tidy = (t: string) => t.replace(/^\[[^\]]+\]\s*/, '').replace(/^[A-Z_]+:\s*/, '');
  const found = (a.key_evidence?.supporting_evidence ?? []).map(tidy);
  const against = (a.key_evidence?.contradicting_evidence ?? []).map(tidy);
  const gaps = a.evidence_gaps || (a.missing_evidence?.length ? a.missing_evidence.join('; ') : '');
  const accent = { ok: 'border-emerald-400/30 bg-emerald-400/[.06] text-emerald-200', bad: 'border-rose-400/30 bg-rose-400/[.06] text-rose-200', wait: 'border-amber-400/30 bg-amber-400/[.06] text-amber-200' }[tone];
  const Icon = tone === 'ok' ? ShieldCheck : tone === 'bad' ? ShieldAlert : Clock;
  const list = (items: string[], empty: string) => items.length
    ? <ul className="space-y-1.5">{items.map((t, i) => <li key={i} className="flex gap-2 text-[13px] leading-snug text-slate-300"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-500" />{t}</li>)}</ul>
    : <p className="text-[13px] text-muted">{empty}</p>;
  return (
    <section aria-label="AI Review Assessment" className="space-y-4 rounded-2xl border border-line bg-raised/60 p-5 animate-fade-in">
      <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3', accent)}>
        <Icon aria-hidden className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-white">{headline}</p>
          {a.reasoning || a.explanation ? <p className="mt-1 text-[13px] leading-relaxed text-slate-200">{a.reasoning || a.explanation}</p> : null}
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div><h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">What it relied on</h4>{list(found, 'Nothing on file.')}</div>
        <div><h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">What weakens the other side</h4>{list(against, 'Nothing stands out.')}</div>
      </div>
      {(a.investigator_comparison || a.assessment) && (
        <div><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">On your reasoning</h4><p className="text-[13px] leading-relaxed text-slate-300">{a.investigator_comparison || a.assessment}</p></div>
      )}
      {gaps && <div><h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">Still missing</h4><p className="text-[13px] leading-relaxed text-slate-300">{gaps}</p></div>}
      <p className={cn('border-t border-line pt-3 text-xs text-muted', reviewer && 'hidden')}>
        This is advice, not a ruling. {verdict === 'DISAGREES' && mine ? 'You can still send your decision. If the AI overturns it after you send it, you will be able to report that to a manager.' : 'You can change your reasoning or send your decision as it is.'}
        <span className="ml-2 font-mono text-[11px] opacity-60">{a.provider}</span>
      </p>
    </section>
  );
}

export function ActionWizard({ open, onClose, disputeId, onJumpToRecord, onDone }: {
  open: boolean; onClose: () => void; disputeId: string;
  onJumpToRecord: (id: string) => void; onDone: (r: ActionResult) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isManager } = useCurrentUser();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<ActionValue[]>(['REQUEST_SELLER_EVIDENCE']);
  const [deciding, setDeciding] = useState(false);
  const [days, setDays] = useState(5);
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<'BUYER_FAVOR' | 'SELLER_FAVOR' | null>(null);
  const [aiAssessment, setAiAssessment] = useState<AIReviewAssessment | null>(null);

  useEffect(() => {
    if (open) {
      setStep(0);
      setSelected(['REQUEST_SELLER_EVIDENCE']);
      setDeciding(false);
      setDays(5);
      setNotes('');
      setReason('');
      setReviewed(false);
      setSelectedOutcome(null);
      setAiAssessment(null);
    }
  }, [open]);

  const wantsSeller = selected.includes('REQUEST_SELLER_EVIDENCE');
  const wantsBuyer = selected.includes('REQUEST_BUYER_EVIDENCE');

  const detail = useQuery({ queryKey: ['disputeDetail', disputeId], queryFn: () => fetchDisputeDetail(disputeId), enabled: open });
  const options = useQuery({ queryKey: ['evidenceOptions', disputeId], queryFn: () => fetchEvidenceOptions(disputeId), enabled: open && !deciding && (wantsSeller || wantsBuyer) });

  const base = { disputeId, step, open, days };
  const seller = useActionDraft({ ...base, action: 'REQUEST_SELLER_EVIDENCE', active: wantsSeller && !deciding, choices: options.data?.seller });
  const buyer = useActionDraft({ ...base, action: 'REQUEST_BUYER_EVIDENCE', active: wantsBuyer && !deciding, choices: options.data?.buyer });

  const slots: Slot[] = [...(wantsSeller ? [seller] : []), ...(wantsBuyer ? [buyer] : [])];
  const multi = slots.length > 1;
  const steps = deciding ? DECISION_STEPS : STEPS;
  const lastStep = steps.length - 1;

  const previewSeller = useActionPreview({ disputeId, slot: seller, active: wantsSeller && !deciding, enabled: step === 2, open, days, notes });
  const previewBuyer = useActionPreview({ disputeId, slot: buyer, active: wantsBuyer && !deciding, enabled: step === 2, open, days, notes });
  const previews = [...(wantsSeller ? [previewSeller] : []), ...(wantsBuyer ? [previewBuyer] : [])];

  const invalidate = () => ['disputeDetail', 'disputeTimeline', 'dashboardSummary', 'disputes', 'urgentDisputes', 'auditEvents', 'messageThreads', 'disputeMessages', 'evidenceOptions', 'evidenceSummary', 'flags', 'notifications']
    .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));

  const execute = useMutation({
    mutationFn: async () => {
      const done: ActionExecuteResult[] = [];
      for (const s of slots) {
        try {
          done.push(await executeAction(disputeId, {
            action_type: s.action, confirmed: true, message: s.message, subject: s.draft.data?.subject, notes,
            requested_evidence: s.chosen, deadline_days: days,
          }));
        } catch (e) {
          if (done.length) throw new Error(`The request to the ${partyOf(slots[0].action)} was sent, but the one to the ${partyOf(s.action)} failed: ${(e as Error).message}`);
          throw e;
        }
      }
      return done;
    },
    onSuccess: (results) => {
      const message = results.length > 1 ? 'Requests sent to the seller and the buyer.' : results[0].message || 'Done.';
      onDone({ message, env: results[0].environment, audit: results.map((r) => r.audit_event_id).join(', ') });
      toast('success', message);
      invalidate();
      onClose();
    },
    onError: (e: Error) => { toast('error', `Action failed: ${e.message}`); invalidate(); },
  });

  const dismiss = useMutation({
    mutationFn: () => dismissNoResponse(disputeId),
    onSuccess: (r) => { onDone({ message: r.message, env: 'demo', audit: 'Dismissed: no buyer response' }); toast('success', r.message); invalidate(); onClose(); },
    onError: (e: Error) => { toast('error', e.message); invalidate(); },
  });

  const decide = useMutation({
    mutationFn: (outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR') => submitDecision(disputeId, { outcome, reason: reason.trim() }),
    onSuccess: (r) => {
      onDone({ message: r.message, env: 'demo', audit: 'Decision submitted' });
      toast('success', r.message);
      invalidate();
      onClose();
    },
    onError: (e: Error) => { toast('error', `Couldn't send the decision: ${e.message}`); invalidate(); },
  });

  const aiReview = useMutation({
    mutationFn: (payload: { proposed_outcome: 'BUYER_FAVOR' | 'SELLER_FAVOR'; proposed_reason: string }) =>
      requestAiReview(disputeId, payload),
    onSuccess: (data) => {
      setAiAssessment(data);
      const v: string = data.ai_verdict || data.verdict;
      toast(
        'info',
        `AI Review complete: ${
          v === 'AGREES' || v === 'AGREE'
            ? 'AI agrees with this decision (Will Approve)'
            : v === 'DISAGREES' || v === 'DISAGREE'
            ? 'AI will OVERTURN this decision'
            : 'Inconclusive — AI cannot approve yet'
        }`
      );
    },
    onError: (e: Error) => {
      toast('error', `AI Review failed: ${e.message}`);
    },
  });

  const pick = (a: ActionValue) => setSelected((cur) => {
    if (cur.includes(a)) return cur.length > 1 ? cur.filter((x) => x !== a) : cur;
    return ACTIONS.map((x) => x.value).filter((v) => cur.includes(v) || v === a);
  });
  const changeDays = (d: number) => { slots.forEach((s) => s.resetForChange()); setDays(d); };
  const readyToDecide = () => { setDeciding(true); setStep(1); };
  const back = () => { if (deciding && step === 1) setDeciding(false); setStep(step - 1); };

  const onFileCount = detail.data?.evidence_items.filter((e) => e.availability_status === 'AVAILABLE').length ?? 0;
  const hint = detail.data ? hintFor(detail.data.status, onFileCount) : undefined;
  const inReview = detail.data?.status === 'PENDING_AI_REVIEW';
  const canContinue = step === 0 || (step === 1 && slots.every((s) => s.choicesReady && !s.loading && !!s.message.trim() && s.chosen.length > 0));
  const previewsOk = previews.every((p) => !!p.data?.is_supported && !p.isLoading);
  const reasonOk = reason.trim().length >= MIN_REASON;
  const canDecide = reviewed && reasonOk && !decide.isPending;

  const nextLabel = step === 0 ? (multi ? 'Next: write messages' : 'Next: write message') : 'Next: review';
  const footer = (
    <>
      {step > 0 ? <Button onClick={back} className="mr-auto"><ArrowLeft className="h-4 w-4" />Back</Button> : <span className="mr-auto" />}
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      {!deciding && (step < lastStep ? (
        <Button variant="primary" disabled={!canContinue || inReview} onClick={() => setStep(step + 1)}>{nextLabel}<ArrowRight className="h-4 w-4" /></Button>
      ) : (
        <Button variant="primary" loading={execute.isPending} disabled={!previewsOk} onClick={() => execute.mutate()}>
          <Send className="h-4 w-4" />{multi ? `Send ${slots.length} requests` : 'Send request'}
        </Button>
      ))}
    </>
  );

  const card = (a: (typeof ACTIONS)[number]) => {
    const active = selected.includes(a.value);
    return (
      <button
        key={a.value} role="checkbox" aria-checked={active} onClick={() => pick(a.value)}
        className={cn('relative flex items-start gap-3 rounded-2xl border p-4 text-left transition', active ? 'border-brand bg-brand/10' : 'border-line bg-raised/40 hover:border-line-strong')}
      >
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl', active ? 'bg-brand text-white' : 'bg-white/5 text-muted')}><a.icon className="h-[18px] w-[18px]" /></span>
        <span className="pr-6">
          <span className="block text-sm font-medium text-white">{a.label}</span>
          <span className="mt-0.5 block text-xs text-muted">{a.hint}</span>
        </span>
        <span aria-hidden className={cn('absolute right-3 top-3 grid h-5 w-5 place-items-center rounded-md border text-white', active ? 'border-brand bg-brand' : 'border-line-strong')}>
          {active && <Check className="h-3.5 w-3.5" />}
        </span>
      </button>
    );
  };

  const checklist = (s: Slot) => {
    const party = partyOf(s.action);
    return (
      <section aria-label={multi ? `What to ask the ${party} for` : 'What to ask for'} className="rounded-2xl border border-brand/25 bg-brand/[.06] p-4">
        <h3 className="text-sm font-semibold text-white">What do you need from the {party}?</h3>
        <p className="mt-0.5 text-xs text-muted">Pick what to ask for. Items already on file are marked.</p>
        {!options.data ? <Skeleton className="mt-3 h-24" /> : (
          <ul className="mt-3 space-y-2">
            {(party === 'seller' ? options.data.seller : options.data.buyer).map((o) => {
              const on = s.chosen.includes(o.evidence_type);
              return (
                <li key={o.evidence_type}>
                  <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition', on ? 'border-brand/50 bg-brand/10' : 'border-line bg-raised/40 hover:border-line-strong')}>
                    <input type="checkbox" checked={on} onChange={() => s.toggle(o.evidence_type)} aria-label={multi ? `${o.label} (${party})` : o.label} className="mt-1 h-4 w-4 accent-[#0A84FF]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                        {o.label}
                        {o.on_file && <Badge tone="success">On file</Badge>}
                        {!o.on_file && o.suggested && <Badge tone="danger">Missing</Badge>}
                      </span>
                      <span className="block text-xs text-muted">{o.on_file && o.on_file_description ? o.on_file_description : o.why}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  const draftBox = (s: Slot) => {
    const party = partyOf(s.action);
    const d = s.draft.data;
    const wrongAction = !!d && d.action_type !== s.action;
    return (
      <section aria-label={multi ? `Message draft for the ${party}` : 'Message draft'}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[13px] font-medium text-slate-300">
            <Send className="h-3.5 w-3.5" /> Message{d && !wrongAction && <> to <span className="text-white">{d.recipient.toLowerCase()}</span></>}
          </span>
          <span className="flex items-center gap-2">
            {d && !wrongAction && <Badge tone={d.source === 'llm' ? 'brand' : 'neutral'}>{d.source === 'llm' ? 'AI wording' : 'Auto draft'}</Badge>}
            {s.edit !== undefined && <button onClick={s.resetEdit} className="text-xs text-brand-soft hover:underline">Reset</button>}
          </span>
        </div>
        {wrongAction || s.draft.isLoading || !s.choicesReady ? <Skeleton className="h-44" /> : s.draft.isError ? (
          <p className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">
            Couldn't draft a message. <button onClick={() => s.draft.refetch()} className="underline">Try again</button>
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-xs text-muted">Subject: <span className="text-slate-300">{d?.subject}</span></p>
            <Textarea rows={multi ? 10 : 14} aria-label={multi ? `Message to the ${party}` : 'Message to send'} value={s.message} onChange={(e) => s.setEdit(e.target.value)} className="text-[13px] leading-relaxed" />
            {!!d?.cited_record_ids.length && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted">Based on</span>
                {d.cited_record_ids.map((rid) => (
                  <button key={rid} onClick={() => { onJumpToRecord(rid); onClose(); }} className="rounded-md bg-brand/10 px-1.5 py-0.5 font-mono text-[11px] text-brand-soft ring-1 ring-brand/20 hover:bg-brand/20">{rid}</button>
                ))}
              </div>
            )}
            {!!d?.notes?.length && (
              <ul className="mt-3 space-y-1" aria-label={multi ? `Draft notes (${party})` : 'Draft notes'}>
                {d.notes.map((n, i) => <li key={i} className="flex gap-2 px-1 text-xs text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{n}</li>)}
              </ul>
            )}
            {!!d?.warnings.length && (
              <ul className="mt-3 space-y-1.5" aria-label={multi ? `Draft warnings (${party})` : 'Draft warnings'}>
                {d.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 rounded-lg border border-amber-400/15 bg-amber-400/5 px-3 py-2 text-xs text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    );
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={deciding ? 'Ready for Review' : 'Take action'} footer={footer}>
      <ol className="flex items-center gap-2" aria-label="Steps">
        {steps.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === step ? 'step' : undefined}>
            <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
              i < step ? 'bg-emerald-400/20 text-emerald-300' : i === step ? 'bg-brand text-white' : 'bg-white/5 text-muted')}>
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={cn('text-[13px] font-medium', i === step ? 'text-white' : 'text-muted')}>{label}</span>
            {i < steps.length - 1 && <span className="h-px flex-1 bg-line-strong" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div role="group" aria-label="Choose an action" className="space-y-4 pt-2 animate-fade-in">
          {hint && (
            <p className="flex items-start gap-2 rounded-xl border border-line bg-raised/50 px-3 py-2.5 text-[13px] text-slate-300"><Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-soft" />{hint}</p>
          )}
          {detail.data?.review_note && detail.data.status === 'UNDER_REVIEW' && (
            <p role="note" className="rounded-xl border border-amber-400/25 bg-amber-400/[.07] px-3 py-2.5 text-[13px] text-amber-100">
              <span className="font-semibold">{detail.data.reviewed_by ?? 'A manager'} sent this back:</span> {detail.data.review_note}
            </p>
          )}
          <div>
            <h3 className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted">
              Ask for evidence <span className="font-normal normal-case tracking-normal">Pick one or both</span>
            </h3>
            <div role="group" aria-label="Ask for evidence" className="grid gap-3 sm:grid-cols-2">{ACTIONS.map(card)}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="max-w-sm text-[13px] text-muted">{isManager ? 'Have what you need? Review everything on file and make your call. As manager, your decision is final and the seller and the buyer are told at once.' : 'Have what you need? Review everything on file and make your call. The AI reviewer checks it before anyone is told.'}</p>
            <Button onClick={readyToDecide} disabled={inReview}><Gavel className="h-4 w-4" />Ready to decide</Button>
          </div>
          {detail.data?.buyer_silent && (
            <div role="group" aria-label="The buyer did not respond" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[.07] p-4">
              <p className="max-w-md text-[13px] text-amber-50">The buyer's last day to respond has passed and nothing came back. The case can be dismissed. The AI checks it, and the buyer is told how to open a new case.</p>
              <Button variant="primary" loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Dismiss: buyer didn't respond</Button>
            </div>
          )}
        </div>
      )}

      {step === 1 && !deciding && (
        <div className="space-y-5 animate-fade-in">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">{multi ? 'Both messages use the same reply deadline.' : 'Set how long they have to reply.'}</p>
            <div className="w-56 shrink-0">
              <Select aria-label="Reply within" value={days} onChange={(e) => changeDays(Number(e.target.value))} className="py-1.5 text-[13px]">
                {[2, 3, 5, 7, 10].map((d) => <option key={d} value={d}>Reply within {d} days</option>)}
              </Select>
            </div>
          </div>

          {slots.map((s) => (
            <div key={s.action} className={cn('space-y-4', multi && 'rounded-2xl border border-line p-4')}>
              {multi && <h3 className="flex items-center gap-2 text-sm font-semibold text-white">{s.action === 'REQUEST_SELLER_EVIDENCE' ? <Store className="h-4 w-4 text-brand-soft" /> : <User className="h-4 w-4 text-brand-soft" />}To the {partyOf(s.action)}</h3>}
              {checklist(s)}
              {draftBox(s)}
            </div>
          ))}

          <Field label="Internal note (optional)">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Only visible to your team. Why this action?" />
          </Field>
        </div>
      )}

      {step === 1 && deciding && (
        <div className="space-y-5 animate-fade-in">
          {detail.data && <ClaimPoints points={detail.data.claim_points} />}
          <EvidenceChecklist disputeId={disputeId} title="Evidence on this case" />

          <section aria-label="Your decision" className="space-y-4 border-t border-line pt-5">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted">
                  1. Select your decision
                </label>
                {selectedOutcome && (
                  <span className="text-xs text-brand-soft">
                    Selected: {selectedOutcome === 'BUYER_FAVOR' ? "Buyer's favor" : "Seller's favor"}
                  </span>
                )}
              </div>
              <div role="radiogroup" aria-label="Select decision" className="grid gap-2.5 sm:grid-cols-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedOutcome === 'BUYER_FAVOR'}
                  onClick={() => {
                    setSelectedOutcome('BUYER_FAVOR');
                    if (aiAssessment) setAiAssessment(null);
                  }}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition',
                    selectedOutcome === 'BUYER_FAVOR'
                      ? 'border-brand bg-brand/20 text-white shadow-sm ring-1 ring-brand/40'
                      : 'border-line bg-raised/40 text-slate-300 hover:border-line-strong hover:bg-raised'
                  )}
                >
                  <ThumbsUp className="h-4 w-4 text-emerald-400" />
                  Buyer's favor
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedOutcome === 'SELLER_FAVOR'}
                  onClick={() => {
                    setSelectedOutcome('SELLER_FAVOR');
                    if (aiAssessment) setAiAssessment(null);
                  }}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition',
                    selectedOutcome === 'SELLER_FAVOR'
                      ? 'border-brand bg-brand/20 text-white shadow-sm ring-1 ring-brand/40'
                      : 'border-line bg-raised/40 text-slate-300 hover:border-line-strong hover:bg-raised'
                  )}
                >
                  <ThumbsDown className="h-4 w-4 text-amber-400" />
                  Seller's favor
                </button>
              </div>
            </div>

            <Field label="2. Why are you deciding this way?">
              <Textarea
                rows={4}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (aiAssessment) setAiAssessment(null);
                }}
                aria-label="Reason for your decision"
                placeholder="For example: the carrier confirmed delivery to the address on the order, and the buyer sent no footage."
              />
            </Field>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised/40 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-200">
                  <Sparkles className="h-3.5 w-3.5 text-brand-soft" />
                  <span>AI Review</span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted">
                  Independently evaluate the dispute evidence against your decision before submitting.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                loading={aiReview.isPending}
                disabled={!selectedOutcome || !reason.trim()}
                onClick={() => {
                  if (selectedOutcome && reason.trim()) {
                    aiReview.mutate({ proposed_outcome: selectedOutcome, proposed_reason: reason.trim() });
                  }
                }}
                className="border border-brand/40 bg-brand/10 text-brand-soft hover:bg-brand/20 hover:text-white"
              >
                <Sparkles className="h-4 w-4" />
                {aiReview.isPending ? 'Reviewing...' : 'AI Review'}
              </Button>
            </div>

            {aiAssessment && <AiReviewPanel a={aiAssessment} mine={selectedOutcome} />}

            <p className="flex gap-2 text-xs text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {isManager
                ? 'As manager, your decision is final. There is no AI review. The seller and the buyer are told straight away, and each gets an email listing the proof both sides sent.'
                : 'Your reason goes to the AI reviewer with your decision. The seller and the buyer are told once it rules. If it overturns you, that is a strike, and you can flag it to a manager if you think it is wrong.'}
            </p>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-raised/40 p-3 text-sm text-slate-200">
              <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#0A84FF]" />
              <span>I've reviewed the evidence on file and I'm making this decision.</span>
            </label>

            {selectedOutcome ? (
              <Button
                variant="primary"
                loading={decide.isPending}
                disabled={!canDecide}
                onClick={() => decide.mutate(selectedOutcome)}
                className="w-full py-2.5 text-sm"
              >
                {selectedOutcome === 'BUYER_FAVOR' ? <ThumbsUp className="h-4 w-4" /> : <ThumbsDown className="h-4 w-4" />}
                Submit decision ({selectedOutcome === 'BUYER_FAVOR' ? "Buyer's favor" : "Seller's favor"})
              </Button>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Button
                  variant="primary"
                  loading={decide.isPending && decide.variables === 'BUYER_FAVOR'}
                  disabled={!canDecide}
                  onClick={() => {
                    setSelectedOutcome('BUYER_FAVOR');
                    decide.mutate('BUYER_FAVOR');
                  }}
                >
                  <ThumbsUp className="h-4 w-4" />Buyer's favor
                </Button>
                <Button
                  variant="primary"
                  loading={decide.isPending && decide.variables === 'SELLER_FAVOR'}
                  disabled={!canDecide}
                  onClick={() => {
                    setSelectedOutcome('SELLER_FAVOR');
                    decide.mutate('SELLER_FAVOR');
                  }}
                >
                  <ThumbsDown className="h-4 w-4" />Seller's favor
                </Button>
              </div>
            )}
            {!reasonOk && reason.length > 0 && <p className="text-xs text-amber-300">Add a little more. The reviewer needs to see your reasoning.</p>}
          </section>
        </div>
      )}

      {step === 2 && !deciding && (
        <div className="space-y-5 animate-fade-in">
          {slots.map((s, i) => {
            const p = previews[i];
            const party = partyOf(s.action);
            const info = ACTIONS.find((a) => a.value === s.action)!;
            return (
              <div key={s.action} className="space-y-3">
                {multi && <h3 className="text-sm font-semibold text-white">To the {party}</h3>}
                {p.isLoading ? <Skeleton className="h-32" /> : p.isError ? (
                  <p className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-sm text-rose-200">Couldn't preview this action. Go back and try again.</p>
                ) : p.data && (
                  <>
                    <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-raised/50 p-4 text-sm">
                      <div><dt className="text-xs uppercase tracking-wider text-muted">Action</dt><dd className="mt-1 text-white">{info.label}</dd></div>
                      <div><dt className="text-xs uppercase tracking-wider text-muted">Environment</dt><dd className="mt-1"><Badge tone="violet">{titleCase(p.data.target_environment)}</Badge></dd></div>
                    </dl>
                    <p className="text-sm text-slate-300"><span className="font-medium text-white">What happens: </span>{p.data.impact_summary}</p>
                    <p className="flex gap-2 text-[13px] text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />The {party} isn't on this app, so this goes to them by email. They reply by email, and the reply comes back to this case for you to go through.</p>
                    {p.data.warning_message && (
                      <div className="flex gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{p.data.warning_message}</div>
                    )}
                    <div>
                      <div className="mb-1.5 text-xs uppercase tracking-wider text-muted">Message that will be sent{s.draft.data && ` to ${s.draft.data.recipient.toLowerCase()}`}</div>
                      <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-raised/50 p-3 font-sans text-[13px] leading-relaxed text-slate-200">{s.message}</pre>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
