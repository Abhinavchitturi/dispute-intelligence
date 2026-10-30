import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Ban, BellRing, Bot, Flag, Inbox, UserPlus } from 'lucide-react';
import { fetchNotifications, sortAlert } from '../../api/client';
import { ManagerAlert } from '../../types';
import { Button, useToast } from '../ui/kit';
import { cn, timeAgo } from '../../lib/format';
import { useNow } from '../../lib/hooks';
import { useCurrentUser } from '../../lib/user';

const ICON = { STRIKES: AlertTriangle, BLOCKED: Ban, FLAG: Flag, APPEAL: UserPlus, REQUEST: Inbox, AI_TAKEOVER: Bot } as const;

/**
 * Pinned to the top of every page for a manager. It stays until the manager presses "Sorted",
 * and the server pings again every hour in the meantime.
 */
export function AlertsBanner() {
  const { isManager } = useCurrentUser();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const now = useNow(30_000);
  const [busy, setBusy] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: fetchNotifications, refetchInterval: 20_000, enabled: isManager, retry: 0 });
  const sort = useMutation({
    mutationFn: (id: string) => { setBusy(id); return sortAlert(id); },
    onSuccess: () => { toast('success', 'Marked sorted.'); ['notifications', 'team', 'dashboardSummary'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); },
    onError: (e: Error) => toast('error', e.message),
    onSettled: () => setBusy(null),
  });
  const alerts = data?.open_alerts ?? [];
  if (!isManager || !alerts.length) return null;

  const where = (a: ManagerAlert) => (a.kind === 'FLAG' ? '/manager' : a.kind === 'REQUEST' ? '/team?tab=requests' : (a.kind === 'APPEAL' || a.kind === 'AI_TAKEOVER') && a.dispute_id ? `/investigate/${a.dispute_id}` : '/team');
  return (
    <section aria-label="Alerts that need you" className="space-y-px border-b border-rose-400/30 bg-rose-500/[.08]">
      {alerts.map((a) => {
        const Icon = ICON[a.kind] ?? BellRing;
        return (
          <div key={a.id} role="alert" className={cn('flex flex-wrap items-center gap-3 px-6 py-2.5 text-sm', a.kind === 'BLOCKED' ? 'text-rose-100' : 'text-amber-50')}>
            <Icon aria-hidden className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1"><span className="font-semibold">{a.title}.</span> <span className="opacity-80">{a.body}</span>
              {a.reminder_count > 0 && <span className="ml-1 text-xs opacity-70">Reminded {a.reminder_count}×. Last {timeAgo(a.last_notified_at, now)}.</span>}
            </span>
            <Button size="sm" onClick={() => navigate(where(a))}>Look into it</Button>
            <Button size="sm" variant="primary" loading={busy === a.id} onClick={() => sort.mutate(a.id)}>Sorted</Button>
          </div>
        );
      })}
    </section>
  );
}
