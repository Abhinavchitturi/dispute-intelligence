import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bot, Flag, Mail, UserPlus, Users } from 'lucide-react';
import { fetchAppeals, fetchFlags, raiseFlag, simulateAiVerdict, simulateAppealEmail } from '../api/client';
import { DisputeDetail } from '../types';
import { Badge, Button, Card, Textarea, useToast } from './ui/kit';
import { outcomeMeta } from '../lib/format';
import { useCurrentUser } from '../lib/user';

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
  const appeals = useQuery({ queryKey: ['appeals', d.id], queryFn: () => fetchAppeals(d.id), retry: 0 });

  const flag = useMutation({
    mutationFn: () => raiseFlag(d.id, points.trim()),
    onSuccess: () => { toast('success', 'Flagged. A manager will look at it.'); setFlagging(false); setPoints(''); refresh(); },
    onError: (e: Error) => toast('error', e.message),
  });
  const aiVerdict = useMutation({
    mutationFn: (verdict: 'APPROVE' | 'OVERTURN') => simulateAiVerdict(
      d.id, verdict, verdict === 'OVERTURN' ? (d.proposed_outcome === 'BUYER_FAVOR' ? 'SELLER_FAVOR' : 'BUYER_FAVOR') : undefined,
      verdict === 'APPROVE' ? 'Demo: the evidence on file supports the investigator’s decision.' : 'Demo: the evidence on file points to the other side.'),
    onSuccess: () => { toast('info', 'The AI reviewer has ruled.'); refresh(); },
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
  const myFlag = flags.data?.[0];
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
              {isManager ? 'The investigator received a strike. If the AI was wrong, overturn it below and the strike comes off.' : result && d.decided_by !== 'MANAGER' ? 'This counted as a strike. If you think the AI got it wrong, flag it to a manager with your reasons.' : 'A manager changed this decision.'}
            </p>
          )}

          {overturned && !isManager && d.decided_by === 'AI' && (
            <div className="mt-3">
              {myFlag ? (
                <p className="text-[13px] text-slate-300">
                  <Badge tone={myFlag.status === 'OPEN' ? 'warn' : myFlag.status === 'OVERTURNED' ? 'success' : 'neutral'}>{myFlag.status === 'OPEN' ? 'Flagged, waiting for a manager' : myFlag.status === 'OVERTURNED' ? 'A manager overturned the AI' : 'A manager kept the AI decision'}</Badge>
                  {myFlag.resolution_note && <span className="ml-2 text-muted">{myFlag.resolved_by}: {myFlag.resolution_note}</span>}
                </p>
              ) : flagging ? (
                <div className="space-y-2">
                  <Textarea rows={3} value={points} onChange={(e) => setPoints(e.target.value)} aria-label="What the AI got wrong" placeholder="What did the AI get wrong? Give your reasons, with the records that show it." />
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="primary" loading={flag.isPending} disabled={points.trim().length < MIN_FLAG} onClick={() => flag.mutate()}><Flag className="h-3.5 w-3.5" />Send to a manager</Button>
                    <Button size="sm" variant="ghost" onClick={() => setFlagging(false)}>Cancel</Button>
                    {points.length > 0 && points.trim().length < MIN_FLAG && <span className="text-xs text-amber-300">Add more detail so the manager can check it.</span>}
                  </div>
                </div>
              ) : (
                <Button size="sm" onClick={() => setFlagging(true)}><Flag className="h-3.5 w-3.5" />Flag this AI decision</Button>
              )}
            </div>
          )}
        </Card>
      )}

      {demo && d.status === 'PENDING_AI_REVIEW' && (
        <Card className="p-5" aria-label="Waiting for the AI reviewer">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <Bot aria-hidden className="mt-0.5 h-5 w-5 shrink-0 text-brand-soft" />
              <div>
                <h2 className="text-[15px] font-semibold text-white">Waiting for the AI reviewer</h2>
                <p className="text-[13px] text-muted">It rules on every decision before anyone is told. The AI reviewer isn't connected in this demo, so you can stand in for it by hand.</p>
              </div>
            </div>
            <div className="flex gap-2" aria-label="Demo: stand in for the AI reviewer">
              <Button size="sm" loading={aiVerdict.isPending && aiVerdict.variables === 'APPROVE'} onClick={() => aiVerdict.mutate('APPROVE')}>AI approves</Button>
              <Button size="sm" loading={aiVerdict.isPending && aiVerdict.variables === 'OVERTURN'} onClick={() => aiVerdict.mutate('OVERTURN')}>AI overturns</Button>
            </div>
          </div>
        </Card>
      )}

      {demo && decided && !d.parent_dispute_id && children.every((c) => c.status === 'RESOLVED' || c.status === 'CLOSED') && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4" aria-label="Demo: appeal by email">
          <p className="flex items-center gap-2 text-[13px] text-muted"><Users aria-hidden className="h-4 w-4" />Demo: see what happens when the buyer emails the appeals address to ask for a second look.</p>
          <Button size="sm" loading={appeal.isPending} onClick={() => appeal.mutate()}><Mail className="h-3.5 w-3.5" />Buyer emails to appeal</Button>
        </Card>
      )}
    </>
  );
}
