import type React from 'react';
import { ClipboardCheck, Flame, FolderOpen, Gauge, GitCompare, ListChecks, MessageSquareText, ScrollText, Settings, ShieldCheck, Star, TrendingUp, Users } from 'lucide-react';

export const PAGES = [
  { name: 'Overview', to: '/', icon: Gauge, group: 'main' },
  // An investigator only ever sees their own cases, so their case list IS the list of disputes. The manager has a separate list for the cases they own.
  { name: 'Your cases', to: '/queue', icon: FolderOpen, group: 'main', who: 'investigator' },
  { name: 'Your cases', to: '/queue?view=mine', icon: FolderOpen, group: 'main', who: 'manager' },
  { name: 'High profile', to: '/queue?view=high', icon: Star, group: 'main', who: 'manager' },
  { name: 'Manager review', to: '/manager', icon: ShieldCheck, group: 'main', who: 'manager' },
  { name: 'Team', to: '/team', icon: Users, group: 'main', who: 'manager' },
  { name: 'Disputes', to: '/queue', icon: ListChecks, group: 'main', who: 'manager' },
  { name: 'Investigation', to: '/investigate', icon: ClipboardCheck, group: 'main' },
  { name: 'Messages', to: '/messages', icon: MessageSquareText, group: 'main' },
  { name: 'Priority scores', to: '/priority', icon: Flame, group: 'main' },
  { name: 'Similar cases', to: '/similar', icon: GitCompare, group: 'insights' },
  { name: 'Patterns', to: '/patterns', icon: TrendingUp, group: 'insights', who: 'manager' },
  { name: 'Activity log', to: '/audit', icon: ScrollText, group: 'insights' },
  { name: 'Settings', to: '/settings', icon: Settings, group: 'system' },
] as { name: string; to: string; icon: React.ElementType; group: string; who?: 'investigator' | 'manager' }[];

/** Pages meant for one role only. Everything else is for everyone. */
export const visibleTo = (page: { who?: string }, role: 'investigator' | 'manager') => !page.who || page.who === role;
