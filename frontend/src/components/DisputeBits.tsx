import React from 'react';
import { Clock } from 'lucide-react';
import { cn, isClosed, outcomeMeta, priorityMeta, timeLeft } from '../lib/format';
import { Badge, DOT, TEXT } from './ui/kit';
import { useNow } from '../lib/hooks';

/** Circular priority score. Color encodes severity, arc encodes the 0-100 score. */
export function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const { tone, label } = priorityMeta(score);
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${label} priority`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-white/10" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, score) / 100)}
          className={cn('transition-all duration-700', DOT[tone].replace('bg-', 'stroke-'))}
        />
      </svg>
      <span className={cn('absolute inset-0 grid place-items-center text-[13px] font-semibold tabular', TEXT[tone])}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

/** Live countdown chip; refreshes every 30s. */
export function Countdown({ due, className }: { due: string | null; className?: string }) {
  const now = useNow();
  const t = timeLeft(due, now);
  return (
    <Badge tone={t.tone} className={className}>
      <Clock className="h-3 w-3" />
      {t.text}
    </Badge>
  );
}

/** What to show in the "time" slot of a case: the decide-by countdown, or the outcome once it's decided. */
export function DecideBy({ status, due, outcome, className }: { status: string; due: string | null; outcome?: string | null; className?: string }) {
  if (isClosed(status)) {
    const o = outcomeMeta(outcome);
    return <Badge tone={o?.tone ?? 'success'} className={className}>{o ? `Decided: ${o.label.toLowerCase()}` : 'Closed'}</Badge>;
  }
  return <Countdown due={due} className={className} />;
}

export function Avatar({ name }: { name: string }) {
  const initials = name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/20 text-xs font-semibold text-brand-soft">{initials || '?'}</div>;
}
