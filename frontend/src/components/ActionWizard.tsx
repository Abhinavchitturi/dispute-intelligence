import React, { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Gavel, Info, Send, Store, ThumbsDown, ThumbsUp, User } from 'lucide-react';
import { draftActionMessage, executeAction, fetchDisputeDetail, fetchEvidenceOptions, previewAction } from '../api/client';
import { ActionExecuteResult, EvidenceBalance, EvidenceRequestOption } from '../types';
import { Badge, Button, Field, Modal, Select, Skeleton, Textarea, useToast } from './ui/kit';
import { cn, titleCase } from '../lib/format';

type Group = 'ask' | 'decide';
export const ACTIONS = [
  { value: 'REQUEST_SELLER_EVIDENCE', group: 'ask' as Group, label: 'Ask the seller for evidence', hint: 'Request documents that back up their side', icon: Store },
  { value: 'REQUEST_BUYER_EVIDENCE', group: 'ask' as Group, label: 'Ask the buyer for evidence', hint: 'Request footage, photos or a statement', icon: User },
  { value: 'DECIDE_FOR_BUYER', group: 'decide' as Group, label: "Decide in the buyer's favor", hint: 'Refund the buyer, taken from the seller', icon: ThumbsUp },
  { value: 'DECIDE_FOR_SELLER', group: 'decide' as Group, label: "Decide in the seller's favor", hint: 'No refund, the seller keeps the payment', icon: ThumbsDown },
] as const;
export type ActionValue = (typeof ACTIONS)[number]['value'];

const STEPS = ['Choose', 'Message', 'Review'] as const;
const DECISION_STEPS = ['Choose', 'Decide'] as const;
const isRequest = (a: ActionValue) => a === 'REQUEST_SELLER_EVIDENCE' || a === 'REQUEST_BUYER_EVIDENCE';
const partyOf = (a: ActionValue) => (a === 'REQUEST_SELLER_EVIDENCE' ? 'seller' : 'buyer');

export interface ActionResult { message: string; env: string; audit: string }

const HINTS: Record<string, string> = {
  OPEN: 'Nobody has been asked for anything yet. Most cases start by asking the seller and the buyer for their side.',
  WAITING_FOR_SELLER_RESPONSE: 'Waiting on the seller. You can ask more, or decide with what you have.',
  WAITING_FOR_BUYER_RESPONSE: 'Waiting on the buyer. You can ask more, or decide with what you have.',
  WAITING_FOR_BOTH_RESPONSES: 'Waiting on the seller and the buyer. You can ask more, or decide with what you have.',
  UNDER_REVIEW: 'All requested evidence is in. Review it, then decide.',
};

/** Where the case stands, in a sentence. One concrete document on file is enough to decide, so say so. */
function hintFor(status: string, onFile: number): string | undefined {
  if (status === 'UNDER_REVIEW') return HINTS.UNDER_REVIEW;
  if (onFile > 0 && HINTS[status]) {
    const wait = status.startsWith('WAITING') ? ' You can also wait for the reply.' : '';
    return `${onFile} piece${onFile === 1 ? '' : 's'} of evidence on file. That's enough to decide now, or you can ask for more.${wait}`;
  }
  return HINTS[status];
}

/**
 * One message PayPal might send: its evidence checklist (for requests), its draft, and the investigator's edits to it.
 * The wizard holds one of these per possible action, so asking the seller and the buyer together keeps them independent.
 */
function useActionDraft({ disputeId, action, active, step, open, days, choices }: {
  disputeId: string; action: ActionValue; active: boolean; step: number; open: boolean; days: number; choices?: EvidenceRequestOption[];
}) {
  const toast = useToast();
  const request = isRequest(action);
  const [picked, setPicked] = useState<string[] | undefined>();
  const [edit, setEdit] = useState<string | undefined>();
  useEffect(() => { if (open) { setPicked(undefined); setEdit(undefined); } }, [open]);

  // First time on a request, start from what the case is missing; after that, keep what the investigator picked.
  const chosen: string[] = picked ?? choices?.filter((o) => o.suggested).map((o) => o.evidence_type) ?? [];
  // A hand-edited message can no longer match the selection once the list or deadline changes, so rebuild it and say so.
  const resetForChange = () => { if (edit !== undefined) { setEdit(undefined); toast('info', 'The list changed, so the message was rebuilt.'); } };
  const toggle = (t: string) => { resetForChange(); setPicked(chosen.includes(t) ? chosen.filter((x) => x !== t) : [...chosen, t]); };

  const draft = useQuery({
    queryKey: ['actionDraft', disputeId, action, request ? [...chosen].sort().join(',') : '', request ? days : 0],
    queryFn: () => draftActionMessage(disputeId, { action_type: action, requested_evidence: request ? chosen : undefined, deadline_days: request ? days : undefined }),
    enabled: open && active && step >= 1 && (!request || !!choices),
    staleTime: 60_000,
    placeholderData: keepPreviousData, // keep showing the last draft while a new one loads, so the box doesn't flicker away
  });
  // While a new draft loads we may be holding the previous one. Never treat it as this action's message.
  const holdingOther = !!draft.data && draft.data.action_type !== action;
  const loading = draft.isLoading || draft.isPlaceholderData || holdingOther;
  const message = edit ?? (draft.data && !holdingOther ? draft.data.body : '');

  return { action, request, chosen, toggle, draft, loading, message, edit, setEdit, resetEdit: () => setEdit(undefined), resetForChange, choicesReady: !request || !!choices };
}
type Slot = ReturnType<typeof useActionDraft>;

