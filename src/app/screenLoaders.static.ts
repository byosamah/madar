import type { ComponentType } from 'react';
import { ForgotScreen } from '../features/auth/ForgotScreen';
import { ResetScreen } from '../features/auth/ResetScreen';
import { SignInScreen } from '../features/auth/SignInScreen';
import { WelcomeScreen } from '../features/auth/WelcomeScreen';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { MeetingView } from '../features/dashboard/MeetingView';
import { InboxScreen } from '../features/inbox/InboxScreen';
import { NotificationsScreen } from '../features/notifications/NotificationsScreen';
import { ConsentScreen } from '../features/oauth/ConsentScreen';
import { ProjectByCode } from '../features/project/ProjectByCode';
import { ProjectScreen } from '../features/project/ProjectScreen';
import { ProjectsScreen } from '../features/projects/ProjectsScreen';
import { SearchScreen } from '../features/search/SearchScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { AdminScreen } from '../features/settings/admin/AdminScreen';
import { TaskListScreen } from '../features/tasklist/TaskListScreen';
import { WorkScreen } from '../features/work/WorkScreen';

/**
 * The screen list of the prototype build, with plain imports (vite.config.ts takes this file in place of screenLoaders.ts).
 * The prototype is one script file, so every screen is in it anyway. Plain imports keep that file as small as before the
 * screens loaded on demand (performance audit BND-1). screenLoaders.test.ts keeps the two lists the same.
 */
export const LOADERS = {
  projects: () => Promise.resolve(ProjectsScreen),
  project: () => Promise.resolve(ProjectScreen),
  work: () => Promise.resolve(WorkScreen),
  inbox: () => Promise.resolve(InboxScreen),
  notifications: () => Promise.resolve(NotificationsScreen),
  search: () => Promise.resolve(SearchScreen),
  tasks: () => Promise.resolve(TaskListScreen),
  dashboard: () => Promise.resolve(DashboardScreen),
  meeting: () => Promise.resolve(MeetingView),
  settings: () => Promise.resolve(SettingsScreen),
  admin: () => Promise.resolve(AdminScreen),
  projectByCode: () => Promise.resolve(ProjectByCode),
  signIn: () => Promise.resolve(SignInScreen),
  welcome: () => Promise.resolve(WelcomeScreen),
  forgot: () => Promise.resolve(ForgotScreen),
  reset: () => Promise.resolve(ResetScreen),
  consent: () => Promise.resolve(ConsentScreen),
} satisfies Record<string, () => Promise<ComponentType>>;
