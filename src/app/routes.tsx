import type { ComponentType, ReactNode } from 'react';
import { createBrowserRouter, createHashRouter, matchRoutes, Navigate, useLocation, type RouteObject, type To } from 'react-router';
import { AppShell } from './AppShell';
import { REMOTE } from './mode';
import { loadForNavigation, screenFor, type ScreenName } from './screens';
import { HomeOrRedirect } from '../features/home/HomeOrRedirect';
import { AuthGate } from '../features/auth/AuthGate';
import { NotFound, RouteError } from './RouteError';
import { GUARD_READS } from './guardReads';
import { RequireRight, StartReads } from './useRight';
import { useIsPhone } from './useIsPhone';
import type { Action } from '../api/permissions';

/**
 * One line of the route table: a screen by its name (src/app/screens.ts), or an element of the first script. The frame, the
 * sign-in gate, Home and the error pages stay in the first script (performance audit BND-1).
 */
type Entry = {
  path?: string; index?: true; screen?: ScreenName; element?: ReactNode; errorElement?: ReactNode; gate?: true; children?: Entry[];
  /** The switch the screen needs (role rights version 2). Without it the address shows the page of a wrong link. */
  right?: Action;
  /** On a phone this address goes to another one (the Settings page is the Me tab). The search and the fragment stay. */
  phoneTo?: (url: { search: string; hash: string }) => To;
  /** On a desk this address goes to another one (the Me tab has no desk page). The search and the fragment stay. */
  deskTo?: string;
};

/**
 * The screens of both builds. The remote build adds the public sign-in screens and puts the meeting view and the shell inside
 * the sign-in gate (plan U2). The prototype has no sign-in, so its routes stay as they were.
 */
function routeTable(remote: boolean): Entry[] {
  const screens: Entry[] = [
    // The meeting view fills the whole screen, so it sits outside the shell with its tabs.
    { path: '/dashboard/meeting', screen: 'meeting', right: 'dashboard.view', errorElement: <RouteError framed /> },
    // The Open space map also fills the screen, so it sits outside the shell as well (feedback fbk_015).
    { path: '/dashboard/space', screen: 'space', right: 'dashboard.view', errorElement: <RouteError framed /> },
    {
      path: '/',
      element: <AppShell />,
      errorElement: <RouteError framed />,
      // A wrong link or a broken screen shows a calm page inside the shell, so the tabs stay (audit 2026-10-03, SHL-6).
      children: ([
        { index: true, element: <HomeOrRedirect /> },
        { path: 'projects', screen: 'projects' },
        { path: 'projects/code/:code', screen: 'projectByCode' },
        { path: 'projects/:projectId', screen: 'project' },
        { path: 'work', screen: 'work' },
        // Meetings are the second view of the Tasks tab (fbk_022).
        { path: 'meetings', screen: 'meetings' },
        { path: 'dashboard', screen: 'dashboard', right: 'dashboard.view' },
        { path: 'inbox/:conversationId?', screen: 'inbox' },
        { path: 'notifications', screen: 'notifications' },
        { path: 'search', screen: 'search', right: 'search.use' },
        { path: 'tasks', screen: 'tasks' },
        // Settings is the Me tab on a phone. The Google return (/settings#google=...) opens the Calendar section there.
        { path: 'settings', screen: 'settings', phoneTo: ({ search, hash }) => ({ pathname: hash.startsWith('#google=') ? '/me/calendar' : '/me', search, hash }) },
        { path: 'me', screen: 'me', deskTo: '/settings' },
        { path: 'me/:section', screen: 'meSection', deskTo: '/settings' },
        { path: 'whats-new', screen: 'whatsNew' },
        // One route for the list and each section, so a change of section keeps the side list (owner, 2026-10-05, item 4).
        { path: 'admin/:section?', screen: 'admin' },
        { path: '*', element: <NotFound /> },
      ] satisfies Entry[]).map((route) => ({ ...route, errorElement: <RouteError /> })),
    },
  ];
  if (!remote) return screens;
  return [
    // The sign-in screens sit outside the shell, as the meeting view does (client map 7.1).
    ...([
      { path: '/sign-in', screen: 'signIn' },
      { path: '/welcome', screen: 'welcome' },
      { path: '/forgot', screen: 'forgot' },
      { path: '/reset', screen: 'reset' },
      { path: '/oauth/consent', screen: 'consent' },
    ] satisfies Entry[]).map((route) => ({ ...route, errorElement: <RouteError framed /> })),
    { element: <AuthGate />, gate: true, children: screens },
  ];
}

