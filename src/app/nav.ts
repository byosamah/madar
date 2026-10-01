import { Bell, FolderKanban, Home, Inbox, LayoutDashboard, ListChecks, Search, type LucideIcon } from 'lucide-react';
import type { AnimatedIconComponent } from '../components/icons/AnimatedIcon';
import { BellIcon } from '../components/icons/animated/bell';
import { FolderKanbanIcon } from '../components/icons/animated/folder-kanban';
import { HomeIcon } from '../components/icons/animated/home';
import { LayoutGridIcon } from '../components/icons/animated/layout-grid';
import { SearchIcon } from '../components/icons/animated/search';

/** `animated` is the moving icon. A tab with no animated version keeps its static `icon`. */
export type NavItem = { to: string; key: string; icon: LucideIcon; animated?: AnimatedIconComponent; badge?: boolean };

/** The tabs of the floating pill (redesign spec 2.5). Tasks is the person's own task list (owner, 2026-10-01). */
export const NAV: NavItem[] = [
  { to: '/', key: 'nav.home', icon: Home, animated: HomeIcon },
  { to: '/projects', key: 'nav.projects', icon: FolderKanban, animated: FolderKanbanIcon },
  { to: '/work', key: 'nav.tasks', icon: ListChecks },
  { to: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard, animated: LayoutGridIcon },
  { to: '/inbox', key: 'nav.inbox', icon: Inbox, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', icon: Search, animated: SearchIcon };

/** The bell beside Search opens the notifications (owner, 2026-10-01). The Inbox tab is the chat. */
export const NOTIFICATIONS_ITEM: NavItem = { to: '/notifications', key: 'nav.notifications', icon: Bell, animated: BellIcon };

/** A project belongs to Projects; the lists behind the Dashboard numbers belong to the Dashboard. */
export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  if (to === '/dashboard' && pathname === '/tasks') return true;
  return pathname === to || pathname.startsWith(`${to}/`);
}
