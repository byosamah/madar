import { createBrowserRouter, createHashRouter, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { REMOTE } from './mode';
import { HomeOrRedirect } from '../features/home/HomeOrRedirect';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { MeetingView } from '../features/dashboard/MeetingView';
import { InboxScreen } from '../features/inbox/InboxScreen';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { ProjectsScreen } from '../features/projects/ProjectsScreen';
import { ProjectByCode } from '../features/project/ProjectByCode';
import { ProjectScreen } from '../features/project/ProjectScreen';
import { SearchScreen } from '../features/search/SearchScreen';
import { TaskListScreen } from '../features/tasklist/TaskListScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { AdminScreen } from '../features/settings/admin/AdminScreen';
import { WorkScreen } from '../features/work/WorkScreen';
import { AuthGate } from '../features/auth/AuthGate';
import { ForgotScreen } from '../features/auth/ForgotScreen';
import { ResetScreen } from '../features/auth/ResetScreen';
import { SignInScreen } from '../features/auth/SignInScreen';
import { WelcomeScreen } from '../features/auth/WelcomeScreen';
import { ConsentScreen } from '../features/oauth/ConsentScreen';
import { NotFound, RouteError } from './RouteError';

/**
 * The screens of both builds. The remote build adds the public sign-in screens and puts the meeting view and the shell inside
 * the sign-in gate (plan U2). The prototype has no sign-in, so its routes stay as they were.
 */
export function appRoutes(remote: boolean): RouteObject[] {
  const screens: RouteObject[] = [
    // The meeting view fills the whole screen, so it sits outside the shell with its tabs.
    { path: '/dashboard/meeting', element: <MeetingView />, errorElement: <RouteError framed /> },
    {
      path: '/',
      element: <AppShell />,
      errorElement: <RouteError framed />,
      // A wrong link or a broken screen shows a calm page inside the shell, so the tabs stay (audit 2026-10-03, SHL-6).
      children: [
        { index: true, element: <HomeOrRedirect /> },
        { path: 'projects', element: <ProjectsScreen /> },
        { path: 'projects/code/:code', element: <ProjectByCode /> },
        { path: 'projects/:projectId', element: <ProjectScreen /> },
        { path: 'work', element: <WorkScreen /> },
        { path: 'dashboard', element: <DashboardScreen /> },
        { path: 'inbox/:conversationId?', element: <InboxScreen /> },
        { path: 'notifications', element: <NotificationsScreen /> },
        { path: 'search', element: <SearchScreen /> },
        { path: 'tasks', element: <TaskListScreen /> },
        { path: 'settings', element: <SettingsScreen /> },
        // One route for the list and each section, so a change of section keeps the side list (owner, 2026-10-05, item 4).
        { path: 'admin/:section?', element: <AdminScreen /> },
        { path: '*', element: <NotFound /> },
      ].map((route) => ({ ...route, errorElement: <RouteError /> })),
    },
  ];
  if (!remote) return screens;
  return [
    // The sign-in screens sit outside the shell, as the meeting view does (client map 7.1).
    ...[
      { path: '/sign-in', element: <SignInScreen /> },
      { path: '/welcome', element: <WelcomeScreen /> },
      { path: '/forgot', element: <ForgotScreen /> },
      { path: '/reset', element: <ResetScreen /> },
      { path: '/oauth/consent', element: <ConsentScreen /> },
    ].map((route) => ({ ...route, errorElement: <RouteError framed /> })),
    { element: <AuthGate />, children: screens },
  ];
}

/**
 * Hash links in the prototype, so it runs on any static host, the review link included. Path links in the remote build, because
 * email links and the agent consent redirect carry a query string on a real path (plan, section 2, change 16).
 */
export function createAppRouter() {
  return REMOTE ? createBrowserRouter(appRoutes(true)) : createHashRouter(appRoutes(false));
}
