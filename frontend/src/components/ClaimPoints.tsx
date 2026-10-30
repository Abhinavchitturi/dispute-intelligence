import React, { useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { ClaimPoint } from '../types';
import { cn } from '../lib/format';

/**
 * What the buyer said that an investigator should chase, e.g. "camera footage". Each one is a button:
 * select it for a short note on what it means and whether the proof is already on the case.
 */
export function ClaimPoints({ points, className }: { points?: ClaimPoint[]; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!points?.length) return null;
  const active = points.find((p) => p.key === open);
  return (
    <div className={className}>
      <ul className="flex flex-wrap gap-2" aria-label="Things the buyer mentions">
        {points.map((p) => {
          const on = open === p.key;
          return (
            <li key={p.key}>
              <button
                type="button" aria-expanded={on} onClick={() => setOpen(on ? null : p.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium ring-1 ring-inset transition',
                  p.on_file ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/25 hover:bg-emerald-400/15' : 'bg-red-500/10 text-red-300 ring-red-500/30 hover:bg-red-500/15',
                  on && 'ring-2',
                )}
              >
                {p.on_file ? <CheckCircle2 aria-hidden className="h-3.5 w-3.5" /> : <AlertCircle aria-hidden className="h-3.5 w-3.5" />}
                {p.label}
              </button>
            </li>
          );
        })}
      </ul>
      {active && (
        <div role="note" className="mt-2 rounded-xl border border-line bg-raised/60 px-3.5 py-2.5 text-[13px] text-slate-300 animate-fade-in">
          <p className="italic text-slate-200">“{active.quote}”</p>
          <p className="mt-1">{active.note}</p>
        </div>
      )}
    </div>
  );
}
