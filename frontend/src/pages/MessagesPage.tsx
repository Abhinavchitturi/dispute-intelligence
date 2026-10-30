import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronRight, Inbox, MailQuestion } from 'lucide-react';
import { fetchMessageThreads } from '../api/client';
import { MessageThreadSummary } from '../types';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from '../components/ui/kit';
import { MessageThread } from '../components/MessageThread';
import { ActionWizard } from '../components/ActionWizard';
import { money, outcomeText, reasonLabel, timeAgo } from '../lib/format';
import { useNow } from '../lib/hooks';

type Filter = 'waiting' | 'turn' | 'all';

function StateBadge({ t }: { t: MessageThreadSummary }) {
  if (t.state === 'WAITING') return <Badge tone="info" dot>Waiting on {t.waiting_on?.toLowerCase()}</Badge>;
  if (t.state === 'IN_PROGRESS') return <Badge tone="neutral" dot>In progress</Badge>;
  if (t.state === 'YOUR_TURN') return <Badge tone="brand" dot>Ready to decide</Badge>;
  if (t.state === 'IN_REVIEW') return <Badge tone="warn" dot>With AI review</Badge>;
  return <Badge tone="success">{outcomeText(t.outcome) ?? 'Closed'}</Badge>;
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
  const selected = selectedId ? threads?.find((t) => t.dispute_id === selectedId) : undefined;

  const open = (id: string) => setParams({ case: id });
  const close = () => setParams({});

  // One conversation: the seller on one side and the buyer on the other.
  if (selectedId && selected) {
    return (
      <>
        <button onClick={close} className="-mb-2 flex items-center gap-2 text-sm text-muted transition hover:text-white">
          <ArrowLeft className="h-4 w-4" /> All conversations
        </button>
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-mono text-xl font-semibold text-white">{selected.dispute_id}</h1>
                <StateBadge t={selected} />
              </div>
              <p className="mt-1 text-[13px] text-muted">
                {selected.buyer_reference ?? 'Buyer'} vs {selected.merchant_reference ?? 'Seller'} · {reasonLabel(selected.reason)} · {money(selected.amount, selected.currency)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {selected.state !== 'CLOSED' && selected.state !== 'IN_REVIEW' && <Button size="sm" variant="primary" onClick={() => setWizardOpen(true)}>Take action</Button>}
              <Button size="sm" onClick={() => navigate(`/investigate/${selected.dispute_id}`)}>Open case <ArrowRight className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </Card>
        <MessageThread
          disputeId={selected.dispute_id}
          disputeStatus={selected.dispute_status}
          outcome={selected.outcome}
          onTakeAction={() => setWizardOpen(true)}
        />
        <ActionWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          disputeId={selected.dispute_id}
          onJumpToRecord={() => navigate(`/investigate/${selected.dispute_id}`)}
          onDone={() => undefined}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Every case you've written to. Open one to see the seller and the buyer side by side."
      />

      {error ? <ErrorState message="Couldn't load messages." onRetry={() => refetch()} /> : isLoading ? (
        <div className="space-y-3"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div>
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
        <div className="space-y-4">
          {selectedId && !selected && (
            <p role="alert" className="rounded-xl border border-amber-400/25 bg-amber-400/[.07] px-4 py-3 text-sm text-amber-100">
              There are no messages on {selectedId} yet. Open the case and ask the seller or the buyer for evidence to start one.
            </p>
          )}
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
                    <button onClick={() => open(t.dispute_id)} className="group flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-white/[.03]">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2 font-mono text-[13px] font-semibold text-white">
                            {t.unread_count > 0 && <span className="h-2 w-2 rounded-full bg-brand" aria-label={`${t.unread_count} unread`} />}
                            {t.dispute_id}
                          </span>
                          <span className="text-xs text-muted">{timeAgo(t.last_message_at, now)}</span>
                        </div>
                        <div className="mt-1 text-[13px] text-muted">{t.buyer_reference ?? 'Buyer'} vs {t.merchant_reference ?? 'Seller'} · {reasonLabel(t.reason)} · {money(t.amount, t.currency)}</div>
                        <div className="mt-2"><StateBadge t={t} /></div>
                        <p className="mt-2 line-clamp-1 text-[13px] text-slate-300">
                          <span className="text-muted">{t.last_direction === 'OUTBOUND' ? 'You: ' : ''}</span>{t.last_message_preview}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-white" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
