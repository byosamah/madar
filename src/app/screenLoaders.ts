import type { ComponentType } from 'react';

/**
 * The screens that load on demand (performance audit BND-1). The remote build splits each one into its own chunk, so the
 * first script holds only the frame, the sign-in gate, Home and the error pages.
 * The prototype build takes screenLoaders.static.ts in place of this file (an alias in vite.config.ts): its one script file
 * would wrap each on-demand import in extra start-up code. screenLoaders.test.ts keeps the two lists the same.
 * The order is the order of the prefetch at idle: the likely next screens first.
 */
export const LOADERS = {
  projects: () => import('../features/projects/ProjectsScreen').then((m) => m.ProjectsScreen),
  project: () => import('../features/project/ProjectScreen').then((m) => m.ProjectScreen),
  work: () => import('../features/work/WorkScreen').then((m) => m.WorkScreen),
  inbox: () => import('../features/inbox/InboxScreen').then((m) => m.InboxScreen),
  notifications: () => import('../features/notifications/NotificationsScreen').then((m) => m.NotificationsScreen),
  search: () => import('../features/search/SearchScreen').then((m) => m.SearchScreen),
  tasks: () => import('../features/tasklist/TaskListScreen').then((m) => m.TaskListScreen),
  dashboard: () => import('../features/dashboard/DashboardScreen').then((m) => m.DashboardScreen),
  meeting: () => import('../features/dashboard/MeetingView').then((m) => m.MeetingView),
  space: () => import('../features/space/OpenSpaceScreen').then((m) => m.OpenSpaceScreen),
  settings: () => import('../features/settings/SettingsScreen').then((m) => m.SettingsScreen),
  whatsNew: () => import('../features/whatsNew/WhatsNewScreen').then((m) => m.WhatsNewScreen),
  admin: () => import('../features/settings/admin/AdminScreen').then((m) => m.AdminScreen),
  projectByCode: () => import('../features/project/ProjectByCode').then((m) => m.ProjectByCode),
  signIn: () => import('../features/auth/SignInScreen').then((m) => m.SignInScreen),
  welcome: () => import('../features/auth/WelcomeScreen').then((m) => m.WelcomeScreen),
  forgot: () => import('../features/auth/ForgotScreen').then((m) => m.ForgotScreen),
  reset: () => import('../features/auth/ResetScreen').then((m) => m.ResetScreen),
  consent: () => import('../features/oauth/ConsentScreen').then((m) => m.ConsentScreen),
} satisfies Record<string, () => Promise<ComponentType>>;
