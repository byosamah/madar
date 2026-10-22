import type { ComponentType } from 'react';
import type { SetURLSearchParams } from 'react-router';
import type { ProjectDetail } from '../../api/contract/views';
import { oneOf } from '../../lib/params';
import { projectMeetingsInput } from '../meetings/readInputs';
import { FilesTab } from './files/FilesTab';
import { ActivityTab, FEED_FILTERS, FEED_PAGE } from './overview/ActivityTab';
import type { Read } from './reads';
import { taskPanelReads } from './tasks/TaskSheet';
import { OverviewTab } from './overview/OverviewTab';
import { ScheduleTab } from './schedule/ScheduleTab';
import { TasksTab } from './tasks/TasksTab';
import { TeamTab } from './team/TeamTab';
import { TrackerTab } from './tracker/TrackerTab';

export const PROJECT_TABS = ['overview', 'tasks', 'activity', 'tracker', 'schedule', 'files', 'team'] as const;
/** The five tabs of a phone (phone D). Activity, Schedule and Team are pages inside More. */
export const PHONE_TABS = ['overview', 'tasks', 'tracker', 'files', 'more'] as const;
export const MORE_PAGES = ['activity', 'schedule', 'team'] as const;
export type ProjectPhoneTab = (typeof PHONE_TABS)[number];
export type MorePage = (typeof MORE_PAGES)[number];
/** A desk tab, or `more` (the list of More, on a phone only). */
export type ProjectTab = (typeof PROJECT_TABS)[number] | 'more';
export type TabProps = { detail: ProjectDetail };

/** The tab of the `?tab=` link. A desk knows the seven desk tabs. A phone knows its five tabs and the three pages of More. */
export function tabOfLink(raw: string | null, phone: boolean): ProjectTab {
  const known: readonly string[] = phone ? [...PHONE_TABS, ...MORE_PAGES] : PROJECT_TABS;
  return raw !== null && known.includes(raw) ? (raw as ProjectTab) : 'overview';
}

/** The phone tab that shows as open: More for More and for each page inside it. */
export function litPhoneTab(tab: ProjectTab): ProjectPhoneTab {
  return isMorePage(tab) ? 'more' : tab;
}

export function isMorePage(tab: ProjectTab): tab is MorePage {
  return (MORE_PAGES as readonly string[]).includes(tab);
}

/** The filter choices of the tabs. They live in the link and stay there across tabs (audit 2026-10-03, PRJ-22). */
export const FILTER_PARAMS = ['show', 'done', 'feed', 'type', 'side', 'open'] as const;

/** The link of another tab. It keeps the filters of the tabs and drops an open panel (audit 2026-10-03, PRJ-22). */
export function tabSearch(current: URLSearchParams, next: ProjectTab): URLSearchParams {
  const value = new URLSearchParams({ tab: next });
  for (const key of FILTER_PARAMS) {
    const kept = current.get(key);
    if (kept) value.set(key, kept);
  }
  return value;
}

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
  more: null,
};

// The Show choices of the Tasks tab (TasksTab.tsx). tabs.test.tsx checks that each choice gives the key that the tab mounts.
const TASK_FILTERS = ['all', 'mine', 'overdue', 'flagged', 'no_lead'] as const;

/**
 * The reads that a tab mounts first, with the exact keys of their useCall (performance audit 2026-10-07, FET-2 and LIV-1).
 * ProjectScreen starts them with projects.get, so the tab finds its answers in the cache and shows after one round trip, not
 * two or three. payments: the person may manage payments (the Overview shows them only then). today: the office day, for the
 * meetings panel of the Overview (fbk_022). templates: the cached session may add a to-do and the list view shows, so the template menus
 * of the Tasks tab find their answer at once (DF-13). A link with a task opens the
 * task panel on the Overview and on Tasks, so those two tabs also start the reads of the panel. A tab that is not here loads
 * as before. tabs.test.tsx compares each list with the keys that the tab mounts.
 */
export function tabReads(tab: ProjectTab, projectId: string, params: URLSearchParams, o: { payments: boolean; today: string; templates?: boolean }): Read[] {
  const reads: Read[] = [];
  if (tab === 'overview') {
    reads.push(
      { name: 'tasks.list', input: { projectId, activeProjectsOnly: false } },
      { name: 'updates.list', input: { projectId, filter: 'posts' } },
      { name: 'tracker.list', input: { projectId, openOnly: true } },
      { name: 'meetings.list', input: projectMeetingsInput(projectId, o.today) },
    );
    if (o.payments) reads.push({ name: 'payments.list', input: { projectId } });
  } else if (tab === 'tasks') {
    reads.push({ name: 'tasks.list', input: { projectId, filter: oneOf(params.get('show'), TASK_FILTERS, 'all'), activeProjectsOnly: false } });
    if (o.templates) reads.push({ name: 'taskTemplates.list', input: {} });
  } else if (tab === 'activity') {
    reads.push({ name: 'updates.list', input: { projectId, filter: oneOf(params.get('feed'), FEED_FILTERS, 'all'), limit: FEED_PAGE } });
  } else if (tab === 'files') {
    reads.push({ name: 'files.list', input: { projectId } });
  }
  const taskId = params.get('task');
  if (taskId && (tab === 'overview' || tab === 'tasks')) reads.push(...taskPanelReads(taskId, projectId, params.get('thread') === '1'));
  return reads;
}
