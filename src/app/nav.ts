import { FolderKanban, Inbox, LayoutDashboard, ListChecks, Search } from 'lucide-react';

export type NavItem = { to: string; key: string; icon: typeof FolderKanban; badge?: boolean };

export const NAV: NavItem[] = [
  { to: '/', key: 'nav.projects', icon: FolderKanban },
  { to: '/work', key: 'nav.myWork', icon: ListChecks },
  { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', icon: Search };

export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/' || pathname.startsWith('/projects');
  return pathname === to || pathname.startsWith(`${to}/`);
}
