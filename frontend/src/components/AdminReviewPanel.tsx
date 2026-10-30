import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { adminReview } from '../api/client';
import { DisputeSummary } from '../types';
import { Badge, Button, Field, Textarea, useToast } from './ui/kit';
import { EvidenceChecklist } from './EvidenceChecklist';
import { cn, outcomeMeta, parseServerDate } from '../lib/format';
import { useCurrentUser } from '../lib/user';

type Mode = 'idle' | 'override' | 'reopen';
const KEYS = ['disputes', 'urgentDisputes', 'dashboardSummary', 'disputeDetail', 'disputeTimeline', 'messageThreads', 'disputeMessages', 'auditEvents'];

/**
 * An admin's view of one case: what the investigator decided and why, the evidence behind it,
 * and the three things an admin can do: confirm it, decide differently, or send it back.
 */
export function AdminReviewPanel({ dispute, showEvidence = true }: { dispute: DisputeSummary; showEvidence?: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const [mode, setMode] = useState<Mode>('idle');
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<'BUYER_FAVOR' | 'SELLER_FAVOR'>(dispute.proposed_outcome === 'BUYER_FAVOR' ? 'SELLER_FAVOR' : 'BUYER_FAVOR');

  const pending = dispute.status === 'PENDING_ADMIN_REVIEW';
  const proposed = outcomeMeta(dispute.proposed_outcome);

  const review = useMutation({
    mutationFn: (action: 'APPROVE' | 'OVERRIDE' | 'REOPEN') => adminReview(dispute.id, {
      action, reviewer: user.name, note: note.trim() || undefined, outcome: action === 'OVERRIDE' ? outcome : undefined,
    }),
    onSuccess: (r) => { toast('success', r.message); setMode('idle'); setNote(''); KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
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
        </section>
      )}

      {showEvidence && <EvidenceChecklist disputeId={dispute.id} title="Evidence the decision rests on" />}

      {pending && (
        <section aria-label="Admin actions" className="space-y-3 border-t border-line pt-4">
          {mode === 'idle' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" loading={review.isPending && review.variables === 'APPROVE'} onClick={() => review.mutate('APPROVE')}>
                <Check className="h-4 w-4" />Confirm decision
              </Button>
              <Button onClick={() => setMode('override')}>Decide differently</Button>
              <Button variant="ghost" onClick={() => setMode('reopen')}><RotateCcw className="h-4 w-4" />Send back</Button>
              <p className="basis-full text-xs text-muted">Confirming tells the seller and the buyer. Nothing is sent before then.</p>
            </div>
          ) : (
            <div className="space-y-3 animate-fade-in">
              {mode === 'override' && (
                <div role="radiogroup" aria-label="Your decision" className="grid gap-2 sm:grid-cols-2">
                  {([['BUYER_FAVOR', "Buyer's favor", ThumbsUp], ['SELLER_FAVOR', "Seller's favor", ThumbsDown]] as const).map(([value, label, Icon]) => (
                    <button
                      key={value} role="radio" aria-checked={outcome === value} onClick={() => setOutcome(value)}
                      className={cn('flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm font-medium transition', outcome === value ? 'border-brand bg-brand/10 text-white' : 'border-line text-slate-300 hover:border-line-strong')}
                    >
                      <Icon className="h-4 w-4" />{label}
                    </button>
                  ))}
                </div>
              )}
              <Field label={mode === 'override' ? 'Why are you replacing the investigator’s decision?' : 'What needs fixing?'}>
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Admin note" placeholder={mode === 'override' ? 'The footage clearly shows no delivery.' : 'The address check is missing. Ask the seller before deciding.'} />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary" loading={review.isPending} disabled={!note.trim()}
                  onClick={() => review.mutate(mode === 'override' ? 'OVERRIDE' : 'REOPEN')}
                >
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

/** Reopen a case that was already decided. The admin says why, and it returns to the investigator. */
export function ReopenButton({ dispute }: { dispute: DisputeSummary }) {
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const reopen = useMutation({
    mutationFn: () => adminReview(dispute.id, { action: 'REOPEN', reviewer: user.name, note: note.trim() }),
    onSuccess: (r) => { toast('success', r.message); setAsking(false); setNote(''); KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => toast('error', e.message),
  });
  if (!asking) return <Button size="sm" variant="ghost" onClick={() => setAsking(true)}><RotateCcw className="h-3.5 w-3.5" />Reopen</Button>;
  return (
    <div className="flex w-full flex-col gap-2 sm:w-80">
      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label={`Why reopen ${dispute.id}`} placeholder="Why is this being reopened?" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" loading={reopen.isPending} disabled={!note.trim()} onClick={() => reopen.mutate()}>Reopen case</Button>
        <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
      </div>
    </div>
  );
}
