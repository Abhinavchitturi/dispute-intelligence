import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Handshake, Inbox, LogOut, Mail, Paperclip, Play, Store, User } from 'lucide-react';
import { declareFromParty, fetchDisputeDetail, fetchDisputeMessages, markMessagesRead, recordReply, simulateEmailReply, simulateReply } from '../api/client';
import { DisputeMessage } from '../types';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, useToast } from './ui/kit';
import { EvidenceChecklist } from './EvidenceChecklist';
import { cn, evidenceLabel, outcomeMeta, outcomeText, parseServerDate, timeAgo } from '../lib/format';
import { useNow } from '../lib/hooks';

type Party = 'SELLER' | 'BUYER';
const PARTY_NAME: Record<Party, string> = { SELLER: 'Seller', BUYER: 'Buyer' };
const REFRESH_KEYS = ['messageThreads', 'disputeDetail', 'disputeTimeline', 'dashboardSummary', 'disputes', 'urgentDisputes', 'auditEvents', 'evidenceSummary'];
const isDecision = (m: DisputeMessage) => m.action_type === 'DECIDE_FOR_BUYER' || m.action_type === 'DECIDE_FOR_SELLER';
/** Sent to both sides with the same words: a decision, or PayPal closing a settled or dismissed case. */
const isBroadcast = (m: DisputeMessage) => isDecision(m) || m.action_type === 'DISPUTE_SETTLED' || m.action_type === 'DISPUTE_DISMISSED';

/**
 * An emailed reply, waiting to be gone through. The seller and buyer aren't on this app, so a person at PayPal ticks
 * which of the documents that were asked for actually came with the email. Whatever isn't ticked is recorded as not sent.
 */
function RecordReplyPanel({ disputeId, reply, asked, onDone }: { disputeId: string; reply: DisputeMessage; asked: string[]; onDone: () => void }) {
  const toast = useToast();
  const [got, setGot] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => recordReply(disputeId, reply.id, asked.filter((t) => got[t]).map((t) => ({ evidence_type: t, file_name: file[t]?.trim() || undefined }))),
    onSuccess: (r) => { toast('success', r.provided_evidence.length ? `Recorded ${r.provided_evidence.length} of ${asked.length} items.` : 'Recorded. Nothing came with it.'); onDone(); },
    onError: (e: Error) => toast('error', e.message),
  });
  const n = asked.filter((t) => got[t]).length;
  return (
    <section aria-label="Record what they sent" className="mt-3 rounded-xl border border-brand/30 bg-brand/[.07] p-3">
      <h5 className="text-[13px] font-semibold text-white">What did they send?</h5>
      <p className="mt-0.5 text-xs text-muted">Open the attachments, then tick what actually arrived. Anything unticked is recorded as not sent.</p>
      <ul className="mt-2 space-y-2">
        {asked.map((t) => (
          <li key={t} className="rounded-lg bg-black/20 px-2.5 py-2">
            <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-slate-200">
              <input type="checkbox" checked={!!got[t]} onChange={(e) => setGot({ ...got, [t]: e.target.checked })} aria-label={evidenceLabel(t)} className="h-4 w-4 accent-[#0A84FF]" />
              {evidenceLabel(t)}
            </label>
            {got[t] && (
              <div className="mt-2 pl-6">
                <Input list={`files-${reply.id}`} value={file[t] ?? ''} onChange={(e) => setFile({ ...file, [t]: e.target.value })} placeholder="File name (optional)" aria-label={`File for ${evidenceLabel(t)}`} className="py-1.5 text-[13px]" />
              </div>
            )}
          </li>
        ))}
      </ul>
      <datalist id={`files-${reply.id}`}>{(reply.attachments ?? []).map((a) => <option key={a} value={a} />)}</datalist>
      <Button size="sm" variant="primary" className="mt-3" loading={save.isPending} onClick={() => save.mutate()}>{n ? `Record ${n} of ${asked.length}` : 'Record: nothing came'}</Button>
    </section>
  );
}

/** A message goes into one party's chat, so a decision (sent to both) appears in both. */
function chatFor(messages: DisputeMessage[], party: Party) {
  return messages.filter((m) => m.counterparty === party);
}

