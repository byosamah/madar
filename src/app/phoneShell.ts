import { NAV, PHONE_NAV, isNavActive, phoneTabOf } from './nav';

const PROJECT_PAGE = /^\/projects\/[^/]+$/;

/**
 * The key of the screen entrance. The chat is one screen: opening another conversation keeps the list, its search and its place.
 * The Admin page is one screen too (owner, 2026-10-05, item 4). The switch between Tasks and Meetings keeps the screen, so the
 * entrance does not play again. On a phone the three Work views (Work, Meetings, Projects) are one screen, and the two Inbox views
 * (chats and Notifications) are one screen.
 */
export function screenKey(pathname: string, phone: boolean): string {
  if (pathname.startsWith('/inbox/')) return '/inbox';
  if (pathname.startsWith('/admin/')) return '/admin';
  if (pathname === '/meetings') return '/work';
  if (phone) {
    if (pathname === '/projects') return '/work';
    if (pathname === '/notifications') return '/inbox';
  }
  return pathname;
}

/**
 * The index of the tab of a screen, for the side that the next screen slides in from. -1 for a project page (it has its own
 * entrance) and for a path with no tab. A phone counts its four tabs (Today 0, Inbox 1, Work 2, Me 3); a desk counts the pill.
 */
export function tabIndexOf(pathname: string, phone: boolean): number {
  if (PROJECT_PAGE.test(pathname)) return -1;
  if (phone) {
    const tab = phoneTabOf(pathname);
    return tab === null ? -1 : PHONE_NAV.findIndex((item) => item.tab === tab);
  }
  return NAV.findIndex((item) => isNavActive(item.to, pathname));
}
