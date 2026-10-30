import type React from 'react';
import { ClipboardCheck, Flame, FolderOpen, Gauge, GitCompare, ListChecks, MessageSquareText, ScrollText, Settings, ShieldCheck, TrendingUp } from 'lucide-react';

export const PAGES = [
  { name: 'Overview', to: '/', icon: Gauge, group: 'main' },
  { name: 'Your cases', to: '/queue?view=mine', icon: FolderOpen, group: 'main', who: 'investigator' },
  { name: 'Admin review', to: '/admin', icon: ShieldCheck, group: 'main', who: 'admin' },
  { name: 'Disputes', to: '/queue', icon: ListChecks, group: 'main' },
  { name: 'Investigation', to: '/investigate', icon: ClipboardCheck, group: 'main' },
  { name: 'Messages', to: '/messages', icon: MessageSquareText, group: 'main' },
  { name: 'Priority scores', to: '/priority', icon: Flame, group: 'main' },
  { name: 'Similar cases', to: '/similar', icon: GitCompare, group: 'insights' },
  { name: 'Patterns', to: '/patterns', icon: TrendingUp, group: 'insights' },
  { name: 'Activity log', to: '/audit', icon: ScrollText, group: 'insights' },
  { name: 'Settings', to: '/settings', icon: Settings, group: 'system' },
] as { name: string; to: string; icon: React.ElementType; group: string; who?: 'investigator' | 'admin' }[];

/** Pages meant for one role only. Everything else is for everyone. */
export const visibleTo = (page: { who?: string }, role: 'investigator' | 'admin') => !page.who || page.who === role;
