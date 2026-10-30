import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, ArrowUpRight, Building2, CheckCircle2, ChevronDown, ChevronRight, CreditCard, FileText, Gavel, History,
  Handshake, Lightbulb, MessageSquare, RefreshCw, RotateCcw, Send, Sparkles, Truck, User,
} from 'lucide-react';
import { fetchCaseEmails, fetchDisputeDetail, fetchDisputeMessages, fetchDisputeTimeline, fetchInvestigationBrief, fetchSimilarCasesForDispute } from '../api/client';
import { ActionWizard, ActionResult } from '../components/ActionWizard';
import { MessageThread } from '../components/MessageThread';
import { TimelineEvent } from '../types';
import { setLastCase } from '../lib/lastCase';
import {
  Badge, Button, Card, EmptyState, ErrorState, KeyValue, Meter, Modal, SectionTitle, Skeleton, Tabs, useToast,
} from '../components/ui/kit';
import { EvidenceBadge, OutcomeBadge, StatusBadge } from '../components/ui/StatusBadges';
import { Countdown, ScoreRing } from '../components/DisputeBits';
import { InvestigationProgress } from '../components/InvestigationProgress';
import { ClaimPoints } from '../components/ClaimPoints';
import { EvidenceChecklist } from '../components/EvidenceChecklist';
import { ManagerReviewPanel, ReviseDecision } from '../components/ManagerPanels';
import { OversightCards } from '../components/OversightCards';
import { AssignSelect } from '../components/AssignSelect';
import { CollaboratorsPanel } from '../components/CollaboratorsPanel';
import { useCurrentUser } from '../lib/user';
import { cn, evidenceLabel, evidenceMeta, fileSize, isClosed, money, outcomeMeta, outcomeText, parseServerDate, pastOutcomeLabel, prettifyCodes, reasonLabel, sentenceCase, titleCase } from '../lib/format';

type Tab = 'summary' | 'evidence' | 'timeline' | 'messages' | 'emails' | 'similar';

const TIMELINE_ICON: Record<string, React.ElementType> = {
  PAYMENT: CreditCard, ORDER: FileText, SHIPMENT: Truck, DISPUTE: AlertTriangle, EVIDENCE: FileText, INVESTIGATOR_ACTION: User,
};

function DeadlineBar({ created, due }: { created: string | null; due: string | null }) {
  if (!created || !due) return null;
  const start = parseServerDate(created).getTime();
  const end = parseServerDate(due).getTime();
  const pct = Math.min(100, Math.max(0, ((Date.now() - start) / Math.max(1, end - start)) * 100));
  return (
    <div className="mt-2 w-44">
      <Meter value={pct} tone={pct > 85 ? 'danger' : pct > 60 ? 'warn' : 'brand'} />
      <div className="mt-1 text-[11px] text-muted">{Math.round(pct)}% of response window used</div>
    </div>
  );
}

