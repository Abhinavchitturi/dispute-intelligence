import React from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { DisputeDetail, DisputeMessage } from '../types';
import { cn, isClosed, outcomeMeta, outcomeText } from '../lib/format';
import { Card, Meter } from './ui/kit';

type StepState = 'done' | 'current' | 'todo';
export interface Step { key: string; label: string; detail: string; state: StepState; blocked?: boolean }

const REQUESTS = ['REQUEST_SELLER_EVIDENCE', 'REQUEST_BUYER_EVIDENCE'];

/** Where the case stands, from PayPal's side: filed, evidence asked for, evidence in, decided. Derived from real case data. */
export function computeProgress(d: DisputeDetail, messages: DisputeMessage[] | undefined) {
  const msgs = messages ?? [];
  const sent = msgs.filter((m) => m.direction === 'OUTBOUND' && REQUESTS.includes(m.action_type ?? ''));
  const pending = sent.filter((m) => m.awaiting_reply);
  const replies = msgs.filter((m) => m.direction === 'INBOUND');
  const requested = sent.length > 0;
  const decided = isClosed(d.status);
  const allIn = requested && pending.length === 0 && replies.length > 0;
  // One concrete document on file is enough to act on, so a case is only "blocked" when it has none at all.
  const onFile = d.evidence_items.filter((e) => e.availability_status === 'AVAILABLE').length;
  const blocked = !requested && !decided && onFile === 0 && (d.evidence_status === 'MISSING' || d.evidence_status === 'CONFLICTING');

  const waitingOn = (() => {
    const parties = new Set(pending.map((m) => m.counterparty));
    return parties.size === 2 ? 'the seller and the buyer' : parties.has('SELLER') ? 'the seller' : 'the buyer';
  })();
  const result = outcomeMeta(d.outcome);
  const judged = d.outcome === 'BUYER_FAVOR' || d.outcome === 'SELLER_FAVOR'; // a decision, as opposed to settled or dismissed
  const withAdmin = d.status === 'PENDING_ADMIN_REVIEW';

  // A decided case is finished. Some arrive already decided with nobody asked (decided from the records), and that's still complete.
  const flags = decided ? [true, true, true, true] : [true, requested, allIn, false];
  const firstOpen = flags.findIndex((f) => !f);
  const steps: Step[] = [
    { key: 'filed', label: 'Case filed', detail: 'Buyer opened the dispute' },
    { key: 'requested', label: 'Evidence requested', detail: requested ? `${sent.length} request${sent.length === 1 ? '' : 's'} sent` : decided ? 'Decided from the records' : 'Nobody asked yet' },
    { key: 'received', label: 'Evidence received', detail: pending.length && !decided ? `Waiting on ${waitingOn}` : allIn ? 'All replies in' : decided ? (requested ? 'Nothing left to wait for' : 'None needed') : 'Nothing to wait for yet' },
    { key: 'decided', label: 'Decision made', detail: decided ? (result ? (judged ? `In the ${result.label.toLowerCase()}` : result.label) : 'Closed') : withAdmin ? 'With an admin to confirm' : 'Your call' },
  ].map((s, i) => ({ ...s, state: (flags[i] ? 'done' : i === firstOpen ? 'current' : 'todo') as StepState, blocked: s.key === 'requested' && blocked }));

  // Done steps count fully. Evidence received counts half once some replies are in but others are still due.
  let score = flags.filter(Boolean).length;
  if (!flags[2] && replies.length > 0 && pending.length > 0) score += 0.5;
  const percent = Math.min(100, Math.round((score / flags.length) * 100));

  const next = decided ? (judged && result ? `Decided in the ${result.label.toLowerCase()}.` : `${outcomeText(d.outcome) ?? 'Closed'}.`)
    : withAdmin ? 'Next: an admin confirms your decision. Nobody is told until then.'
    : !requested && onFile > 0 ? `Next: decide with the ${onFile === 1 ? 'evidence' : `${onFile} pieces of evidence`} on file, or ask for more.`
    : !requested ? 'Next: ask the seller and the buyer for the evidence you need.'
    : pending.length ? `Next: wait for ${waitingOn} to reply, or decide with what you have.`
    : 'Next: review the evidence and decide.';
  return { steps, percent, next, pending: pending.length, replies: replies.length };
}

export function InvestigationProgress({ dispute, messages }: { dispute: DisputeDetail; messages?: DisputeMessage[] }) {
  const { steps, percent, next } = computeProgress(dispute, messages);
  const tone = percent >= 75 ? 'success' : percent >= 40 ? 'brand' : 'warn';

  return (
    <Card className="p-6" aria-label="Investigation progress">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Investigation progress</h2>
          <p className="mt-0.5 text-[13px] text-muted">{next}</p>
        </div>
        <div className="text-right">
          <span className="text-3xl font-semibold text-white tabular">{percent}%</span>
          <span className="ml-1 text-[13px] text-muted">complete</span>
        </div>
      </div>

      <Meter value={percent} tone={tone} className="mt-4 h-2" />

      <ol className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 sm:block" aria-current={s.state === 'current' ? 'step' : undefined}>
            <div className="flex items-center sm:mb-3">
              <span
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-xs font-semibold transition',
                  s.state === 'done' && 'border-emerald-400 bg-emerald-400/15 text-emerald-300',
                  s.state === 'current' && !s.blocked && 'border-brand bg-brand/15 text-brand-soft shadow-[0_0_0_4px_rgba(109,124,255,.15)]',
                  s.state === 'current' && s.blocked && 'border-amber-400 bg-amber-400/15 text-amber-300 shadow-[0_0_0_4px_rgba(251,191,36,.12)]',
                  s.state === 'todo' && 'border-line-strong text-muted',
                )}
              >
                {s.state === 'done' ? <Check className="h-4 w-4" /> : s.blocked ? <AlertTriangle className="h-4 w-4" /> : i + 1}
              </span>
              {i < steps.length - 1 && (
                <span className={cn('ml-2 hidden h-0.5 flex-1 rounded-full sm:block', s.state === 'done' ? 'bg-emerald-400/60' : 'bg-line-strong')} />
              )}
            </div>
            <div>
              <div className={cn('text-sm font-medium', s.state === 'todo' ? 'text-muted' : 'text-white')}>{s.label}</div>
              <div className={cn('text-xs', s.blocked ? 'text-amber-300' : 'text-muted')}>{s.detail}</div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
