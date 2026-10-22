import type { Action } from '../api/permissions';
import type { AnimatedIconComponent } from '../components/icons/AnimatedIcon';
import { BellIcon } from '../components/icons/animated/bell';
import { BriefcaseIcon } from '../components/icons/animated/briefcase';
import { ClipboardCheckIcon } from '../components/icons/animated/clipboard-check';
import { FolderKanbanIcon } from '../components/icons/animated/folder-kanban';
import { HomeIcon } from '../components/icons/animated/home';
import { LayoutGridIcon } from '../components/icons/animated/layout-grid';
import { InboxIcon } from '../components/icons/animated/inbox';
import { SearchIcon } from '../components/icons/animated/search';
import { SunIcon } from '../components/icons/animated/sun';
import { UserIcon } from '../components/icons/animated/user';

/** Every tab has a moving icon (owner, 2026-10-01: all icons come from lucide-animated). */
export type NavItem = {
  to: string; key: string; animated: AnimatedIconComponent; badge?: boolean;
  /** The switch the tab needs (role rights version 2). A person without it sees no tab and no link to the screen. */
  right?: Action;
};

/** The tabs of the floating pill (redesign spec 2.5). Tasks is the person's own task list (owner, 2026-10-01). */
export const NAV: NavItem[] = [
  { to: '/', key: 'nav.home', animated: HomeIcon },
  { to: '/projects', key: 'nav.projects', animated: FolderKanbanIcon },
  { to: '/work', key: 'nav.tasks', animated: ClipboardCheckIcon },
  { to: '/dashboard', key: 'nav.dashboard', animated: LayoutGridIcon, right: 'dashboard.view' },
  { to: '/inbox', key: 'nav.inbox', animated: InboxIcon, badge: true },
];

export const SEARCH_ITEM: NavItem = { to: '/search', key: 'nav.search', animated: SearchIcon, right: 'search.use' };

/** The bell beside Search opens the notifications (owner, 2026-10-01). The Inbox tab is the chat. */
export const NOTIFICATIONS_ITEM: NavItem = { to: '/notifications', key: 'nav.notifications', animated: BellIcon };

/** A project belongs to Projects; the lists behind the Dashboard numbers belong to the Dashboard. */
export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  if (to === '/dashboard' && pathname === '/tasks') return true;
  // Meetings are the second view of the Tasks tab (fbk_022).
  if (to === '/work' && pathname === '/meetings') return true;
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The four tabs of the phone bar (Direction D, 2026-10-22). Each has a word under its icon. No tab needs a switch. */
export type PhoneTab = 'today' | 'inbox' | 'work' | 'me';

export const PHONE_NAV: { tab: PhoneTab; to: string; key: string; animated: AnimatedIconComponent }[] = [
  { tab: 'today', to: '/', key: 'phoneShell.tab.today', animated: SunIcon },
  { tab: 'inbox', to: '/inbox', key: 'phoneShell.tab.inbox', animated: InboxIcon },
  { tab: 'work', to: '/work', key: 'phoneShell.tab.work', animated: BriefcaseIcon },
  { tab: 'me', to: '/me', key: 'phoneShell.tab.me', animated: UserIcon },
];

const PHONE_EXACT: Record<string, PhoneTab> = {
  '/': 'today',
  '/inbox': 'inbox', '/notifications': 'inbox',
  '/work': 'work', '/meetings': 'work', '/projects': 'work',
  '/me': 'me', '/settings': 'me', '/whats-new': 'me', '/dashboard': 'me', '/tasks': 'me', '/admin': 'me',
};
const PHONE_PREFIX: [string, PhoneTab][] = [['/inbox/', 'inbox'], ['/projects/', 'work'], ['/me/', 'me'], ['/admin/', 'me']];

/** The phone tab that a screen belongs to, or null for a screen with no tab (Search, a wrong link). */
export function phoneTabOf(pathname: string): PhoneTab | null {
  const exact = PHONE_EXACT[pathname];
  if (exact) return exact;
  return PHONE_PREFIX.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? null;
}
