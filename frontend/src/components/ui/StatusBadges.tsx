import React from 'react';

export function StatusBadge({ status }: { status: string }) {
  let bg = 'bg-slate-800 text-slate-300 border-slate-700';
  let label = status.replace(/_/g, ' ');

  if (status === 'RESOLVED' || status === 'CLOSED') {
    bg = 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60';
  } else if (status === 'WAITING_FOR_SELLER_RESPONSE') {
    bg = 'bg-amber-950/60 text-amber-300 border-amber-800/60';
    label = 'Action Needed: Seller';
  } else if (status === 'WAITING_FOR_BUYER_RESPONSE') {
    bg = 'bg-sky-950/60 text-sky-300 border-sky-800/60';
    label = 'Awaiting Buyer';
  } else if (status === 'UNDER_REVIEW') {
    bg = 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60';
    label = 'Under Review';
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${bg}`}>
      {label}
    </span>
  );
}

export function EvidenceBadge({ status }: { status: string }) {
  let color = 'bg-slate-800 text-slate-300 border-slate-700';

  if (status === 'COMPLETE' || status === 'AVAILABLE') {
    color = 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60';
  } else if (status === 'CONFLICTING') {
    color = 'bg-rose-950/60 text-rose-300 border-rose-800/60';
  } else if (status === 'MISSING') {
    color = 'bg-amber-950/60 text-amber-300 border-amber-800/60';
  } else if (status === 'PARTIAL' || status === 'PENDING_VERIFICATION') {
    color = 'bg-blue-950/60 text-blue-300 border-blue-800/60';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${color}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function PriorityBadge({ score }: { score: number }) {
  let color = 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40';
  let label = 'LOW';

  if (score >= 70) {
    color = 'text-rose-400 bg-rose-950/40 border-rose-800/40';
    label = 'CRITICAL';
  } else if (score >= 40) {
    color = 'text-amber-400 bg-amber-950/40 border-amber-800/40';
    label = 'MEDIUM';
  }

  return (
    <div className="flex items-center space-x-1.5">
      <span className={`px-2 py-0.5 rounded text-xs font-semibold border ${color}`}>
        {score.toFixed(0)} • {label}
      </span>
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const isDemo = source === 'synthetic';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono border ${
      isDemo
        ? 'bg-purple-950/50 text-purple-300 border-purple-800/50'
        : 'bg-blue-950/50 text-blue-300 border-blue-800/50'
    }`}>
      {isDemo ? 'SYNTHETIC DEMO' : 'PAYPAL SANDBOX'}
    </span>
  );
}
