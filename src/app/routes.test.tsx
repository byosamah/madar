import type { ComponentType, ReactElement } from 'react';
import type { RouteObject } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';
import { appRoutes, createAppRouter, screensAt } from './routes';
import { preloadScreens } from './screens';

const paths = (routes: ReturnType<typeof appRoutes>) => routes.map((route) => route.path ?? '(layout)');

/** The form of a route that a person meets: its path, the screen it shows, its error page and its children. */
type Shape = { path?: string; index?: true; screen?: string; error?: 'framed' | 'plain'; children?: Shape[] };

function shape(route: RouteObject): Shape {
  const element = route.element as ReactElement | undefined;
  const errorElement = route.errorElement as ReactElement<{ framed?: boolean }> | undefined;
  const component = route.Component ?? (element?.type as ComponentType | undefined);
  return {
    ...(route.path === undefined ? {} : { path: route.path }),
    ...(route.index ? { index: true as const } : {}),
    ...(component ? { screen: component.name } : {}),
    ...(errorElement ? { error: errorElement.props.framed ? ('framed' as const) : ('plain' as const) } : {}),
    ...(route.children ? { children: route.children.map(shape) } : {}),
  };
}

/** The route table of the prototype, and of the part inside the sign-in gate of the remote build (2026-10-07). */
const SCREENS: Shape[] = [
  { path: '/dashboard/meeting', screen: 'MeetingView', error: 'framed' },
  {
    path: '/',
    screen: 'AppShell',
    error: 'framed',
    children: [
      { index: true, screen: 'HomeOrRedirect', error: 'plain' },
      { path: 'projects', screen: 'ProjectsScreen', error: 'plain' },
      { path: 'projects/code/:code', screen: 'ProjectByCode', error: 'plain' },
      { path: 'projects/:projectId', screen: 'ProjectScreen', error: 'plain' },
      { path: 'work', screen: 'WorkScreen', error: 'plain' },
      { path: 'dashboard', screen: 'DashboardScreen', error: 'plain' },
      { path: 'inbox/:conversationId?', screen: 'InboxScreen', error: 'plain' },
      { path: 'notifications', screen: 'NotificationsScreen', error: 'plain' },
      { path: 'search', screen: 'SearchScreen', error: 'plain' },
      { path: 'tasks', screen: 'TaskListScreen', error: 'plain' },
      { path: 'settings', screen: 'SettingsScreen', error: 'plain' },
      { path: 'admin/:section?', screen: 'AdminScreen', error: 'plain' },
      { path: '*', screen: 'NotFound', error: 'plain' },
    ],
  },
];

/** The route table of the remote build: the public sign-in screens, then the gate. */
const REMOTE_SCREENS: Shape[] = [
  { path: '/sign-in', screen: 'SignInScreen', error: 'framed' },
  { path: '/welcome', screen: 'WelcomeScreen', error: 'framed' },
  { path: '/forgot', screen: 'ForgotScreen', error: 'framed' },
  { path: '/reset', screen: 'ResetScreen', error: 'framed' },
  { path: '/oauth/consent', screen: 'ConsentScreen', error: 'framed' },
  { screen: 'AuthGate', children: SCREENS },
];

/** Every route of a table, the children included. */
const every = (routes: RouteObject[]): RouteObject[] => routes.flatMap((route) => [route, ...every(route.children ?? [])]);

// These tests run first, while no screen is loaded yet in this file.
describe('the routes before the screens load (performance audit BND-1)', () => {
  it('give each screen route a lazy import and no Component, and keep the frame, the gate, Home and the error pages', () => {
    for (const remote of [false, true]) {
      const routes = every(appRoutes(remote));
      const lazy = routes.filter((route) => route.lazy);
      expect(lazy.length).toBe(remote ? 17 : 12);
      for (const route of lazy) expect(route.Component).toBeUndefined();
      expect(routes.filter((route) => route.element).map((route) => (route.element as ReactElement).type)).toHaveLength(remote ? 4 : 3);
      for (const route of routes) expect(route.errorElement !== undefined || route.path === undefined).toBe(true);
    }
  });

  it('name the screens of an address, and whether the address sits behind the sign-in gate', () => {
    expect(screensAt('/projects/prj_001', true)).toEqual({ screens: ['project'], gated: true });
    expect(screensAt('/', true)).toEqual({ screens: [], gated: true });
    expect(screensAt('/dashboard/meeting', true)).toEqual({ screens: ['meeting'], gated: true });
    expect(screensAt('/admin/people', true)).toEqual({ screens: ['admin'], gated: true });
    expect(screensAt('/no/such/page', true)).toEqual({ screens: [], gated: true });
    expect(screensAt('/sign-in', true)).toEqual({ screens: ['signIn'], gated: false });
    expect(screensAt('/oauth/consent', true)).toEqual({ screens: ['consent'], gated: false });
    expect(screensAt('/inbox/cnv_001', false)).toEqual({ screens: ['inbox'], gated: false });
  });
});

describe('the routes of both builds (plan U2)', () => {
  beforeAll(() => preloadScreens(), 60_000);

  it('give every screen route its Component after the screens load, so the router starts with no lazy route', () => {
    for (const remote of [false, true]) {
      const routes = every(appRoutes(remote));
      expect(routes.filter((route) => route.lazy)).toEqual([]);
      expect(routes.filter((route) => route.Component)).toHaveLength(remote ? 17 : 12);
    }
  });

  it('keeps hash links and no sign-in in the prototype build', async () => {
    const router = createAppRouter();
    await router.navigate('/projects');
    expect(window.location.hash).toBe('#/projects');
    router.dispose();
    expect(paths(appRoutes(false))).toEqual(['/dashboard/meeting', '/']);
  });

  it('puts the meeting view and the shell inside the gate in the remote build, beside the public screens', () => {
    const routes = appRoutes(true);
    expect(paths(routes)).toEqual(['/sign-in', '/welcome', '/forgot', '/reset', '/oauth/consent', '(layout)']);
    expect(paths(routes.at(-1)?.children ?? [])).toEqual(['/dashboard/meeting', '/']);
  });

  it('keeps every path, screen, order, nesting and error page of the route table (performance audit BND-1)', () => {
    expect(appRoutes(false).map(shape)).toEqual(SCREENS);
    expect(appRoutes(true).map(shape)).toEqual(REMOTE_SCREENS);
  });
});