/** A screen that needs a switch: the person without it sees the page of a wrong link, and the screen never mounts. A screen with a read list (guardReads.ts) also starts its reads with the session. */
function guarded(Screen: ComponentType, right: Action | undefined, framed: boolean, reads: (typeof GUARD_READS)[ScreenName]): ComponentType {
  const Guarded = () => {
    const inside = right ? <RequireRight action={right} framed={framed}><Screen /></RequireRight> : <Screen />;
    // The reads of the screen start with the session, before the guard lets the screen mount (performance audit 2026-10-21, DF-7).
    return reads ? <StartReads reads={reads} action={right}>{inside}</StartReads> : inside;
  };
  // The guard carries the name of its screen, so the route table reads the same for a tool that lists the screens.
  Object.defineProperty(Guarded, 'name', { value: Screen.name });
  return Guarded;
}

/**
 * A screen with a phone address or a desk address (Settings and Me): the other width gets a redirect that keeps the search and the
 * fragment. The wrapper carries the name of its screen, as the guard does. A phone turned sideways passes 640 px and follows the rule.
 */
function redirecting(Screen: ComponentType, phoneTo: Entry['phoneTo'], deskTo: Entry['deskTo']): ComponentType {
  const Redirecting = () => {
    const phone = useIsPhone();
    const { search, hash } = useLocation();
    const target: To | undefined = phone ? phoneTo?.({ search, hash }) : deskTo === undefined ? undefined : { pathname: deskTo, search, hash };
    return target ? <Navigate to={target} replace /> : <Screen />;
  };
  Object.defineProperty(Redirecting, 'name', { value: Screen.name });
  return Redirecting;
}

/** A loaded screen is the Component of its route. Else the route imports it at the first visit, and the old screen stays meanwhile. */
function toRoute({ screen, gate: _gate, right, phoneTo, deskTo, children, ...rest }: Entry): RouteObject {
  const Component = screen ? screenFor(screen) : undefined;
  // A screen outside the shell shows the page of a wrong link with its own margins.
  const framed = rest.path?.startsWith('/dashboard/') === true;
  const reads = screen ? GUARD_READS[screen] : undefined;
  const guard = (Inner: ComponentType) => {
    const Screen = phoneTo || deskTo ? redirecting(Inner, phoneTo, deskTo) : Inner;
    return right || reads ? guarded(Screen, right, framed, reads) : Screen;
  };
  return {
    ...rest,
    ...(screen ? (Component ? { Component: guard(Component) } : { lazy: async () => ({ Component: guard(await loadForNavigation(screen)) }) }) : {}),
    ...(children ? { children: children.map(toRoute) } : {}),
  } as RouteObject;
}

export function appRoutes(remote: boolean): RouteObject[] {
  return routeTable(remote).map(toRoute);
}

/**
 * The screens that an address shows, and whether it sits behind the sign-in gate. main.tsx loads them before it makes the
 * router, so the router starts with no lazy route at that address: no empty first frame, and no HydrateFallback warning.
 */
export function screensAt(pathname: string, remote: boolean = REMOTE): { screens: ScreenName[]; gated: boolean } {
  const entries = (matchRoutes(routeTable(remote) as RouteObject[], pathname) ?? []).map((match) => match.route as Entry);
  return { screens: entries.flatMap((entry) => (entry.screen ? [entry.screen] : [])), gated: entries.some((entry) => entry.gate) };
}

/**
 * Hash links in the prototype, so it runs on any static host, the review link included. Path links in the remote build, because
 * email links and the agent consent redirect carry a query string on a real path (plan, section 2, change 16).
 */
export function createAppRouter() {
  return REMOTE ? createBrowserRouter(appRoutes(true)) : createHashRouter(appRoutes(false));
}
