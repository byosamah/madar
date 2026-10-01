import { FolderKanban, Home, Inbox, LayoutDashboard, Search } from 'lucide-react';

export type NavItem = { to: string; key: string; icon: typeof Home; badge?: boolean };

/** The four tabs of the floating pill (redesign spec 2.5). My tasks and hours open from Home and the person menu. */
export const NAV: NavItem[] = [
  { to: '/', key: 'nav.home', icon: Home },
  { to: '/projects', key: 'nav.projects', icon: FolderKanban },
  { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', icon: Search };

/** My tasks and the task list belong to Home's family; a project belongs to Projects. */
export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/' || pathname === '/work' || pathname === '/tasks';
  return pathname === to || pathname.startsWith(`${to}/`);
}
