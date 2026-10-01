import type { AnimatedIconComponent } from '../components/icons/AnimatedIcon';
import { BellIcon } from '../components/icons/animated/bell';
import { ClipboardCheckIcon } from '../components/icons/animated/clipboard-check';
import { FolderKanbanIcon } from '../components/icons/animated/folder-kanban';
import { HomeIcon } from '../components/icons/animated/home';
import { LayoutGridIcon } from '../components/icons/animated/layout-grid';
import { MessageSquareMoreIcon } from '../components/icons/animated/message-square-more';
import { SearchIcon } from '../components/icons/animated/search';

/** Every tab has a moving icon (owner, 2026-10-01: all icons come from lucide-animated). */
export type NavItem = { to: string; key: string; animated: AnimatedIconComponent; badge?: boolean };

/** The tabs of the floating pill (redesign spec 2.5). Tasks is the person's own task list (owner, 2026-10-01). */
export const NAV: NavItem[] = [
  { to: '/', key: 'nav.home', animated: HomeIcon },
  { to: '/projects', key: 'nav.projects', animated: FolderKanbanIcon },
  { to: '/work', key: 'nav.tasks', animated: ClipboardCheckIcon },
  { to: '/dashboard', key: 'nav.dashboard', animated: LayoutGridIcon },
  { to: '/inbox', key: 'nav.inbox', animated: MessageSquareMoreIcon, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', animated: SearchIcon };

/** The bell beside Search opens the notifications (owner, 2026-10-01). The Inbox tab is the chat. */
export const NOTIFICATIONS_ITEM: NavItem = { to: '/notifications', key: 'nav.notifications', animated: BellIcon };

/** A project belongs to Projects; the lists behind the Dashboard numbers belong to the Dashboard. */
export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  if (to === '/dashboard' && pathname === '/tasks') return true;
  return pathname === to || pathname.startsWith(`${to}/`);
}
