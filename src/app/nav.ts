import { FolderKanban, Inbox, LayoutDashboard, ListChecks, Search } from 'lucide-react';

// tabKey: a one-word label for the phone tab bar (Apple: tab labels are single words).
export type NavItem = { to: string; key: string; tabKey?: string; icon: typeof FolderKanban; badge?: boolean };

export const NAV: NavItem[] = [
  { to: '/', key: 'nav.projects', icon: FolderKanban },
  { to: '/work', key: 'nav.myWork', icon: ListChecks },
  { to: '/dashboard', key: 'nav.dashboard', tabKey: 'nav.dashboardTab', icon: LayoutDashboard },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', icon: Search };

export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/' || pathname.startsWith('/projects');
  return pathname === to || pathname.startsWith(`${to}/`);
}
