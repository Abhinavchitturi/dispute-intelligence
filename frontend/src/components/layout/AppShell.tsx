import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PanelLeftClose, PanelLeftOpen, Search, ShieldCheck } from 'lucide-react';
import { fetchHealth, fetchMessageThreads } from '../../api/client';
import { cn } from '../../lib/format';
import { useStoredState } from '../../lib/hooks';
import { CommandPalette } from './CommandPalette';
import { PAGES, visibleTo } from './pages';
import { initials, useCurrentUser } from '../../lib/user';
import { Badge } from '../ui/kit';

const GROUPS: { id: string; label: string }[] = [
  { id: 'main', label: 'Workspace' },
  { id: 'insights', label: 'Insights' },
  { id: 'system', label: 'System' },
];

export function AppShell() {
  const [collapsed, setCollapsed] = useStoredState('resolveiq.sidebar.collapsed', false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const { role, setRole, user } = useCurrentUser();

  const { data: health, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
    retry: 0,
  });
  const online = !!health && !isError;

  // Badge on Messages: conversations with a new reply, or where it's now your turn.
  const { data: threads } = useQuery({ queryKey: ['messageThreads'], queryFn: fetchMessageThreads, refetchInterval: 10_000, retry: 0 });
  const needsYou = threads?.filter((t) => t.unread_count > 0 || t.state === 'YOUR_TURN').length ?? 0;
  const waiting = threads?.filter((t) => t.state === 'WAITING').length ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isCase = location.pathname.startsWith('/investigate');

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-slate-100">
      <aside className={cn('flex shrink-0 flex-col border-r border-line/70 bg-surface/80 backdrop-blur-2xl transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-60')}>
        <div className={cn('flex h-16 items-center gap-3 border-b border-line', collapsed ? 'justify-center' : 'px-5')}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-brand">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-[15px] font-semibold text-white">ResolveIQ</div>
              <div className="text-xs text-muted">PayPal Disputes</div>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto p-3" aria-label="Primary">
          {GROUPS.map((g) => (
            <div key={g.id} className="space-y-1">
              {!collapsed && <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted/70">{g.label}</div>}
              {PAGES.filter((p) => p.group === g.id && visibleTo(p, role)).map((p) => (
                <NavLink
                  key={p.to}
                  to={p.to}
                  end={p.to === '/'}
                  title={collapsed ? p.name : undefined}
                  className={({ isActive }) => {
                    // "Your cases" and "Disputes" are the same page with a different filter, so tell them apart by the filter.
                    const [path, query] = p.to.split('?');
                    const onQuery = location.pathname === path && !!query && location.search.includes(query);
                    const active = query ? onQuery : (isActive && !(p.to === '/queue' && location.search.includes('view=mine'))) || (p.to === '/investigate' && isCase);
                    return cn(
                      'group relative flex items-center gap-3 rounded-[10px] py-2.5 text-[15px] font-medium transition',
                      collapsed ? 'justify-center px-0' : 'px-3',
                      active ? 'bg-brand/20 text-white ring-1 ring-brand/30' : 'text-slate-300 hover:bg-white/[.06] hover:text-white',
                    );
                  }}
                >
                  <p.icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && <span className="flex-1">{p.name}</span>}
                  {p.to === '/messages' && (needsYou > 0 || waiting > 0) && (
                    <span
                      aria-label={needsYou > 0 ? `${needsYou} conversations need you` : `${waiting} waiting for a reply`}
                      className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular', needsYou > 0 ? 'bg-brand text-white' : 'bg-white/10 text-muted', collapsed && 'absolute right-1.5 top-1')}
                    >
                      {needsYou > 0 ? needsYou : waiting}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-line p-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={cn('flex w-full items-center gap-3 rounded-xl py-2 text-sm text-muted transition hover:bg-white/5 hover:text-white', collapsed ? 'justify-center' : 'px-3')}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <><PanelLeftClose className="h-[18px] w-[18px]" /><span>Collapse</span></>}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-4 border-b border-line/70 bg-canvas/70 px-6 backdrop-blur-2xl">
          <button
            onClick={() => setPaletteOpen(true)}
            className="group flex h-10 w-full max-w-md items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 text-sm text-muted transition hover:border-brand/50"
          >
            <Search className="h-4 w-4" />
            <span className="flex-1 text-left">Search disputes, buyers, pages…</span>
            <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 text-[11px]">⌘K</kbd>
          </button>

          <div className="ml-auto flex items-center gap-3">
            <div role="group" aria-label="Signed in as" className="flex rounded-full bg-raised/80 p-0.5 text-xs font-medium">
              {(['investigator', 'admin'] as const).map((r) => (
                <button
                  key={r} aria-pressed={role === r} onClick={() => setRole(r)}
                  className={cn('rounded-full px-3 py-1 transition', role === r ? 'bg-[#636366] text-white shadow-[0_1px_3px_rgba(0,0,0,.4)]' : 'text-slate-300 hover:text-white')}
                >
                  {r === 'admin' ? 'Admin' : 'Investigator'}
                </button>
              ))}
            </div>
            <Badge tone="violet">Demo data</Badge>
            <Badge tone={online ? 'success' : 'danger'} dot>{online ? 'Live' : 'Offline'}</Badge>
            <div className="hidden items-center gap-3 border-l border-line pl-4 sm:flex">
              <div className="grid h-8 w-8 place-items-center rounded-full bg-brand/20 text-xs font-semibold text-brand-soft">{initials(user.name)}</div>
              <div className="leading-tight">
                <div className="text-[13px] font-medium text-white">{user.name}</div>
                <div className="text-xs text-muted">{user.role}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div key={location.pathname} className="mx-auto max-w-[1280px] animate-fade-in space-y-6 p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