/** The seller and the buyer each have their own conversation with PayPal, shown side by side. */
export function MessageThread({ disputeId, disputeStatus, outcome, onTakeAction }: {
  disputeId: string; disputeStatus?: string; outcome?: string | null; onTakeAction?: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const now = useNow(1000);
  const [fresh, setFresh] = useState<Set<string>>(new Set()); // replies that arrived unread, kept highlighted while this view is open
  const marked = useRef<Set<string>>(new Set());

  const { data: messages, isLoading, isError, refetch } = useQuery({
    queryKey: ['disputeMessages', disputeId],
    queryFn: () => fetchDisputeMessages(disputeId),
    // While a simulated reply is pending, poll quickly so it appears by itself the moment it's due.
    refetchInterval: (q) => (q.state.data?.some((m) => m.awaiting_reply && m.reply_due_at) ? 3000 : 30_000),
  });
  const detail = useQuery({ queryKey: ['disputeDetail', disputeId], queryFn: () => fetchDisputeDetail(disputeId) });

  // Opening the conversation counts as reading it.
  useEffect(() => {
    const unread = (messages ?? []).filter((m) => m.direction === 'INBOUND' && !m.is_read && !marked.current.has(m.id));
    if (!unread.length) return;
    unread.forEach((m) => marked.current.add(m.id));
    setFresh((f) => new Set([...f, ...unread.map((m) => m.id)]));
    markMessagesRead(disputeId).then(() => qc.invalidateQueries({ queryKey: ['messageThreads'] })).catch(() => undefined);
  }, [messages, disputeId, qc]);

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['disputeMessages', disputeId] });
    REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const simulate = useMutation({
    mutationFn: (id: string) => simulateReply(id),
    onSuccess: (reply) => { toast('info', `The ${PARTY_NAME[reply.counterparty].toLowerCase()} replied.`); refreshAll(); },
    onError: (e: Error) => toast('error', e.message),
  });
  const emailReply = useMutation({
    mutationFn: (party: Party) => simulateEmailReply(disputeId, party, 'Hello, the documents you asked for are attached.', ['documents.pdf']),
    onSuccess: () => { toast('info', 'An email reply arrived. Go through what came with it.'); refreshAll(); },
    onError: (e: Error) => toast('error', e.message),
  });
  const declare = useMutation({
    mutationFn: (v: { party: Party; kind: 'SETTLED' | 'WITHDRAWN' }) => declareFromParty(disputeId, v.party, v.kind),
    onSuccess: (_m, v) => { toast('info', v.kind === 'WITHDRAWN' ? 'The buyer withdrew the claim.' : `The ${PARTY_NAME[v.party].toLowerCase()} says it is settled.`); refreshAll(); },
    onError: (e: Error) => toast('error', e.message),
  });

  if (isLoading) return <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  if (isError) return <ErrorState message="Couldn't load the conversation." onRetry={() => refetch()} />;
  if (!messages?.length) {
    return <EmptyState icon={<Inbox className="h-6 w-6" />} title="No messages yet" hint="When you ask the seller or the buyer for evidence, your message and their replies show up here." />;
  }

  const pending = messages.filter((m) => m.direction === 'OUTBOUND' && m.awaiting_reply);
  const decided = disputeStatus === 'RESOLVED' || disputeStatus === 'CLOSED';
  const inReview = disputeStatus === 'PENDING_AI_REVIEW';
  // Ready to decide once BOTH sides have answered (or time is up). The server works that out and says so in the status.
  const ready = !pending.length && !decided && !inReview && disputeStatus === 'UNDER_REVIEW';
  const result = outcomeMeta(outcome);
  const d = detail.data;
  const sellerSettled = !!d?.seller_settled_at;
  const buyerSettled = !!d?.buyer_settled_at;

  const column = (party: Party) => {
    const mine = chatFor(messages, party);
    const waitingOn = pending.filter((m) => m.counterparty === party);
    const Icon = party === 'SELLER' ? Store : User;
    const said = party === 'SELLER' ? sellerSettled : buyerSettled;
    const who = PARTY_NAME[party].toLowerCase();
    const canSimulate = !decided && d?.source === 'synthetic';
    return (
      <section key={party} aria-label={`${PARTY_NAME[party]} chat`} className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/[.06] text-brand-soft"><Icon className="h-4 w-4" /></span>
            <div className="leading-tight">
              <h3 className="text-[15px] font-semibold text-white">{PARTY_NAME[party]}</h3>
              <p className="text-xs text-muted">{party === 'SELLER' ? d?.merchant_reference ?? 'Seller' : d?.buyer_reference ?? 'Buyer'}</p>
            </div>
          </div>
          {said && <Badge tone="info" dot>Says it's settled</Badge>}
        </header>

        <ol className="flex-1 space-y-3 p-4" aria-label={`${PARTY_NAME[party]} conversation`}>
          {mine.length === 0 && (
            <li className="py-6 text-center text-[13px] text-muted">
              Nothing sent to the {who} yet.
              <span className="mt-1 block text-xs">The {who} isn't on this app. Requests go to them by email, and their replies come back here.</span>
            </li>
          )}
          {mine.map((m) => {
            const out = m.direction === 'OUTBOUND';
            const broadcast = isBroadcast(m);
            return (
              <li key={m.id} className={cn('flex animate-fade-in', out ? 'justify-end' : 'justify-start')}>
                <article className={cn(
                  'w-full max-w-[94%] rounded-2xl border p-3.5',
                  broadcast ? 'border-amber-400/30 bg-amber-400/[.06]' : out ? 'border-brand/30 bg-brand/[.09]' : 'border-line bg-raised/60',
                )}>
                  <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <span className="font-medium text-slate-200">{out ? 'PayPal' : PARTY_NAME[party]}</span>
                    {isDecision(m) && <Badge tone="warn">Decision</Badge>}
                    {!out && m.source === 'synthetic' && <Badge tone="violet">Simulated</Badge>}
                    {!out && m.source === 'email' && <Badge tone="info"><Mail className="h-3 w-3" />Email reply</Badge>}
                    {fresh.has(m.id) && <Badge tone="brand">New</Badge>}
                    <span title={parseServerDate(m.created_at).toLocaleString()}>· {timeAgo(m.created_at, now)}</span>
                  </header>
                  <h4 className="mt-1.5 text-sm font-semibold text-white">{m.subject}</h4>
                  <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">{m.body}</p>
                  {out && m.requested_evidence.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted">Asked for</span>
                      {m.requested_evidence.map((t) => <Badge key={t}>{evidenceLabel(t)}</Badge>)}
                      {m.deadline && <span className="text-xs text-muted">· reply by {parseServerDate(m.deadline).toLocaleDateString()}</span>}
                    </div>
                  )}
                  {out && m.emailed_to && (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Mail aria-hidden className="h-3 w-3" />Emailed to <span className="text-slate-300">{m.emailed_to}</span>
                      {m.email_status === 'QUEUED' && <Badge>Kept here, not sent</Badge>}
                      {m.email_status === 'SENT' && <Badge tone="success">Sent</Badge>}
                      {m.email_status === 'FAILED' && <Badge tone="danger">Email failed</Badge>}
                    </p>
                  )}
                  {!out && (m.attachments?.length ?? 0) > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5"><Paperclip aria-hidden className="h-3 w-3 text-muted" />{m.attachments!.map((a) => <Badge key={a}>{a}</Badge>)}</div>
                  )}
                  {!out && m.needs_recording && <RecordReplyPanel disputeId={disputeId} reply={m} asked={messages.find((x) => x.id === m.in_reply_to)?.requested_evidence ?? []} onDone={refreshAll} />}
                  {!out && (m.provided_evidence.length > 0 || m.unavailable_evidence.length > 0) && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {m.provided_evidence.map((t) => <Badge key={t} tone="success">✓ {evidenceLabel(t)}</Badge>)}
                      {m.unavailable_evidence.map((t) => <Badge key={t} tone="danger">Couldn't provide: {evidenceLabel(t).toLowerCase()}</Badge>)}
                    </div>
                  )}
                </article>
              </li>
            );
          })}

          {waitingOn.map((p) => {
            const seconds = p.reply_due_at ? Math.max(0, Math.ceil((parseServerDate(p.reply_due_at).getTime() - now) / 1000)) : null;
            return (
              <li key={p.id} className="flex justify-start animate-fade-in" aria-live="polite">
                <div className="w-full max-w-[94%] rounded-2xl border border-dashed border-line-strong bg-surface p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-sm text-slate-300">
                      <span className="flex gap-1" aria-hidden>
                        {[0, 150, 300].map((delay) => <span key={delay} className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-soft" style={{ animationDelay: `${delay}ms` }} />)}
                      </span>
                      <span>
                        Waiting for the <span className="font-medium text-white">{who}</span> to reply
                        {seconds !== null && <span className="text-muted"> · {seconds > 0 ? `expected in ${seconds}s` : 'any moment now'}</span>}
                        {seconds === null && p.emailed_to && <span className="text-muted"> · by email</span>}
                      </span>
                    </div>
                    {p.source === 'synthetic' && (
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" loading={simulate.isPending && simulate.variables === p.id} onClick={() => simulate.mutate(p.id)}>
                          <Play className="h-3.5 w-3.5" />Simulate {who} reply
                        </Button>
                        <Button size="sm" variant="ghost" loading={emailReply.isPending && emailReply.variables === party} onClick={() => emailReply.mutate(party)} aria-label={`Simulate ${who} email reply`}>
                          <Mail className="h-3.5 w-3.5" />Simulate email reply
                        </Button>
                      </div>
                    )}
                  </div>
                  {p.source !== 'synthetic' && (
                    <p className="mt-2 text-xs text-muted">The {who} was emailed. Their reply arrives by email and shows up here for someone to go through.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {canSimulate && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3" aria-label={`Demo controls for the ${who}`}>
            <span className="text-xs text-muted">Demo:</span>
            <Button size="sm" variant="ghost" disabled={said || declare.isPending} onClick={() => declare.mutate({ party, kind: 'SETTLED' })}>
              <Handshake className="h-3.5 w-3.5" />{PARTY_NAME[party]} says settled
            </Button>
            {party === 'BUYER' && (
              <Button size="sm" variant="ghost" disabled={declare.isPending} onClick={() => declare.mutate({ party, kind: 'WITHDRAWN' })}>
                <LogOut className="h-3.5 w-3.5" />Buyer withdraws claim
              </Button>
            )}
          </footer>
        )}
      </section>
    );
  };

  const oneSideSettled = !decided && (sellerSettled !== buyerSettled);

  return (
    <div className="space-y-4">
      {oneSideSettled && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-sky-400/25 bg-sky-400/[.07] p-4 text-sm text-sky-100 animate-fade-in">
          <Handshake aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
          <span>
            <span className="font-medium">The {sellerSettled ? 'seller' : 'buyer'} says this was settled outside PayPal.</span>{' '}
            It is not settled until the {sellerSettled ? 'buyer' : 'seller'} confirms too. Until then the case continues.
          </span>
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">{column('SELLER')}{column('BUYER')}</div>

      {ready && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand/10 p-4 animate-fade-in">
          <div className="flex items-center gap-3 text-sm text-white">
            <Gavel className="h-5 w-5 text-brand-soft" />
            <span><span className="font-medium">The evidence is in.</span> Both sides have answered. Review it, then decide.</span>
          </div>
          {onTakeAction && <Button size="sm" variant="primary" onClick={onTakeAction}>Ready to decide</Button>}
        </div>
      )}

      {inReview && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-amber-400/25 bg-amber-400/[.07] p-4 text-sm text-amber-100 animate-fade-in">
          <Gavel className="h-5 w-5 shrink-0" />
          <span><span className="font-medium">With the AI reviewer.</span> The seller and the buyer are told once it has ruled.</span>
        </div>
      )}

      {decided && result && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200 animate-fade-in">
          <Gavel className="h-5 w-5" />
          <span>
            <span className="font-medium">{outcome === 'BUYER_FAVOR' || outcome === 'SELLER_FAVOR' ? `Decided in the ${result.label.toLowerCase()}.` : `${outcomeText(outcome)}.`}</span>{' '}
            The seller and the buyer have been told.
          </span>
        </div>
      )}

      <details className="group rounded-2xl border border-line bg-surface">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-white">Evidence from each side</summary>
        <div className="px-4 pb-4"><EvidenceChecklist disputeId={disputeId} sides={['seller', 'buyer']} /></div>
      </details>
    </div>
  );
}