function useActionPreview({ disputeId, slot, active, enabled, open, days, notes }: {
  disputeId: string; slot: Slot; active: boolean; enabled: boolean; open: boolean; days: number; notes: string;
}) {
  return useQuery({
    queryKey: ['actionPreview', disputeId, slot.action, slot.request ? slot.chosen.length : 0, slot.request ? days : 0],
    queryFn: () => previewAction(disputeId, { action_type: slot.action, notes, requested_evidence: slot.request ? slot.chosen : undefined, deadline_days: slot.request ? days : undefined }),
    enabled: open && active && enabled,
    staleTime: 0,
  });
}

/** Before deciding: the facts on the case, sorted by who they help. Deliberately not a verdict. */
function BalancePanel({ balance }: { balance: EvidenceBalance }) {
  const column = (title: string, items: string[], icon: React.ReactNode, tone: string) => (
    <div>
      <h4 className={cn('mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider', tone)}>{icon}{title} <span className="font-normal text-muted">({items.length})</span></h4>
      {items.length ? (
        <ul className="space-y-1.5">{items.map((t) => <li key={t} className="flex gap-2 text-[13px] text-slate-200"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />{t}</li>)}</ul>
      ) : <p className="text-[13px] text-muted">Nothing on this side.</p>}
    </div>
  );
  return (
    <section aria-label="How the evidence stacks up" className="rounded-xl border border-line bg-raised/40 p-4">
      <h3 className="text-sm font-semibold text-white">How the evidence stacks up</h3>
      <p className="mt-0.5 text-xs text-muted">Facts from the records, sorted by who they help. It isn't a verdict. The call is yours.</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {column('Toward the buyer', balance.toward_buyer, <ThumbsUp className="h-3.5 w-3.5" />, 'text-amber-300')}
        {column('Toward the seller', balance.toward_seller, <ThumbsDown className="h-3.5 w-3.5" />, 'text-emerald-300')}
      </div>
      {balance.other.length > 0 && <p className="mt-3 border-t border-line pt-3 text-xs text-muted">Also on file: {balance.other.join(', ')}</p>}
    </section>
  );
}

