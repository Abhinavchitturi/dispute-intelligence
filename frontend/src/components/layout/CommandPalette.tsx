import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CornerDownLeft, FileText, Search } from 'lucide-react';
import { fetchDisputes } from '../../api/client';
import { useDebounced, useEscape } from '../../lib/hooks';
import { cn, money, reasonLabel } from '../../lib/format';
import { PAGES } from './pages';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const dq = useDebounced(q, 150);
  const inputRef = useRef<HTMLInputElement>(null);
  useEscape(onClose, open);

  useEffect(() => { if (open) { setQ(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);

  const { data: disputes } = useQuery({
    queryKey: ['palette', dq],
    queryFn: () => fetchDisputes({ search: dq, sort_by: 'priority_score', sort_order: 'desc' }),
    enabled: open,
  });

  const items = useMemo(() => {
    const pages = PAGES.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).map((p) => ({
      key: p.to, label: p.name, hint: 'Go to page', icon: <p.icon className="h-4 w-4" />, to: p.to,
    }));
    const cases = (disputes ?? []).slice(0, 6).map((d) => ({
      key: d.id, label: d.id, hint: `${reasonLabel(d.reason)} · ${d.buyer_reference ?? 'Buyer'} · ${money(d.amount, d.currency)}`,
      icon: <FileText className="h-4 w-4" />, to: `/investigate/${d.id}`,
    }));
    return [...cases, ...pages];
  }, [q, disputes]);

  useEffect(() => setActive(0), [items.length]);

  if (!open) return null;

  const go = (to: string) => { navigate(to); onClose(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === 'Enter' && items[active]) go(items[active].to);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[14vh]">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-w-xl animate-pop-in overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-2xl" onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="h-4 w-4 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search disputes, buyers, or jump to a page…"
            aria-label="Command search"
            className="h-14 flex-1 bg-transparent text-[15px] text-white placeholder:text-muted focus:outline-none"
          />
          <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 text-[11px] text-muted">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{q}”.</li>}
          {items.map((it, i) => (
            <li key={it.key}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(it.to)}
                className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition', i === active ? 'bg-brand/15' : 'hover:bg-white/5')}
              >
                <span className="text-muted">{it.icon}</span>
                <span className="font-medium text-white">{it.label}</span>
                <span className="flex-1 truncate text-[13px] text-muted">{it.hint}</span>
                {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
