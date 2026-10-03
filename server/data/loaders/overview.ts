import type { Event, Task } from '../../../src/api/contract/entities';
import { teamFilter } from '../../../src/api/pause';
import { can, projectRoleOf } from '../../../src/api/permissions';
import { commentCountKey, fileCountKey } from '../../../src/api/store';
import { normalizeForSearch } from '../../../src/lib/text';
import type { Cond } from './query';
import type { Load } from './build';
import { covers, eventTargets, feed, officeState, tasksOf } from './steps';

/**
 * The overview loader (plan 4.6): the calls that read across projects. The project filters of each call read only the office,
 * so the loader applies them first and loads the tasks of the projects that stay. A read never saves, so projects.list and
 * dashboard.get load only the task fields they read (AM 9); tasks.list returns whole tasks and loads whole rows.
 */

type Input = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The task fields that summaryOf, computeHealth, the stage tag and the feed labels read (projects.list). */
export const PROJECT_LIST_TASK_FIELDS = ['id', 'projectId', 'stageId', 'status', 'dueDate', 'title'] as const;
/** The task fields of the dashboard: health, stage tag, overdue, throughput and workload (insights.ts). */
export const DASHBOARD_TASK_FIELDS = ['id', 'projectId', 'stageId', 'status', 'dueDate', 'ownerId', 'helperIds', 'createdAt', 'completedAt'] as const;

/** projects.list: the projects that pass the filters on the project, each with its tasks, its newest 2 posts and events, and its cover. */
export async function projectsList(L: Load, input: Input): Promise<void> {
  const office = officeState(L);
  const inTeam = teamFilter(office, str(input.teamId));
  const status = str(input.status) ?? 'active';
  const ids = Object.values(L.office.projects)
    .filter((p) => status === 'all' || p.status === status)
    .filter((p) => input.filter !== 'mine' || (L.authority !== undefined && projectRoleOf(office, p.id, L.authority.id) !== 'other'))
    .filter((p) => !input.leaderId || p.leaderId === input.leaderId)
    .filter((p) => !input.clientId || p.clientId === input.clientId)
    .filter(inTeam)
    .map((p) => p.id);
  await tasksOf(L, ids, PROJECT_LIST_TASK_FIELDS);
  await feed(L, ids, 'all', 2);
  await covers(L, ids);
}

/** dashboard.get: the tasks of the projects in scope, and their open client items (the Tracker loops). */
export async function dashboardGet(L: Load, input: Input): Promise<void> {
  const inTeam = teamFilter(officeState(L), str(input.teamId));
  const status = str(input.status) ?? 'active';
  const ids = Object.values(L.office.projects)
    .filter((p) => (status === 'all' || p.status === status) && (!input.leaderId || p.leaderId === input.leaderId)
      && (!input.clientId || p.clientId === input.clientId) && inTeam(p))
    .map((p) => p.id);
  await tasksOf(L, ids, DASHBOARD_TASK_FIELDS);
  await L.select({ c: 'tracker', where: [{ col: 'project_id', in: ids }, { col: 'open', eq: true }], pick: ['id', 'projectId', 'waiting', 'closedAt'] });
}

/**
 * tasks.list, with or without projectId: the tasks of the projects that pass the project filters, narrowed in SQL by the filters
 * that the handler also applies (a person, a status, done or not), with their comment and file counts. A listed open task that
 * waits for others brings every task of its project, for its "waiting for" list.
 */
export async function tasksList(L: Load, input: Input): Promise<void> {
  const office = officeState(L);
  const inTeam = teamFilter(office, str(input.teamId));
  const ids = Object.values(L.office.projects)
    .filter((p) => (input.activeProjectsOnly === false || p.status === 'active') && inTeam(p) && (!input.projectId || p.id === input.projectId))
    .map((p) => p.id);
  const person = str(input.ownerId) ?? (input.filter === 'mine' ? L.authority?.id : undefined);
  const where: Cond[] = [{ col: 'project_id', in: ids }];
  if (person) where.push({ or: [{ col: 'owner_id', in: [person] }, { has: 'helperIds', value: person }] });
  if (input.filter === 'review_for_me') where.push({ col: 'status', in: ['in_review'] });
  if (Array.isArray(input.status)) where.push({ col: 'status', in: input.status as string[] });
  if (input.includeDone === false) where.push({ col: 'status', notIn: ['done'] });
  if (input.filter === 'flagged') where.push({ field: 'flagged', in: ['true'] });
  const tasks = (await L.select({ c: 'tasks', where })) as Task[];
  const waiting = tasks.filter((t) => t.status !== 'done'
    && ((t.prerequisiteIds ?? []).length > 0 || (L.office.stages[t.stageId]?.prerequisiteIds ?? []).length > 0));
  await tasksOf(L, waiting.map((t) => t.projectId));
  await L.counts('comments', 'target_id', tasks.map((t) => t.id), commentCountKey);
  await L.counts('files', 'task_id', tasks.map((t) => t.id), fileCountKey);
}

/** search.query: the first 5 tasks of active projects and the first 5 files whose search text holds the query (AM 4.9). */
export async function searchQuery(L: Load, input: Input): Promise<void> {
  const query = normalizeForSearch(String(input.text ?? '').replace(/^[#@]+/, ''));
  if (!query) return;
  const active = Object.values(L.office.projects).filter((p) => p.status === 'active').map((p) => p.id);
  await L.select({ c: 'tasks', where: [{ col: 'project_id', in: active }, { col: 'search_text', contains: query }], limit: 5 });
  await L.select({ c: 'files', where: [{ col: 'search_text', contains: query }], limit: 5 });
}

/** events.list: the newest "limit" events that pass the filter and that the person may read, with the rows their labels name. */
export async function eventsList(L: Load, input: Input): Promise<void> {
  if (!L.authority) return;
  const where: Cond[] = [];
  const hidden = [...(can(L.authority, 'payment.manage') ? [] : ['payment']), ...(can(L.authority, 'admin.manage') ? [] : ['feedback'])];
  if (hidden.length > 0) where.push({ col: 'target_type', notIn: hidden });
  for (const [field, col] of [['projectId', 'project_id'], ['targetType', 'target_type'], ['targetId', 'target_id'], ['correlationId', 'correlation_id']] as const) {
    const value = str(input[field]);
    if (value) where.push({ col, in: [value] });
  }
  const since = str(input.since);
  if (since) where.push({ col: 'created_at', atOrAfter: since });
  const events = (await L.select({ c: 'events', where, order: { col: 'seq', desc: true }, limit: (input.limit as number | undefined) ?? 50 })) as Event[];
  await eventTargets(L, events);
}
