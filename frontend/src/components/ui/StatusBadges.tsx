import React from 'react';
import { Badge } from './kit';
import { outcomeMeta, outcomeText, priorityMeta, statusMeta, titleCase, Tone } from '../../lib/format';

export function StatusBadge({ status }: { status: string }) {
  const { label, tone } = statusMeta(status);
  return <Badge tone={tone} dot>{label}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  const m = outcomeMeta(outcome);
  return m ? <Badge tone={m.tone}>{outcomeText(outcome)}</Badge> : null;
}

export function EvidenceBadge({ status }: { status: string }) {
  const tone: Tone =
    status === 'COMPLETE' || status === 'AVAILABLE' ? 'success'
    : status === 'CONFLICTING' ? 'danger'
    : status === 'MISSING' ? 'warn'
    : status === 'PARTIAL' || status === 'PENDING_VERIFICATION' ? 'info'
    : 'neutral';
  return <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>;
}

export function PriorityBadge({ score }: { score: number }) {
  const { label, tone } = priorityMeta(score);
  return <Badge tone={tone}>{score.toFixed(0)} • {label}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  const demo = source === 'synthetic';
  return <Badge tone={demo ? 'violet' : 'info'}>{demo ? 'SYNTHETIC DEMO' : 'PAYPAL SANDBOX'}</Badge>;
}

export { titleCase };
