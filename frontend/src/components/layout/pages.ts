import { ClipboardCheck, Flame, Gauge, GitCompare, ListChecks, MessageSquareText, ScrollText, Settings, TrendingUp } from 'lucide-react';

export const PAGES = [
  { name: 'Overview', to: '/', icon: Gauge, group: 'main' },
  { name: 'Disputes', to: '/queue', icon: ListChecks, group: 'main' },
  { name: 'Investigation', to: '/investigate', icon: ClipboardCheck, group: 'main' },
  { name: 'Messages', to: '/messages', icon: MessageSquareText, group: 'main' },
  { name: 'Priority scores', to: '/priority', icon: Flame, group: 'main' },
  { name: 'Similar cases', to: '/similar', icon: GitCompare, group: 'insights' },
  { name: 'Patterns', to: '/patterns', icon: TrendingUp, group: 'insights' },
  { name: 'Activity log', to: '/audit', icon: ScrollText, group: 'insights' },
  { name: 'Settings', to: '/settings', icon: Settings, group: 'system' },
] as const;