export function CaseInvestigationPage() {
  const { disputeId = 'DEMO-DSP-1042' } = useParams<{ disputeId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user, isManager } = useCurrentUser();

  const [tab, setTab] = useState<Tab>('summary');
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [openEvent, setOpenEvent] = useState<TimelineEvent | null>(null);
  const [wizardOpen, setWizardOpen] = useState(searchParams.get('action') === '1'); // deep link: /investigate/ID?action=1
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);

  useEffect(() => setLastCase(disputeId), [disputeId]); // the Investigation link returns here

  const dispute = useQuery({ queryKey: ['disputeDetail', disputeId], queryFn: () => fetchDisputeDetail(disputeId) });
  const timeline = useQuery({ queryKey: ['disputeTimeline', disputeId], queryFn: () => fetchDisputeTimeline(disputeId) });
  const brief = useQuery({ queryKey: ['investigationBrief', disputeId], queryFn: () => fetchInvestigationBrief(disputeId, false) });
  const messages = useQuery({ queryKey: ['disputeMessages', disputeId], queryFn: () => fetchDisputeMessages(disputeId), refetchInterval: 30_000 });
  const emails = useQuery({ queryKey: ['caseEmails', disputeId], queryFn: () => fetchCaseEmails(disputeId), retry: 0 });
  const similar = useQuery({ queryKey: ['similarCases', disputeId], queryFn: () => fetchSimilarCasesForDispute(disputeId) });

  const regenerate = useMutation({
    mutationFn: () => fetchInvestigationBrief(disputeId, true),
    onSuccess: (b) => { queryClient.setQueryData(['investigationBrief', disputeId], b); toast('success', 'Summary refreshed.'); },
    onError: (e: Error) => toast('error', e.message),
  });

  const jumpToRecord = (id: string) => {
    setHighlighted(id);
    setTab('evidence');
    setTimeout(() => document.getElementById(`record-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
  };

  if (dispute.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }
  if (!dispute.data) {
    return (
      <Card><EmptyState title="Dispute not found" hint={`We couldn't find ${disputeId}.`} action={<Button onClick={() => navigate('/queue')}>Back to disputes</Button>} /></Card>
    );
  }
  const d = dispute.data;
  const decided = isClosed(d.status);
  const withAdmin = d.status === 'PENDING_AI_REVIEW';
  const judged = d.outcome === 'BUYER_FAVOR' || d.outcome === 'SELLER_FAVOR';
  const oneSideSettled = !decided && !!d.seller_settled_at !== !!d.buyer_settled_at;
  const mine = d.assigned_to === user.name;
  const startAction = () => setWizardOpen(true);
  const b = brief.data;
  const gaps = b?.evidence_gaps ?? [];

  return (
    <>
      <button onClick={() => navigate('/queue')} className="-mb-2 flex items-center gap-2 text-sm text-muted transition hover:text-white">
        <ArrowLeft className="h-4 w-4" /> All disputes
      </button>

      {/* Header */}
      <Card className="p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-mono text-2xl font-semibold text-white">{d.id}</h1>
              <StatusBadge status={d.status} />
              {d.is_high_profile && <Badge tone="warn">High profile</Badge>}
              <OutcomeBadge outcome={d.outcome} />
            </div>
            <p className="text-[15px] text-slate-200">{reasonLabel(d.reason)}</p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted">
              <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" />{d.buyer_reference ?? 'Buyer'}</span>
              <span className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{d.merchant_reference ?? 'Seller'}</span>
              <span className="font-mono">Txn {d.transaction_id ?? 'N/A'}</span>
              {!decided && (
                <span className="flex items-center gap-1.5">
                  {d.assigned_to ? <>Owner: {mine ? 'you' : d.assigned_to}</> : 'Unassigned'}
                  {isManager && <AssignSelect disputeId={d.id} assignedTo={d.assigned_to} label="Assign this case" />}
                </span>
              )}
            </div>
            {!d.ai_owned && <CollaboratorsPanel dispute={d} />}
          </div>
          <div className="flex items-center gap-8">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">Amount</div>
              <div className="mt-1 whitespace-nowrap text-2xl font-semibold text-white tabular">{money(d.amount, d.currency)}</div>
            </div>
            {!decided && (
              <div>
                <div className="text-xs uppercase tracking-wider text-muted">Decide by</div>
                <div className="mt-1.5"><Countdown due={d.response_due_date} /></div>
                <DeadlineBar created={d.created_at} due={d.response_due_date} />
              </div>
            )}
            <div className="flex flex-col items-center gap-1">
              <ScoreRing score={d.priority_score} size={56} />
              <span className="text-[11px] uppercase tracking-wider text-muted">Priority</span>
            </div>
            {decided
              ? <span className="rounded-xl border border-line bg-raised/50 px-4 py-2.5 text-sm text-muted">Decided. No further action.</span>
              : withAdmin
                ? <span className="rounded-xl border border-amber-400/25 bg-amber-400/[.07] px-4 py-2.5 text-sm text-amber-100">With the AI reviewer</span>
                : d.ai_owned && !isManager
                  ? <span className="rounded-xl border border-line bg-raised/50 px-4 py-2.5 text-sm text-muted">With the AI Agent</span>
                  : <Button variant="primary" onClick={startAction}><Send className="h-4 w-4" />Take action</Button>}
          </div>
        </div>
        {d.buyer_claim && (
          <blockquote className="mt-5 rounded-xl border-l-2 border-brand bg-raised/60 px-4 py-3 text-sm text-slate-200">
            <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-brand-soft">Buyer says</span>
            “{d.buyer_claim}”
          </blockquote>
        )}
        <ClaimPoints points={d.claim_points} className="mt-3" />
      </Card>

      {oneSideSettled && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-sky-400/25 bg-sky-400/[.07] p-4 text-sm text-sky-100">
          <Handshake aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
          <span><span className="font-medium">The {d.seller_settled_at ? 'seller' : 'buyer'} says this was settled outside PayPal.</span> It is not settled until the {d.seller_settled_at ? 'buyer' : 'seller'} confirms too, so the case continues.</span>
        </div>
      )}

      {!decided && !withAdmin && d.review_note && d.status === 'UNDER_REVIEW' && !isManager && (
        <div role="note" className="rounded-2xl border border-amber-400/25 bg-amber-400/[.07] p-4 text-sm text-amber-100">
          <span className="font-medium">{d.reviewed_by ?? 'An admin'} sent this case back:</span> {d.review_note}
        </div>
      )}

      <OversightCards dispute={d} />

      {withAdmin && isManager && (
        <Card className="p-6">
          <SectionTitle title="Step in on this decision" hint="The AI reviewer hasn't ruled yet. Confirm it, decide differently, or send it back with a note" />
          <ManagerReviewPanel dispute={d} showEvidence={false} />
        </Card>
      )}

      {lastResult && (
        <div role="status" className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-200 animate-fade-in">
          <div className="flex gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <p className="font-medium">{lastResult.message} <span className="font-normal opacity-70">({lastResult.env})</span></p>
              <p className="mt-0.5 font-mono text-xs text-emerald-300/70">Ref {lastResult.audit}</p>
              <button onClick={() => navigate(`/messages?case=${disputeId}`)} className="mt-1.5 text-xs text-emerald-200 underline">Open in Messages</button>
            </div>
          </div>
          <button onClick={() => setLastResult(null)} aria-label="Dismiss" className="text-emerald-300/70 hover:text-white">✕</button>
        </div>
      )}

      <InvestigationProgress dispute={d} messages={messages.data} />

      <div className="grid grid-cols-1 gap-6">
        <div className="min-w-0 space-y-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'summary', label: 'Summary' },
              { value: 'evidence', label: 'Evidence', count: d.evidence_items.length },
              { value: 'timeline', label: 'Timeline', count: timeline.data?.length ?? 0 },
              { value: 'messages', label: 'Messages', count: messages.data?.length ?? 0 },
              { value: 'emails', label: 'Emails', count: emails.data?.length ?? 0 },
              { value: 'similar', label: 'Similar cases', count: similar.data?.length ?? 0 },
            ]}
          />

          {tab === 'summary' && (
            <div className="space-y-5 animate-fade-in">
              {brief.isLoading ? (
                <><Skeleton className="h-32" /><Skeleton className="h-40" /></>
              ) : brief.isError || !b ? (
                <ErrorState message="Couldn't build the case summary." onRetry={() => brief.refetch()} />
              ) : (
                <>
                  {decided && (
                    <Card className="p-6">
                      <SectionTitle title="Decision" />
                      <div className="flex gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                        <Gavel className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                        <div>
                          <p className="font-medium text-white">{outcomeMeta(d.outcome) ? (judged ? `Decided in the ${outcomeMeta(d.outcome)!.label.toLowerCase()}.` : `${outcomeText(d.outcome)}.`) : 'This case is closed.'}</p>
                          {d.outcome === 'SETTLED' && <p className="mt-1 text-sm text-muted">The seller and the buyer both confirmed they settled it outside PayPal. No decision was made.</p>}
                          {d.outcome === 'DISMISSED' && <p className="mt-1 text-sm text-muted">The buyer withdrew the claim. No refund was issued and no decision was made.</p>}
                          {judged && d.proposed_reason && <p className="mt-1 text-sm text-slate-300"><span className="text-muted">Reason: </span>{d.proposed_reason}</p>}
                          {isManager && judged && <div className="mt-3"><ReviseDecision dispute={d} /></div>}
                          <p className="mt-1 text-sm text-muted">There's nothing left to do on this case. To take action, open a case that's New, waiting on replies, or ready to decide from All disputes.</p>
                        </div>
                      </div>
                    </Card>
                  )}

                  {!decided && (
                  <Card className="p-6">
                    <SectionTitle
                      title="What to do next"
                      action={
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="ghost" loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
                            {!regenerate.isPending && <RefreshCw className="h-3.5 w-3.5" />} Refresh
                          </Button>
                          {!decided && !withAdmin && (isManager || !d.ai_owned) && <Button size="sm" variant="primary" onClick={startAction}>Take action</Button>}
                        </div>
                      }
                    />
                    <ul className="space-y-3">
                      {b.recommendations.map((r, i) => (
                        <li key={i} className={cn('flex gap-3 rounded-xl border p-4', i === 0 ? 'border-brand/40 bg-brand/[.07]' : 'border-line bg-raised/40')}>
                          <Lightbulb className={cn('mt-0.5 h-5 w-5 shrink-0', i === 0 ? 'text-brand-soft' : 'text-muted')} />
                          <div>
                            <p className="font-medium text-white">{r.recommendation}</p>
                            <p className="mt-1 text-sm text-muted">{r.rationale}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Card>
                  )}

                  <Card className="p-6">
                    <SectionTitle title="In short" />
                    <p className="text-sm leading-relaxed text-slate-300">{b.summary}</p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                      <Sparkles className="h-3.5 w-3.5" /> Built by {b.provider === 'rule_based' ? 'rules engine' : b.provider}; every fact is checked against source records.
                    </p>
                  </Card>

                  {gaps.length > 0 && (
                    <Card className="p-6">
                      <SectionTitle title={`What's missing (${gaps.length})`} hint="Ask for these before you decide" />
                      <ul className="space-y-3">
                        {gaps.map((g, i) => (
                          <li key={i} className="rounded-xl border border-line bg-raised/40 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-medium text-white">{titleCase(g.evidence_type)}</span>
                              <Badge tone="warn">{titleCase(g.current_status).toLowerCase()}</Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted">{g.reason_required}</p>
                            <p className="mt-2 text-sm text-slate-300"><span className="font-medium text-white">Next: </span>{g.suggested_follow_up}</p>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  )}

                  <Card className="p-0">
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between p-6">
                        <div>
                          <h2 className="text-[15px] font-semibold text-white">Facts behind this ({b.structured_findings.length})</h2>
                          <p className="mt-0.5 text-[13px] text-muted">Each claim links to its source record</p>
                        </div>
                        <ChevronDown className="h-5 w-5 text-muted transition group-open:rotate-180" />
                      </summary>
                      <ul className="space-y-3 px-6 pb-6">
                        {b.structured_findings.map((f) => (
                          <li key={f.finding_id} className="rounded-xl border border-line bg-raised/40 p-4">
                            <div className="flex items-start justify-between gap-3">
                              <p className="text-sm font-medium text-white">{f.claim}</p>
                              <Badge tone={f.verification_status === 'verified' ? 'success' : f.verification_status === 'contradicted' ? 'danger' : 'warn'}>
                                {f.verification_status === 'verified' && <CheckCircle2 className="h-3 w-3" />}{f.verification_status}
                              </Badge>
                            </div>
                            <p className="mt-1 text-sm text-muted">{f.explanation}</p>
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="text-xs text-muted">Sources</span>
                              {f.source_record_ids.map((rid) => (
                                <button key={rid} onClick={() => jumpToRecord(rid)} className="rounded-md bg-brand/10 px-2 py-0.5 font-mono text-xs text-brand-soft ring-1 ring-brand/20 transition hover:bg-brand/20">
                                  {rid}
                                </button>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </Card>

    <Card className="p-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between p-5">
          <span className="text-[15px] font-semibold text-white">Why this priority?</span>
          <ChevronDown className="h-5 w-5 text-muted transition group-open:rotate-180" />
        </summary>
        <ul className="space-y-4 px-5 pb-5">
          {d.priority_factors.map((f) => (
            <li key={f.name}>
              <div className="mb-1 flex justify-between text-[13px]"><span className="text-slate-200">{f.name}</span><span className="font-mono text-brand-soft">+{f.contribution.toFixed(1)}</span></div>
              <Meter value={f.contribution} />
              <p className="mt-1 text-xs text-muted">{f.explanation}</p>
            </li>
          ))}
        </ul>
      </details>
    </Card>
                </>
              )}
            </div>
          )}

          {tab === 'evidence' && (
            <div className="space-y-4 animate-fade-in">
              <Card className="p-6"><EvidenceChecklist disputeId={disputeId} title="What each side has sent" /></Card>
              <RecordCard
                id={d.order?.shipment?.id ?? 'DEMO-SHIP-1042'} highlighted={highlighted}
                icon={<Truck className="h-4 w-4" />} title="Shipment" badge={<Badge tone="info">{d.order?.shipment?.carrier ?? 'Carrier'}</Badge>}
              >
                <KeyValue label="Tracking" mono>{d.order?.shipment?.tracking_reference ?? 'N/A'}</KeyValue>
                <KeyValue label="Status">{titleCase(d.order?.shipment?.status ?? 'unknown')}</KeyValue>
                <KeyValue label="Address match">{titleCase(d.order?.shipment?.delivery_address_match ?? 'unknown')}</KeyValue>
                <KeyValue label="Delivered">{d.order?.shipment?.delivered_at ? parseServerDate(d.order.shipment.delivered_at).toLocaleDateString() : 'Not delivered'}</KeyValue>
              </RecordCard>
              <RecordCard
                id={d.transaction?.id ?? 'DEMO-TXN-1042'} highlighted={highlighted}
                icon={<CreditCard className="h-4 w-4" />} title="Payment" badge={<Badge tone="success">{titleCase(d.transaction?.status ?? 'completed')}</Badge>}
              >
                <KeyValue label="Method">{d.transaction?.payment_method ?? 'PayPal'}</KeyValue>
                <KeyValue label="Gateway ID" mono>{d.transaction?.external_transaction_id ?? 'N/A'}</KeyValue>
                <KeyValue label="Buyer account" mono>{d.transaction?.buyer_email_masked ?? '—'}</KeyValue>
              </RecordCard>

              <Card className="p-6">
                <SectionTitle title={`Documents (${d.evidence_items.length})`} />
                <ul className="space-y-3">
                  {d.evidence_items.map((ev) => {
                    const meta = evidenceMeta(ev.metadata_json);
                    return (
                      <li
                        key={ev.id}
                        id={`record-${ev.id}`}
                        className={cn('rounded-xl border bg-raised/40 p-4 transition', highlighted === ev.id ? 'border-brand ring-2 ring-brand/30' : 'border-line')}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-white">{evidenceLabel(ev.evidence_type)}</span>
                            {meta.provided_by && <Badge tone={meta.provided_by === 'BUYER' ? 'warn' : 'info'}>From the {meta.provided_by.toLowerCase()}</Badge>}
                            <span className="font-mono text-xs text-muted">{ev.id}</span>
                          </div>
                          <EvidenceBadge status={ev.availability_status} />
                        </div>
                        <p className="mt-1 text-sm text-muted">{ev.description}</p>
                        {meta.file_name && (
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-slate-300">
                            <span className="font-mono text-slate-100">{meta.file_name}</span>
                            {meta.content_type && <span>{meta.content_type}</span>}
                            {meta.size_bytes && <span>{fileSize(meta.size_bytes)}</span>}
                            {meta.duration_seconds && <span>{Math.floor(meta.duration_seconds / 60)}m {meta.duration_seconds % 60}s</span>}
                            {meta.storage && <span className="text-muted">{meta.storage}</span>}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          )}

          {tab === 'timeline' && (
            <Card className="overflow-hidden animate-fade-in">
              <div className="px-6 pt-6"><SectionTitle title="What happened, in order" hint="Select an event for details" /></div>
              {timeline.isLoading ? <div className="px-6 pb-6"><Skeleton className="h-48" /></div> : !timeline.data?.length ? (
                <EmptyState icon={<History className="h-6 w-6" />} title="No events yet" />
              ) : (
                <ol aria-label="Timeline" className="divide-y divide-line border-t border-line">
                  {timeline.data.map((e) => {
                    const Icon = TIMELINE_ICON[e.event_type] ?? FileText;
                    return (
                      <li key={e.id}>
                        <button onClick={() => setOpenEvent(e)} className="group flex w-full items-center gap-4 px-6 py-3.5 text-left transition hover:bg-white/[.03]">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line-strong bg-raised text-brand-soft"><Icon className="h-4 w-4" /></span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-white">{prettifyCodes(e.title)}</span>
                          <span className="shrink-0 text-xs text-muted">{parseServerDate(e.timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-white" />
                        </button>
                        {/* What the buyer said that needs chasing sits under the event, so it can't be skipped. */}
                        {!!e.claim_points?.length && <div className="px-6 pb-4 pl-[4.5rem]"><ClaimPoints points={e.claim_points} /></div>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Card>
          )}

          {tab === 'emails' && (
            <Card className="p-6 animate-fade-in">
              <SectionTitle title="Emails" hint="What was sent to the seller and the buyer, and what came back" />
              {!emails.data?.length ? <EmptyState title="No emails yet" hint="When the case is decided, the seller and the buyer each get an email listing the proof both sides sent." /> : (
                <ul className="space-y-3" aria-label="Emails">
                  {emails.data.map((e) => (
                    <li key={e.id} className="rounded-xl border border-line bg-raised/40 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                        <span>{e.direction === 'OUT' ? `To ${e.to}` : `From ${e.from}`}</span>
                        <span className="flex items-center gap-2">
                          <Badge tone={e.direction === 'IN' ? 'info' : e.status === 'SENT' ? 'success' : 'neutral'}>{e.direction === 'IN' ? 'Received' : e.status === 'SENT' ? 'Sent' : 'Kept here, not sent'}</Badge>
                          {parseServerDate(e.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      </div>
                      <h3 className="mt-2 text-sm font-semibold text-white">{e.subject}</h3>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-300">{e.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {tab === 'messages' && (
            <Card className="p-6 animate-fade-in">
              <SectionTitle title="Conversation" hint="What you've sent the seller and the buyer, and how they replied" />
              <MessageThread disputeId={disputeId} disputeStatus={d.status} outcome={d.outcome} onTakeAction={startAction} />
            </Card>
          )}

          {tab === 'similar' && (
            <div className="space-y-3 animate-fade-in">
              {!similar.data?.length ? (
                <Card><EmptyState title="No similar cases found" /></Card>
              ) : similar.data.map((sc) => (
                <Card key={sc.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-white">{sc.id}</span>
                      <span className="text-[13px] text-muted">{reasonLabel(sc.reason)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-emerald-300 tabular">{sc.similarity_score}% match</span>
                      <Badge tone={sc.outcome === 'BUYER_FAVOR' ? 'danger' : sc.outcome === 'MERCHANT_FAVOR' ? 'success' : 'info'}>{pastOutcomeLabel(sc.outcome)}</Badge>
                    </div>
                  </div>
                  <Meter value={sc.similarity_score ?? 0} tone="success" className="mt-3" />
                  <p className="mt-3 text-sm text-slate-300">{sc.case_summary}</p>
                  {!!sc.matching_factors?.length && (
                    <div className="mt-3 flex flex-wrap gap-1.5">{sc.matching_factors.map((m, i) => <Badge key={i}>✓ {m}</Badge>)}</div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

      </div>

      <Modal
        open={!!openEvent}
        onClose={() => setOpenEvent(null)}
        title={openEvent ? prettifyCodes(openEvent.title) : ''}
        footer={openEvent?.event_type === 'EVIDENCE' ? <Button onClick={() => { const id = openEvent.source_record_id; setOpenEvent(null); if (id) jumpToRecord(id); }}>View in Evidence</Button> : undefined}
      >
        {openEvent && (
          <>
            <p className="text-sm leading-relaxed text-slate-200">{prettifyCodes(openEvent.description)}</p>
            <dl className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-raised/50 p-4">
              <KeyValue label="When">{parseServerDate(openEvent.timestamp).toLocaleString()}</KeyValue>
              <KeyValue label="Type">{titleCase(openEvent.event_type)}</KeyValue>
              <KeyValue label="Source">{openEvent.source === 'synthetic' ? 'Demo data' : titleCase(openEvent.source)}</KeyValue>
              {openEvent.status && <KeyValue label="Status">{titleCase(openEvent.status)}</KeyValue>}
              {openEvent.source_record_id && <KeyValue label="Record" mono>{openEvent.source_record_id}</KeyValue>}
            </dl>
          </>
        )}
      </Modal>

      <ActionWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        disputeId={disputeId}
        onJumpToRecord={jumpToRecord}
        onDone={(r) => { setLastResult(r); setTab('messages'); }}
      />
    </>
  );
}

function RecordCard({ id, highlighted, icon, title, badge, children }: {
  id: string; highlighted: string | null; icon: React.ReactNode; title: string; badge: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Card id={`record-${id}`} className={cn('p-5 transition', highlighted === id && 'border-brand ring-2 ring-brand/30')}>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white"><span className="text-brand-soft">{icon}</span><span className="font-semibold">{title}</span><span className="font-mono text-xs text-muted">{id}</span></div>
        {badge}
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</dl>
    </Card>
  );
}
