import { beforeAll, describe, expect, it } from 'vitest';
import { rememberProjectsList } from './lastList';
import { backLinkOf } from './phoneBack';

const both = { mayDashboard: true, isAdmin: true };

describe('backLinkOf', () => {
  beforeAll(() => rememberProjectsList('?filter=late'));

  it('project page -> Projects list', () => {
    expect(backLinkOf('/projects/prj_001', both)).toEqual({ to: '/projects?filter=late', key: 'project.back' });
  });

  it.each(['/me/profile', '/whats-new', '/dashboard', '/admin'])('%s -> Me', (p) => {
    expect(backLinkOf(p, both)).toEqual({ to: '/me', key: 'phoneShell.tab.me' });
  });

  it('/tasks -> Dashboard with dashboard.view, else Me', () => {
    expect(backLinkOf('/tasks', both)).toEqual({ to: '/dashboard', key: 'nav.dashboard' });
    expect(backLinkOf('/tasks', { ...both, mayDashboard: false })).toEqual({ to: '/me', key: 'phoneShell.tab.me' });
  });

  it('/admin/:section -> Admin for the Admin, Office for others', () => {
    expect(backLinkOf('/admin/people', both)).toEqual({ to: '/admin', key: 'admin.title' });
    expect(backLinkOf('/admin/people', { ...both, isAdmin: false })).toEqual({ to: '/admin', key: 'adminPage.officeTitle' });
  });

  it.each(['/', '/inbox', '/inbox/cnv_1', '/notifications', '/work', '/meetings', '/projects', '/me', '/settings', '/search', '/nope', '/projects/code/ABC'])(
    '%s -> the mark (null)',
    (p) => expect(backLinkOf(p, both)).toBeNull(),
  );
});
