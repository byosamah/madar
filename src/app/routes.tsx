import { createHashRouter } from 'react-router';
import { AppShell } from './AppShell';
import { HomeOrRedirect } from '../features/home/HomeOrRedirect';
import { DashboardScreen } from '../features/dashboard/DashboardScreen';
import { InboxScreen } from '../features/inbox/InboxScreen';
import { ProjectsScreen } from '../features/projects/ProjectsScreen';
import { ProjectByCode } from '../features/project/ProjectByCode';
import { ProjectScreen } from '../features/project/ProjectScreen';
import { SearchScreen } from '../features/search/SearchScreen';
import { TaskListScreen } from '../features/tasklist/TaskListScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { WorkScreen } from '../features/work/WorkScreen';

/** Hash links, so the build runs on any static host, the review link included. */
export function createAppRouter() {
  return createHashRouter([
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <HomeOrRedirect /> },
        { path: 'projects', element: <ProjectsScreen /> },
        { path: 'projects/code/:code', element: <ProjectByCode /> },
        { path: 'projects/:projectId', element: <ProjectScreen /> },
        { path: 'work', element: <WorkScreen /> },
        { path: 'dashboard', element: <DashboardScreen /> },
        { path: 'inbox', element: <InboxScreen /> },
        { path: 'search', element: <SearchScreen /> },
        { path: 'tasks', element: <TaskListScreen /> },
        { path: 'settings', element: <SettingsScreen /> },
      ],
    },
  ]);
}
