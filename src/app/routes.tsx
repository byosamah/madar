import { createHashRouter } from 'react-router';
import { AppShell } from './AppShell';
import { Placeholder } from '../features/placeholder/Placeholder';
import { ProjectsScreen } from '../features/projects/ProjectsScreen';
import { ProjectByCode } from '../features/project/ProjectByCode';
import { ProjectScreen } from '../features/project/ProjectScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

/** Hash links, so the build runs on any static host, the review link included. */
export function createAppRouter() {
  return createHashRouter([
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <ProjectsScreen /> },
        { path: 'projects/code/:code', element: <ProjectByCode /> },
        { path: 'projects/:projectId', element: <ProjectScreen /> },
        { path: 'work', element: <Placeholder titleKey="screens.myWork" step={3} /> },
        { path: 'dashboard', element: <Placeholder titleKey="screens.dashboard" step={4} /> },
        { path: 'inbox', element: <Placeholder titleKey="screens.inbox" step={3} /> },
        { path: 'search', element: <Placeholder titleKey="screens.search" step={3} /> },
        { path: 'tasks', element: <Placeholder titleKey="screens.tasks" step={4} /> },
        { path: 'settings', element: <SettingsScreen /> },
      ],
    },
  ]);
}
