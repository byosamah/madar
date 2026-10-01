import type { ComponentType } from 'react';
import type { ProjectDetail } from '../../api/contract/views';
import { FilesTab } from './files/FilesTab';
import { ActivityTab } from './overview/ActivityTab';
import { OverviewTab } from './overview/OverviewTab';
import { ScheduleTab } from './schedule/ScheduleTab';
import { TasksTab } from './tasks/TasksTab';
import { TeamTab } from './team/TeamTab';
import { TrackerTab } from './tracker/TrackerTab';

export const PROJECT_TABS = ['overview', 'tasks', 'activity', 'tracker', 'schedule', 'files', 'team'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export type TabProps = { detail: ProjectDetail };

/** The body of each tab. Each later task of plan 2 fills in its own line. */
export const TAB_BODY: Record<ProjectTab, ComponentType<TabProps> | null> = {
  overview: OverviewTab,
  tasks: TasksTab,
  activity: ActivityTab,
  tracker: TrackerTab,
  schedule: ScheduleTab,
  files: FilesTab,
  team: TeamTab,
};
