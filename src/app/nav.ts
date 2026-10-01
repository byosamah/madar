import { Bell, FolderKanban, Home, Inbox, LayoutDashboard, ListChecks, Search } from 'lucide-react';

export type NavItem = { to: string; key: string; icon: typeof Home; badge?: boolean };

/** The tabs of the floating pill (redesign spec 2.5). Tasks is the person's own task list (owner, 2026-10-01). */
export const NAV: NavItem[] = [
  { to: '/', key: 'nav.home', icon: Home },
  { to: '/projects', key: 'nav.projects', icon: FolderKanban },
  { to: '/work', key: 'nav.tasks', icon: ListChecks },
  { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', icon: Search };

/** The bell beside Search opens the notifications (owner, 2026-10-01). The Inbox tab is the chat. */
export const NOTIFICATIONS_ITEM: NavItem = { to: '/notifications', key: 'nav.notifications', icon: Bell };

/** A project belongs to Projects; the lists behind the Dashboard numbers belong to the Dashboard. */
export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  if (to === '/dashboard' && pathname === '/tasks') return true;
  return pathname === to || pathname.startsWith(`${to}/`);
}
