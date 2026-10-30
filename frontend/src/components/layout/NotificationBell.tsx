import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { fetchNotifications, markNotificationsRead } from '../../api/client';
import { cn, timeAgo } from '../../lib/format';
import { useNow } from '../../lib/hooks';

/** The bell: every ping sent to you, newest first, including the hourly reminders. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(30_000);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 20_000, retry: 0 });
  const read = useMutation({ mutationFn: markNotificationsRead, onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }) });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const unread = data?.unread ?? 0;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open && unread) read.mutate(); }}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-full text-slate-300 transition hover:bg-white/[.08] hover:text-white"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-rose-500 px-1 text-center text-[11px] font-semibold text-white tabular">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-30 mt-2 w-[360px] overflow-hidden rounded-2xl border border-line/70 bg-surface/95 shadow-[0_16px_60px_rgba(0,0,0,.6)] backdrop-blur-xl animate-pop-in">
          <div className="border-b border-line px-4 py-3 text-[15px] font-semibold text-white">Notifications</div>
          {!data?.items.length ? <p className="px-4 py-8 text-center text-sm text-muted">Nothing yet.</p> : (
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => { setOpen(false); if (n.dispute_id) navigate(`/investigate/${n.dispute_id}`); else if (n.kind === 'REQUEST' && n.title.includes('has no cases')) navigate('/team?tab=requests'); else if (n.kind === 'STRIKES' || n.kind === 'BLOCKED') navigate('/team'); else if (n.kind === 'ASSIGNED') navigate('/queue?view=mine'); }}
                    className={cn('block w-full px-4 py-3 text-left transition hover:bg-white/[.04]', !n.read && 'bg-brand/[.06]')}
                  >
                    <div className="flex items-center justify-between gap-2 text-[13px] font-medium text-white"><span>{n.title}</span><span className="shrink-0 text-xs font-normal text-muted">{timeAgo(n.created_at, now)}</span></div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{n.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
