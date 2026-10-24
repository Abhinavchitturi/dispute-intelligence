import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Inbox, MailQuestion } from 'lucide-react';
import { fetchMessageThreads } from '../api/client';
import { MessageThreadSummary } from '../types';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from '../components/ui/kit';
import { MessageThread } from '../components/MessageThread';
import { ActionWizard } from '../components/ActionWizard';
import { cn, money, outcomeMeta, reasonLabel, timeAgo } from '../lib/format';
import { useNow } from '../lib/hooks';

type Filter = 'waiting' | 'turn' | 'all';

function StateBadge({ t }: { t: MessageThreadSummary }) {
  if (t.state === 'WAITING') return <Badge tone="info" dot>Waiting on {t.waiting_on?.toLowerCase()}</Badge>;
  if (t.state === 'YOUR_TURN') return <Badge tone="brand" dot>Ready to decide</Badge>;
  const o = outcomeMeta(t.outcome);
  return <Badge tone="success">{o ? `Decided: ${o.label.toLowerCase()}` : 'Closed'}</Badge>;
}

export function MessagesPage() {
  const navigate = useNavigate();
  const now = useNow(5000);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  // Taking action happens right here, in a popup over the conversation, so you never leave the page.
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: threads, isLoading, error, refetch } = useQuery({
    queryKey: ['messageThreads'],
    queryFn: fetchMessageThreads,
    refetchInterval: 5000, // delivers any reply that is due, and keeps the badges fresh
  });

  const counts = useMemo(() => ({
    waiting: threads?.filter((t) => t.state === 'WAITING').length ?? 0,
    turn: threads?.filter((t) => t.state === 'YOUR_TURN').length ?? 0,
    all: threads?.length ?? 0,
  }), [threads]);

  const rows = (threads ?? []).filter((t) => filter === 'all' || (filter === 'waiting' ? t.state === 'WAITING' : t.state === 'YOUR_TURN'));
  const selectedId = params.get('case');
  const selected = threads?.find((t) => t.dispute_id === selectedId) ?? rows[0] ?? threads?.[0];

  // Default to the most relevant thread so the right pane is never empty when there is something to show.
  useEffect(() => {
    if (!selectedId && selected) setParams({ case: selected.dispute_id }, { replace: true });
  }, [selectedId, selected, setParams]);

  const select = (id: string) => setParams({ case: id }, { replace: true });

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Everything you've sent the sellers and buyers, who you're waiting on, and the cases where the evidence is in."
      />

      {error ? <ErrorState message="Couldn't load messages." onRetry={() => refetch()} /> : isLoading ? (
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]"><Skeleton className="h-96 rounded-2xl" /><Skeleton className="h-96 rounded-2xl" /></div>
      ) : !threads?.length ? (
        <Card>
          <EmptyState
            icon={<MailQuestion className="h-6 w-6" />}
            title="Nothing sent yet"
            hint="When you ask a seller or buyer for evidence, or send a decision, the message and its replies show up here."
            action={<Button variant="primary" onClick={() => navigate('/queue')}>Go to disputes <ArrowRight className="h-4 w-4" /></Button>}
          />
        </Card>
      ) : (
        // The conversation is on the left and the list of conversations (All / Waiting / Ready to decide) on the right.
        // On a narrow screen they stack with the list first, so you pick a conversation before reading it.
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-3 lg:order-2" aria-label="Conversation list" role="region">
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'waiting', label: 'Waiting', count: counts.waiting },
                { value: 'turn', label: 'Ready to decide', count: counts.turn },
              ]}
            />
            <Card className="overflow-hidden">
              {rows.length === 0 ? (
                <EmptyState icon={<Inbox className="h-6 w-6" />} title="Nothing here" hint={filter === 'waiting' ? "You're not waiting on anyone." : 'No case has all its evidence in yet.'} />
              ) : (
                <ul className="divide-y divide-line" aria-label="Conversations">
                  {rows.map((t) => (
                    <li key={t.dispute_id}>
                      <button
                        onClick={() => select(t.dispute_id)}
                        aria-current={selected?.dispute_id === t.dispute_id}
                        className={cn('w-full px-4 py-4 text-left transition hover:bg-white/[.03]', selected?.dispute_id === t.dispute_id && 'bg-brand/[.07]')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2 font-mono text-[13px] font-semibold text-white">
                            {t.unread_count > 0 && <span className="h-2 w-2 rounded-full bg-brand" aria-label={`${t.unread_count} unread`} />}
                            {t.dispute_id}
                          </span>
                          <span className="text-xs text-muted">{timeAgo(t.last_message_at, now)}</span>
                        </div>
                        <div className="mt-1 text-[13px] text-muted">{t.buyer_reference ?? 'Buyer'} · {reasonLabel(t.reason)} · {money(t.amount, t.currency)}</div>
                        <div className="mt-2"><StateBadge t={t} /></div>
                        <p className="mt-2 line-clamp-2 text-[13px] text-slate-300">
                          <span className="text-muted">{t.last_direction === 'OUTBOUND' ? 'You: ' : ''}</span>{t.last_message_preview}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {selected && (
            <Card className="p-6 lg:order-1">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="font-mono text-lg font-semibold text-white">{selected.dispute_id}</h2>
                    <StateBadge t={selected} />
                  </div>
                  <p className="mt-1 text-[13px] text-muted">
                    {selected.buyer_reference ?? 'Buyer'} vs {selected.merchant_reference ?? 'Seller'} · {reasonLabel(selected.reason)} · {money(selected.amount, selected.currency)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selected.state !== 'CLOSED' && <Button size="sm" variant="primary" onClick={() => setWizardOpen(true)}>Take action</Button>}
                  <Button size="sm" onClick={() => navigate(`/investigate/${selected.dispute_id}`)}>Open case <ArrowRight className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
              <MessageThread
                disputeId={selected.dispute_id}
                disputeStatus={selected.dispute_status}
                outcome={selected.outcome}
                onTakeAction={() => setWizardOpen(true)}
              />
            </Card>
          )}

          {selected && (
            <ActionWizard
              open={wizardOpen}
              onClose={() => setWizardOpen(false)}
              disputeId={selected.dispute_id}
              onJumpToRecord={() => navigate(`/investigate/${selected.dispute_id}`)}
              onDone={() => undefined}
            />
          )}
        </div>
      )}
    </>
  );
}
