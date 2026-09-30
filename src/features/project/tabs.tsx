import type { ComponentType } from 'react';
import type { ProjectDetail } from '../../api/contract/views';
import { FilesTab } from './files/FilesTab';
import { OverviewTab } from './overview/OverviewTab';
import { ScheduleTab } from './schedule/ScheduleTab';
import { TasksTab } from './tasks/TasksTab';

export const PROJECT_TABS = ['overview', 'tasks', 'schedule', 'files', 'team'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
export type TabProps = { detail: ProjectDetail };

/** The body of each tab. Each later task of plan 2 fills in its own line. */
export const TAB_BODY: Record<ProjectTab, ComponentType<TabProps> | null> = {
  overview: OverviewTab,
  tasks: TasksTab,
  schedule: ScheduleTab,
  files: FilesTab,
  team: null,
};
