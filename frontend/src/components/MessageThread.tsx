import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, Inbox, Play } from 'lucide-react';
import { fetchDisputeMessages, markMessagesRead, simulateReply } from '../api/client';
import { DisputeMessage } from '../types';
import { Badge, Button, EmptyState, ErrorState, Skeleton, useToast } from './ui/kit';
import { cn, evidenceLabel, outcomeMeta, parseServerDate, timeAgo } from '../lib/format';
import { useNow } from '../lib/hooks';

const PARTY = { SELLER: 'Seller', BUYER: 'Buyer' } as const;
const REFRESH_KEYS = ['messageThreads', 'disputeDetail', 'disputeTimeline', 'dashboardSummary', 'disputes', 'urgentDisputes', 'auditEvents'];
const isDecision = (m: DisputeMessage) => m.action_type === 'DECIDE_FOR_BUYER' || m.action_type === 'DECIDE_FOR_SELLER';

/** A decision is sent once to each side with the same text. Show it as one entry addressed to both. */
function foldDecisions(messages: DisputeMessage[]) {
  return messages.filter((m, i) => !(isDecision(m) && messages.findIndex((x) => isDecision(x) && x.created_at === m.created_at && x.body === m.body) !== i));
}

/** The conversation PayPal is having with the seller and the buyer about one dispute. */
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

  // Opening the conversation counts as reading it.
  useEffect(() => {
    const unread = (messages ?? []).filter((m) => m.direction === 'INBOUND' && !m.is_read && !marked.current.has(m.id));
    if (!unread.length) return;
    unread.forEach((m) => marked.current.add(m.id));
    setFresh((f) => new Set([...f, ...unread.map((m) => m.id)]));
    markMessagesRead(disputeId).then(() => qc.invalidateQueries({ queryKey: ['messageThreads'] })).catch(() => undefined);
  }, [messages, disputeId, qc]);

  const simulate = useMutation({
    mutationFn: (id: string) => simulateReply(id),
    onSuccess: (reply) => {
      toast('info', `The ${PARTY[reply.counterparty].toLowerCase()} replied.`);
      qc.invalidateQueries({ queryKey: ['disputeMessages', disputeId] });
      REFRESH_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: Error) => toast('error', e.message),
  });

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-28" /><Skeleton className="h-28" /></div>;
  if (isError) return <ErrorState message="Couldn't load the conversation." onRetry={() => refetch()} />;
  if (!messages?.length) {
    return <EmptyState icon={<Inbox className="h-6 w-6" />} title="No messages yet" hint="When you ask the seller or the buyer for evidence, your message and their replies show up here." />;
  }

  const pending = messages.filter((m) => m.direction === 'OUTBOUND' && m.awaiting_reply);
  const decided = disputeStatus === 'RESOLVED' || disputeStatus === 'CLOSED';
  const ready = !pending.length && !decided && messages[messages.length - 1].direction === 'INBOUND';
  const result = outcomeMeta(outcome);

  return (
    <div className="space-y-4">
      <ol className="space-y-4" aria-label="Conversation">
        {foldDecisions(messages).map((m) => {
          const out = m.direction === 'OUTBOUND';
          const decision = isDecision(m);
          const who = decision ? 'Seller and buyer' : PARTY[m.counterparty];
          return (
            // Chat layout: what they send on the left, what PayPal sends on the right. A decision goes to both, so it sits in the middle.
            <li key={m.id} className={cn('flex animate-fade-in', decision ? 'justify-center' : out ? 'justify-end' : 'justify-start')}>
              <article className={cn('w-full rounded-2xl border p-4', decision ? 'max-w-[92%] md:max-w-[80%]' : 'max-w-[92%] md:max-w-[70%]', decision ? 'border-amber-400/30 bg-amber-400/[.06]' : out ? 'border-brand/30 bg-brand/[.08]' : 'border-line bg-raised/60')}>
                <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="font-medium text-slate-200">{out ? `You → ${who}` : `${who} → You`}</span>
                  {decision && <Badge tone="warn">Decision</Badge>}
                  {!out && m.source === 'synthetic' && <Badge tone="violet">Simulated reply</Badge>}
                  {fresh.has(m.id) && <Badge tone="brand">New</Badge>}
                  <span title={parseServerDate(m.created_at).toLocaleString()}>· {timeAgo(m.created_at, now)}</span>
                </header>
                <h3 className="mt-1.5 text-sm font-semibold text-white">{m.subject}</h3>
                <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">{m.body}</p>

                {out && m.requested_evidence.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted">Asked for</span>
                    {m.requested_evidence.map((t) => <Badge key={t}>{evidenceLabel(t)}</Badge>)}
                    {m.deadline && <span className="text-xs text-muted">· reply by {parseServerDate(m.deadline).toLocaleDateString()}</span>}
                  </div>
                )}
                {!out && (m.provided_evidence.length > 0 || m.unavailable_evidence.length > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {m.provided_evidence.map((t) => <Badge key={t} tone="success">✓ {evidenceLabel(t)}</Badge>)}
                    {m.unavailable_evidence.map((t) => <Badge key={t} tone="warn">Couldn't provide: {evidenceLabel(t).toLowerCase()}</Badge>)}
                  </div>
                )}
              </article>
            </li>
          );
        })}

        {pending.map((p) => {
          const seconds = p.reply_due_at ? Math.max(0, Math.ceil((parseServerDate(p.reply_due_at).getTime() - now) / 1000)) : null;
          const who = PARTY[p.counterparty].toLowerCase();
          return (
            <li key={p.id} className="flex justify-start animate-fade-in" aria-live="polite">
              <div className="w-full max-w-[92%] rounded-2xl border border-dashed border-line-strong bg-surface p-4 md:max-w-[70%]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-sm text-slate-300">
                    <span className="flex gap-1" aria-hidden>
                      {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-soft" style={{ animationDelay: `${d}ms` }} />)}
                    </span>
                    <span>
                      Waiting for the <span className="font-medium text-white">{who}</span> to reply
                      {seconds !== null && <span className="text-muted"> · {seconds > 0 ? `expected in ${seconds}s` : 'any moment now'}</span>}
                    </span>
                  </div>
                  {p.source === 'synthetic' && (
                    <Button size="sm" loading={simulate.isPending && simulate.variables === p.id} onClick={() => simulate.mutate(p.id)}>
                      <Play className="h-3.5 w-3.5" />Simulate {who} reply
                    </Button>
                  )}
                </div>
                {p.source !== 'synthetic' && (
                  <p className="mt-2 text-xs text-muted">Replies from the {who} aren't synced into this app yet, so check the case in PayPal's system.</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {ready && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand/10 p-4 animate-fade-in">
          <div className="flex items-center gap-3 text-sm text-white">
            <Gavel className="h-5 w-5 text-brand-soft" />
            <span><span className="font-medium">The evidence is in.</span> Review it, then decide.</span>
          </div>
          {onTakeAction && <Button size="sm" variant="primary" onClick={onTakeAction}>Review and decide</Button>}
        </div>
      )}

      {decided && result && (
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200 animate-fade-in">
          <Gavel className="h-5 w-5" />
          <span><span className="font-medium">Decided in the {result.label.toLowerCase()}.</span> The seller and the buyer have been told.</span>
        </div>
      )}
    </div>
  );
}
