import type { ComponentType } from 'react';
import type { SetURLSearchParams } from 'react-router';
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

/** The filter choices of the tabs. They live in the link and stay there across tabs (audit 2026-10-03, PRJ-22). */
export const FILTER_PARAMS = ['show', 'done', 'feed', 'type', 'side', 'open'] as const;

/** A change to one filter of the link. It replaces the link, so Back leaves the screen and does not step through filters. */
export function setFilterParam(setParams: SetURLSearchParams, key: (typeof FILTER_PARAMS)[number], value: string | null): void {
  setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === null) next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });
}

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
