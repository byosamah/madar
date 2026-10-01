import type { ComponentType } from 'react';
import type { ProjectDetail } from '../../api/contract/views';
import { FilesTab } from './files/FilesTab';
import { ActivityTab } from './overview/ActivityTab';
import { OverviewTab } from './overview/OverviewTab';
import { ScheduleTab } from './schedule/ScheduleTab';
import { TasksTab } from './tasks/TasksTab';
import { TeamTab } from './team/TeamTab';

export const PROJECT_TABS = ['overview', 'tasks', 'activity', 'schedule', 'files', 'team'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export type TabProps = { detail: ProjectDetail };

/** The body of each tab. Each later task of plan 2 fills in its own line. */
export const TAB_BODY: Record<ProjectTab, ComponentType<TabProps> | null> = {
  overview: OverviewTab,
  tasks: TasksTab,
  activity: ActivityTab,
  schedule: ScheduleTab,
  files: FilesTab,
  team: TeamTab,
};
