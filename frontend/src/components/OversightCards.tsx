import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bot, Flag, Mail, User, UserPlus, Users } from 'lucide-react';
import { fetchAiRuling, fetchAppeals, fetchFlags, raiseFlag, requestAiReview, simulateAppealEmail } from '../api/client';
import { DisputeDetail } from '../types';
import { Badge, Button, Card, Textarea, useToast } from './ui/kit';
import { outcomeMeta } from '../lib/format';
import { useCurrentUser } from '../lib/user';
import { AiReviewPanel } from './ActionWizard';
import { FlagActions, ReviseDecision } from './ManagerPanels';

const KEYS = ['disputeDetail', 'disputes', 'urgentDisputes', 'dashboardSummary', 'messageThreads', 'disputeMessages', 'disputeTimeline', 'caseEmails', 'flags', 'notifications', 'team', 'me', 'auditEvents'];
const MIN_FLAG = 30;

/**
 * The layers above the investigator, as they apply to this case: what the AI reviewer decided, the flag an investigator can raise,
 * the appeal links, and (in demo mode) hand controls that stand in for the AI reviewer and the buyer's email.
 */
export function OversightCards({ dispute: d }: { dispute: DisputeDetail }) {
  const { isManager } = useCurrentUser();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const refresh = () => KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const [flagging, setFlagging] = useState(false);
  const [points, setPoints] = useState('');

  const flags = useQuery({ queryKey: ['flags', d.id], queryFn: () => fetchFlags(undefined, d.id), enabled: d.ai_verdict === 'OVERTURN', retry: 0 });
  // What the AI based its ruling on, exactly as it was when it ruled. Older rulings have no saved copy, so they are worked out again.
  const saved = useQuery({ queryKey: ['aiRuling', d.id, d.status], queryFn: () => fetchAiRuling(d.id), enabled: isManager && !!d.conflict_due_at, staleTime: 0, retry: 0 });
  const analysis = useQuery({
    queryKey: ['aiAnalysis', d.id, d.proposed_outcome, d.status],
    queryFn: () => requestAiReview(d.id, { proposed_outcome: d.proposed_outcome as 'BUYER_FAVOR' | 'SELLER_FAVOR', proposed_reason: d.proposed_reason ?? 'The investigator decided this case.' }),
    enabled: isManager && !!d.conflict_due_at && saved.isSuccess && !saved.data?.available && (d.proposed_outcome === 'BUYER_FAVOR' || d.proposed_outcome === 'SELLER_FAVOR'),
    staleTime: 0, retry: 0,
  });
  const shown = saved.data?.available ? saved.data.assessment : analysis.data;
  const appeals = useQuery({ queryKey: ['appeals', d.id], queryFn: () => fetchAppeals(d.id), retry: 0 });

  const flag = useMutation({
    mutationFn: () => raiseFlag(d.id, points.trim()),
    onSuccess: (r) => { toast('success', r.auto_closed ? 'On a second look the AI agrees with you. The case is closed in your favor and your strike is removed.' : 'Reported. A manager will look at it.'); setFlagging(false); setPoints(''); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });
  const appeal = useMutation({
    mutationFn: () => simulateAppealEmail(d.id, 'BUYER', 'I am not happy with this decision. Please look into it again.'),
    onSuccess: (r) => { r.opened ? toast('success', `Appeal case ${r.appeal_id} opened.`) : toast('error', r.reason ?? 'No appeal was opened.'); refresh(); qc.invalidateQueries({ queryKey: ['appeals'] }); },
    onError: (e: Error) => toast('error', e.message),
  });

  const demo = d.source === 'synthetic';
  const decided = d.status === 'RESOLVED' && (d.outcome === 'BUYER_FAVOR' || d.outcome === 'SELLER_FAVOR');
  const overturned = d.ai_verdict === 'OVERTURN' && d.status === 'RESOLVED';
  const myFlag = flags.data?.find((f) => f.status === 'OPEN') ?? flags.data?.[0];
  const result = outcomeMeta(d.outcome);
  const children = appeals.data?.appeals ?? [];

  return (
    <>
      {d.parent_dispute_id && (
        <Card className="flex flex-wrap items-center gap-3 p-4" aria-label="Appeal">
          <UserPlus aria-hidden className="h-5 w-5 shrink-0 text-brand-soft" />
          <p className="min-w-0 flex-1 text-sm text-slate-200">
            <span className="font-medium text-white">This is appeal {d.appeal_number} of </span>
            <button onClick={() => navigate(`/investigate/${d.parent_dispute_id}`)} className="font-mono text-brand-soft hover:underline">{d.parent_dispute_id}</button>.
            {d.manager_assigned && <> {d.manager_assigned} (manager) is joined to this case.</>} Everything already on file was carried over.
          </p>
        </Card>
      )}

      {children.length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-4" aria-label="Appeals of this case">
          <Mail aria-hidden className="h-5 w-5 shrink-0 text-brand-soft" />
          <p className="min-w-0 flex-1 text-sm text-slate-200">
            <span className="font-medium text-white">Someone asked for further investigation. </span>
            {children.map((c, i) => (
              <span key={c.id}>{i > 0 && ', '}<button onClick={() => navigate(`/investigate/${c.id}`)} className="font-mono text-brand-soft hover:underline">{c.id}</button> ({c.assigned_to ?? 'unassigned'}{c.manager ? `, with ${c.manager}` : ''})</span>
            ))}
          </p>
        </Card>
      )}

      {d.conflict_due_at && (
        <Card className="space-y-4 border-amber-400/30 p-5" aria-label="Reopened by the manager">
          <div className="flex items-start gap-3">
            <Flag aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
            <p className="min-w-0 flex-1 text-sm text-slate-200">
              <span className="font-medium text-white">Reopened by the manager. </span>
              {d.conflict_by ?? 'An investigator'} disagrees with the AI's decision. A manager has to settle it and close it by {new Date(d.conflict_due_at).toLocaleDateString()}.
            </p>
          </div>
          {isManager && myFlag && myFlag.status === 'OPEN' && (
            <div className="rounded-xl border border-amber-400/25 bg-amber-400/[.06] p-4">
              <p className="mb-2.5 text-[13px] text-slate-200">Read both sides and the AI's analysis below, check the evidence further down, then settle it. <span className="text-muted">Train the AI rules for {d.conflict_by ?? 'the investigator'}. Keep the AI decision leaves the AI's ruling as it is.</span></p>
              <FlagActions flag={myFlag} />
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <section aria-label="What the AI said" className="rounded-xl border border-line bg-white/[.03] p-4">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"><Bot aria-hidden className="h-3.5 w-3.5" />What the AI said</h3>
              <p className="mt-2 text-sm font-medium text-white">Ruled in {outcomeMeta(d.outcome)?.label.toLowerCase() ?? 'the other side'}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{d.ai_rationale ?? 'No reasons were recorded.'}</p>
            </section>
            <section aria-label="What the investigator says" className="rounded-xl border border-line bg-white/[.03] p-4">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted"><User aria-hidden className="h-3.5 w-3.5" />What {d.conflict_by ?? 'the investigator'} says</h3>
              <p className="mt-2 text-sm font-medium text-white">Decided in {outcomeMeta(d.proposed_outcome)?.label.toLowerCase() ?? 'a side'}</p>
              {d.proposed_reason && <p className="mt-1 text-[13px] leading-relaxed text-slate-300">{d.proposed_reason}</p>}
              {myFlag?.points && <p className="mt-2 rounded-lg bg-white/[.04] p-2.5 text-[13px] leading-relaxed text-slate-200"><span className="text-muted">Why it is wrong: </span>{myFlag.points}</p>}
            </section>
          </div>
          {isManager && (
            <section aria-label="How the AI reached its ruling" className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">How the AI reached its ruling</h3>
              {saved.isLoading || analysis.isLoading ? <p className="text-[13px] text-muted">Going over the AI's analysis…</p>
                : shown ? <AiReviewPanel a={shown} mine={d.proposed_outcome as 'BUYER_FAVOR' | 'SELLER_FAVOR'} reviewer={d.conflict_by ?? d.proposed_by ?? 'the investigator'} />
                : <p className="text-[13px] text-muted">The AI's full analysis isn't available. Its recorded reasons are above, and the evidence is further down this page.</p>}
            </section>
          )}
        </Card>
      )}

      {d.ai_owned && d.status !== 'RESOLVED' && d.status !== 'CLOSED' && (
        <Card className="flex flex-wrap items-center gap-3 border-amber-400/30 p-4" aria-label="With the AI Agent">
          <Bot aria-hidden className="h-5 w-5 shrink-0 text-amber-300" />
          <p className="min-w-0 flex-1 text-sm text-slate-200">
            <span className="font-medium text-white">The AI Agent has this case. </span>
            Nobody took it before its deadline, so the AI Agent is handling it from start to finish.
            {isManager ? ' You can give it to someone yourself from the owner box above, and you can overturn whatever the AI Agent decides.' : ''}
          </p>
        </Card>
      )}

      {d.ai_verdict && d.status === 'RESOLVED' && (
        <Card className="p-5" aria-label="AI review">
          <div className="flex flex-wrap items-center gap-2">
            <Bot aria-hidden className="h-4 w-4 text-brand-soft" />
            <h2 className="text-[15px] font-semibold text-white">{d.ai_verdict === 'DIRECT' ? 'AI Agent' : 'AI reviewer'}</h2>
            <Badge tone={d.ai_verdict === 'OVERTURN' ? 'warn' : d.ai_verdict === 'DIRECT' ? 'info' : 'success'}>{d.ai_verdict === 'DIRECT' ? 'Handled the whole case' : d.ai_verdict === 'APPROVE' ? 'Approved the investigator' : 'Overturned the investigator'}</Badge>
            {d.decided_by === 'MANAGER' && <Badge tone="info">Later changed by a manager</Badge>}
          </div>
          {d.ai_rationale && <p className="mt-2 text-sm text-slate-300">{d.ai_rationale}</p>}
          {overturned && (
            <p className="mt-2 text-[13px] text-muted">
              {isManager ? 'The investigator received a strike. If the AI was wrong, overturn it below and the strike comes off.' : result && d.decided_by !== 'MANAGER' ? 'This counted as a strike. The AI overturned your decision. If you disagree, report it with your reasons. A manager reopens the case and settles it within 1 to 2 days.' : 'A manager changed this decision.'}
            </p>
          )}

          {overturned && !isManager && d.decided_by === 'AI' && (
            <div className="mt-3">
              {myFlag ? (
                <p className="text-[13px] text-slate-300">
                  <Badge tone={myFlag.status === 'OPEN' ? 'warn' : myFlag.status === 'OVERTURNED' ? 'success' : 'neutral'}>{myFlag.status === 'OPEN' ? 'With a manager, to be settled within 2 days' : myFlag.status === 'OVERTURNED' ? 'A manager overturned the AI' : 'A manager kept the AI decision'}</Badge>
                  {myFlag.resolution_note && <span className="ml-2 text-muted">{myFlag.resolved_by}: {myFlag.resolution_note}</span>}
                </p>
              ) : flagging ? (
                <div className="space-y-2">
                  <Textarea rows={3} value={points} onChange={(e) => setPoints(e.target.value)} aria-label="What the AI got wrong" placeholder="What did the AI get wrong? Give your reasons, with the records that show it." />
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="primary" loading={flag.isPending} disabled={points.trim().length < MIN_FLAG} onClick={() => flag.mutate()}><Flag className="h-3.5 w-3.5" />Send to the manager</Button>
                    <Button size="sm" variant="ghost" onClick={() => setFlagging(false)}>Cancel</Button>
                    {points.length > 0 && points.trim().length < MIN_FLAG && <span className="text-xs text-amber-300">Add more detail so the manager can check it.</span>}
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="ghost" className="border border-rose-400/60 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" onClick={() => setFlagging(true)}><Flag className="h-3.5 w-3.5" />Report this</Button>
              )}
            </div>
          )}
        </Card>
      )}

      {isManager && decided && (d.outcome === 'BUYER_FAVOR' || d.outcome === 'SELLER_FAVOR') && !d.conflict_due_at && (
        <div className="flex flex-wrap items-center gap-3" aria-label="Change the decision"><ReviseDecision dispute={d as any} /></div>
      )}

      {d.status === 'PENDING_AI_REVIEW' && (
        <Card className="p-5" aria-label="With the AI reviewer">
          <div className="flex items-start gap-3">
            <Bot aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand-soft" />
            <div>
              <h2 className="text-[15px] font-semibold text-white">With the AI reviewer</h2>
              <p className="text-[13px] text-muted">The AI reviews every decision the moment it is sent. This one is being looked at now. Nobody is told until it rules.</p>
            </div>
          </div>
        </Card>
      )}

      {demo && decided && d.outcome === 'SELLER_FAVOR' && !d.parent_dispute_id && children.every((c) => c.status === 'RESOLVED' || c.status === 'CLOSED') && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4" aria-label="Demo: appeal by email">
          <p className="flex items-center gap-2 text-[13px] text-muted"><Users aria-hidden className="h-4 w-4" />Demo: see what happens when the buyer emails the appeals address to ask for a second look.</p>
          <Button size="sm" loading={appeal.isPending} onClick={() => appeal.mutate()}><Mail className="h-3.5 w-3.5" />Buyer emails to appeal</Button>
        </Card>
      )}
    </>
  );
}