export function ActionWizard({ open, onClose, disputeId, onJumpToRecord, onDone }: {
  open: boolean; onClose: () => void; disputeId: string;
  onJumpToRecord: (id: string) => void; onDone: (r: ActionResult) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  // Asking can be combined (seller and buyer together). A decision stands alone, because it closes the case.
  const [selected, setSelected] = useState<ActionValue[]>(['REQUEST_SELLER_EVIDENCE']);
  const [days, setDays] = useState(5);
  const [notes, setNotes] = useState('');
  const [reviewed, setReviewed] = useState(false);

  useEffect(() => { if (open) { setStep(0); setSelected(['REQUEST_SELLER_EVIDENCE']); setDays(5); setNotes(''); setReviewed(false); } }, [open]);

  const wantsSeller = selected.includes('REQUEST_SELLER_EVIDENCE');
  const wantsBuyer = selected.includes('REQUEST_BUYER_EVIDENCE');
  const decision = selected.find((a) => !isRequest(a)) ?? null;

  const detail = useQuery({ queryKey: ['disputeDetail', disputeId], queryFn: () => fetchDisputeDetail(disputeId), enabled: open });
  const options = useQuery({ queryKey: ['evidenceOptions', disputeId], queryFn: () => fetchEvidenceOptions(disputeId), enabled: open && (wantsSeller || wantsBuyer) });

  const base = { disputeId, step, open, days };
  const seller = useActionDraft({ ...base, action: 'REQUEST_SELLER_EVIDENCE', active: wantsSeller, choices: options.data?.seller });
  const buyer = useActionDraft({ ...base, action: 'REQUEST_BUYER_EVIDENCE', active: wantsBuyer, choices: options.data?.buyer });
  const decide = useActionDraft({ ...base, action: decision ?? 'DECIDE_FOR_BUYER', active: !!decision });

  const slots: Slot[] = decision ? [decide] : [...(wantsSeller ? [seller] : []), ...(wantsBuyer ? [buyer] : [])];
  const multi = slots.length > 1;
  const steps = decision ? DECISION_STEPS : STEPS;
  const lastStep = steps.length - 1;

  // A decision is previewed on its single step. A request is previewed on the last of its three.
  const previewStep = decision ? 1 : 2;
  const previewSeller = useActionPreview({ disputeId, slot: seller, active: wantsSeller && !decision, enabled: step === previewStep, open, days, notes });
  const previewBuyer = useActionPreview({ disputeId, slot: buyer, active: wantsBuyer && !decision, enabled: step === previewStep, open, days, notes });
  const previewDecide = useActionPreview({ disputeId, slot: decide, active: !!decision, enabled: step === previewStep, open, days, notes });
  const previews = decision ? [previewDecide] : [...(wantsSeller ? [previewSeller] : []), ...(wantsBuyer ? [previewBuyer] : [])];

  const execute = useMutation({
    mutationFn: async () => {
      const done: ActionExecuteResult[] = [];
      for (const s of slots) {
        try {
          done.push(await executeAction(disputeId, {
            action_type: s.action, confirmed: true, message: s.message, subject: s.draft.data?.subject, notes,
            requested_evidence: s.request ? s.chosen : undefined, deadline_days: s.request ? days : undefined,
          }));
        } catch (e) {
          // Don't hide that the first one already went out.
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
  const invalidate = () => ['disputeDetail', 'disputeTimeline', 'dashboardSummary', 'disputes', 'urgentDisputes', 'auditEvents', 'messageThreads', 'disputeMessages', 'evidenceOptions']
    .forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));

  const pick = (a: ActionValue) => setSelected((cur) => {
    if (!isRequest(a)) return [a];                        // choosing a decision replaces everything
    const asks = cur.filter(isRequest);                   // choosing to ask drops any decision
    if (asks.includes(a)) return asks.length > 1 ? asks.filter((x) => x !== a) : asks; // always keep at least one
    return ACTIONS.map((x) => x.value).filter((v) => isRequest(v) && (asks.includes(v) || v === a)); // stable order: seller, then buyer
  });
  const changeDays = (d: number) => { slots.forEach((s) => s.resetForChange()); setDays(d); };

  const onFileCount = detail.data?.evidence_items.filter((e) => e.availability_status === 'AVAILABLE').length ?? 0;
  const hint = detail.data ? hintFor(detail.data.status, onFileCount) : undefined;
  const canContinue = step === 0 || (step === 1 && slots.every((s) => s.choicesReady && !s.loading && !!s.message.trim() && (!s.request || s.chosen.length > 0)));
  const previewsOk = previews.every((p) => !!p.data?.is_supported && !p.isLoading);
  const canSend = previewsOk && (!decision || (reviewed && !!decide.message.trim() && !decide.loading));

  const nextLabel = step === 0 ? (decision ? 'Next: review decision' : multi ? 'Next: write messages' : 'Next: write message') : 'Next: review';
  const footer = (
    <>
      {step > 0 ? <Button onClick={() => setStep(step - 1)} className="mr-auto"><ArrowLeft className="h-4 w-4" />Back</Button> : <span className="mr-auto" />}
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      {step < lastStep ? (
        <Button variant="primary" disabled={!canContinue} onClick={() => setStep(step + 1)}>{nextLabel}<ArrowRight className="h-4 w-4" /></Button>
      ) : (
        <Button variant={decision ? 'danger' : 'primary'} loading={execute.isPending} disabled={!canSend} onClick={() => execute.mutate()}>
          {decision ? <Gavel className="h-4 w-4" /> : <Send className="h-4 w-4" />}
          {decision ? 'Confirm decision' : multi ? `Send ${slots.length} requests` : 'Send request'}
        </Button>
      )}
    </>
  );

  const card = (a: (typeof ACTIONS)[number]) => {
    const active = selected.includes(a.value);
    const ask = isRequest(a.value);
    return (
      <button
        key={a.value} role={ask ? 'checkbox' : 'radio'} aria-checked={active} onClick={() => pick(a.value)}
        className={cn('relative flex items-start gap-3 rounded-xl border p-4 text-left transition', active ? 'border-brand bg-brand/10' : 'border-line bg-raised/40 hover:border-line-strong')}
      >
        <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', active ? 'bg-brand text-white' : 'bg-white/5 text-muted')}><a.icon className="h-[18px] w-[18px]" /></span>
        <span className="pr-6">
          <span className="block text-sm font-medium text-white">{a.label}</span>
          <span className="mt-0.5 block text-xs text-muted">{a.hint}</span>
        </span>
        {/* Asking is a tick box (pick several). Deciding is a round dot (pick one). */}
        <span aria-hidden className={cn('absolute right-3 top-3 grid h-5 w-5 place-items-center border text-white', ask ? 'rounded-md' : 'rounded-full', active ? 'border-brand bg-brand' : 'border-line-strong')}>
          {active && (ask ? <Check className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-white" />)}
        </span>
      </button>
    );
  };

  const checklist = (s: Slot) => {
    const party = partyOf(s.action);
    return (
      <section aria-label={multi ? `What to ask the ${party} for` : 'What to ask for'} className="rounded-xl border border-brand/25 bg-brand/[.06] p-4">
        <h3 className="text-sm font-semibold text-white">What do you need from the {party}?</h3>
        <p className="mt-0.5 text-xs text-muted">Pick what to ask for. Items already on file are marked.</p>
        {!options.data ? <Skeleton className="mt-3 h-24" /> : (
          <ul className="mt-3 space-y-2">
            {(party === 'seller' ? options.data.seller : options.data.buyer).map((o) => {
              const on = s.chosen.includes(o.evidence_type);
              return (
                <li key={o.evidence_type}>
                  <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition', on ? 'border-brand/50 bg-brand/10' : 'border-line bg-raised/40 hover:border-line-strong')}>
                    <input type="checkbox" checked={on} onChange={() => s.toggle(o.evidence_type)} aria-label={multi ? `${o.label} (${party})` : o.label} className="mt-1 h-4 w-4 accent-[#6D7CFF]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-white">
                        {o.label}
                        {o.on_file && <Badge tone="success">On file</Badge>}
                        {!o.on_file && o.suggested && <Badge tone="warn">Missing</Badge>}
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
    const party = s.request ? partyOf(s.action) : null;
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
    <Modal open={open} onClose={onClose} size="lg" title="Take action" footer={footer}>
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
          <div>
            <h3 className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted">
              Ask for evidence <span className="font-normal normal-case tracking-normal">Pick one or both</span>
            </h3>
            <div role="group" aria-label="Ask for evidence" className="grid gap-3 sm:grid-cols-2">{ACTIONS.filter((a) => a.group === 'ask').map(card)}</div>
          </div>
          <div>
            <h3 className="mb-2 flex items-baseline justify-between text-xs font-semibold uppercase tracking-wider text-muted">
              Make the call <span className="font-normal normal-case tracking-normal">Pick one. It closes the case</span>
            </h3>
            <div role="radiogroup" aria-label="Make the call" className="grid gap-3 sm:grid-cols-2">{ACTIONS.filter((a) => a.group === 'decide').map(card)}</div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5 animate-fade-in">
          {!decision && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{multi ? 'Both messages use the same reply deadline.' : 'Set how long they have to reply.'}</p>
              <div className="w-56 shrink-0">
                <Select aria-label="Reply within" value={days} onChange={(e) => changeDays(Number(e.target.value))} className="py-1.5 text-[13px]">
                  {[2, 3, 5, 7, 10].map((d) => <option key={d} value={d}>Reply within {d} days</option>)}
                </Select>
              </div>
            </div>
          )}

          {slots.map((s) => (
            <div key={s.action} className={cn('space-y-4', multi && 'rounded-2xl border border-line p-4')}>
              {multi && <h3 className="flex items-center gap-2 text-sm font-semibold text-white">{s.action === 'REQUEST_SELLER_EVIDENCE' ? <Store className="h-4 w-4 text-brand-soft" /> : <User className="h-4 w-4 text-brand-soft" />}To the {partyOf(s.action)}</h3>}
              {s.request && checklist(s)}
              {!s.request && s.draft.data?.evidence_balance && s.draft.data.action_type === s.action && <BalancePanel balance={s.draft.data.evidence_balance} />}
              {draftBox(s)}
            </div>
          ))}

          <Field label="Internal note (optional)">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Only visible to your team. Why this action?" />
          </Field>

          {/* A decision is confirmed right here, so it takes two steps instead of three. */}
          {decision && (
            <section aria-label="Confirm decision" className="space-y-3 border-t border-line pt-4">
              {previewDecide.isLoading ? <Skeleton className="h-10" /> : previewDecide.data && (
                <>
                  <p className="text-sm text-slate-300"><span className="font-medium text-white">What happens: </span>{previewDecide.data.impact_summary}</p>
                  {!previewDecide.data.is_supported && previewDecide.data.warning_message && (
                    <p className="flex gap-2 text-sm text-rose-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{previewDecide.data.warning_message}</p>
                  )}
                </>
              )}
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-raised/40 p-3 text-sm text-slate-200">
                <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#6D7CFF]" />
                <span>I've reviewed the evidence on file and I'm making this decision.</span>
              </label>
            </section>
          )}
        </div>
      )}

      {step === 2 && !decision && (
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
