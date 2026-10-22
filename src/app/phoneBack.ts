import { projectsListLink } from './lastList';

const PROJECT_PAGE = /^\/projects\/[^/]+$/;
const ME_SECTION = /^\/me\/[^/]+$/;
const ADMIN_SECTION = /^\/admin\/[^/]+$/;

/**
 * The back link at the start of the phone top row (Direction D). `key` is the word key of the link. A screen with no entry
 * shows the Madar mark instead (null). The tab screens never have a back link.
 */
export function backLinkOf(pathname: string, ctx: { mayDashboard: boolean; isAdmin: boolean }): { to: string; key: string } | null {
  if (PROJECT_PAGE.test(pathname)) return { to: projectsListLink(), key: 'project.back' };
  if (ME_SECTION.test(pathname) || pathname === '/whats-new' || pathname === '/dashboard' || pathname === '/admin') {
    return { to: '/me', key: 'phoneShell.tab.me' };
  }
  if (pathname === '/tasks') return ctx.mayDashboard ? { to: '/dashboard', key: 'nav.dashboard' } : { to: '/me', key: 'phoneShell.tab.me' };
  if (ADMIN_SECTION.test(pathname)) return { to: '/admin', key: ctx.isAdmin ? 'admin.title' : 'adminPage.officeTitle' };
  return null;
}
