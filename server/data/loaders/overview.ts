import type { Comment, Event, Task } from '../../../src/api/contract/entities';
import { peopleFilter, teamFilter } from '../../../src/api/pause';
import { can, projectRoleOf } from '../../../src/api/permissions';
import { commentCountKey, fileCountKey } from '../../../src/api/store';
import { stagesOf } from '../../../src/api/views';
import { canSeeConversation } from '../../../src/api/chatState';
import { MESSAGE_HITS } from '../../../src/api/messageSearch';
import { searchesMessages, searchWords } from '../../../src/lib/searchMatch';
import { normalizeForSearch } from '../../../src/lib/text';
import type { Cond } from './query';
import type { Load } from './build';
import { covers, eventTargets, feed, LIVE, officeState, officeTasks, tasksOf } from './steps';

/**
 * The overview loader (plan 4.6): the calls that read across projects. The project filters of each call read only the office,
 * so the loader applies them first and loads the tasks of the projects that stay. A read never saves, so projects.list and
 * dashboard.get load only the task fields they read (AM 9); tasks.list returns whole tasks and loads whole rows.
 */

type Input = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The task fields that summaryOf, computeHealth, the stage tag and the feed labels read (projects.list). */
export const PROJECT_LIST_TASK_FIELDS = ['id', 'projectId', 'stageId', 'status', 'dueDate', 'title'] as const;
/**
 * The task fields of the dashboard: health, stage tag, overdue, throughput, workload and the review rows (insights.ts). The maker
 * (createdBy) reviews an office task and is one of its people (owner, 2026-10-06).
 */
export const DASHBOARD_TASK_FIELDS = ['id', 'projectId', 'stageId', 'status', 'dueDate', 'ownerId', 'helperIds', 'createdAt', 'completedAt', 'title', 'createdBy'] as const;

/** True when a call names no project filter, so the office tasks that the person sees join its list (owner, 2026-10-06). */
const officeIn = (input: Input): boolean => !str(input.projectId) && !str(input.leaderId) && !str(input.clientId) && !str(input.teamId) && !str(input.subCompanyId);

/** projects.list: the projects that pass the filters on the project, each with its tasks, its newest 2 posts and events, and its cover. */
export async function projectsList(L: Load, input: Input): Promise<void> {
  const office = officeState(L);
  const inTeam = teamFilter(office, str(input.teamId));
  const status = str(input.status) ?? 'active';
  const ids = Object.values(L.office.projects)
    .filter((p) => status === 'all' || p.status === status)
    .filter((p) => input.filter !== 'mine' || (L.authority !== undefined && projectRoleOf(office, p.id, L.authority.id) !== 'other'))
    .filter((p) => input.filter !== 'no_area' || p.areaM2 === null)
    .filter((p) => input.filter !== 'stage_no_end' || stagesOf(office, p.id).some((stage) => stage.endDate === null))
    .filter((p) => input.filter !== 'no_sub_company' || !p.subCompanyId)
    .filter((p) => !input.leaderId || p.leaderId === input.leaderId)
    .filter((p) => !input.clientId || p.clientId === input.clientId)
    .filter((p) => !str(input.subCompanyId) || p.subCompanyId === str(input.subCompanyId))
    .filter(inTeam)
    .map((p) => p.id);
  await tasksOf(L, ids, PROJECT_LIST_TASK_FIELDS);
  await feed(L, ids, 'all', 2);
  await covers(L, ids);
}

/**
 * dashboard.get: the tasks of the projects in scope, the changes of their tasks in review, their Tracker entries that are open
 * client items (the loops) or that the office sent to the client (the Submissions chart), and for the people who handle payments
 * the payments not yet received (owner, 2026-10-06).
 */
export async function dashboardGet(L: Load, input: Input): Promise<void> {
  const inFilters = peopleFilter(officeState(L), { leaderId: str(input.leaderId), clientId: str(input.clientId), teamId: str(input.teamId), subCompanyId: str(input.subCompanyId) });
  const status = str(input.status) ?? 'active';
  const inPeople = Object.values(L.office.projects).filter(inFilters);
  const ids = inPeople.filter((p) => status === 'all' || p.status === status).map((p) => p.id);
  const tasks = [
    ...await tasksOf(L, ids, DASHBOARD_TASK_FIELDS),
    // The office tasks that the person sees count in the numbers of people (owner, 2026-10-06).
    ...(officeIn(input) ? await officeTasks(L, [], { pick: DASHBOARD_TASK_FIELDS }) : []),
  ];
  // The changes of the tasks in review, for the day each one went to review (owner, 2026-10-06). sentToReviewOn (review.ts) reads
  // only the changes that set the status to in_review, so the other changes stay in the database (performance audit DB-5).
  const review = tasks.filter((t) => t.status === 'in_review').map((t) => t.id);
  await L.select({ c: 'events', where: [{ col: 'target_type', in: ['task'] }, { col: 'target_id', in: review }, { field: 'after', key: 'status', in: ['in_review'] }] });
  await L.select({
    c: 'tracker',
    where: [{ col: 'project_id', in: ids }, { or: [{ col: 'open', eq: true }, { field: 'direction', in: ['out'] }] }],
    pick: ['id', 'projectId', 'waiting', 'closedAt', 'direction', 'date'],
  });
  // The money panel: the payments not yet received of every project in the people filters, whatever its status, for the people
  // who may handle payments only (owner, 2026-10-06).
  if (L.authority && can(L.authority, 'payment.manage')) {
    await L.select({ c: 'payments', where: [{ col: 'project_id', in: inPeople.map((p) => p.id) }, { field: 'receivedOn', null: true }] });
  }
}

/**
 * tasks.list, with or without projectId: the tasks of the projects that pass the project filters, narrowed in SQL by the filters
 * that the handler also applies (a person, a status, done or not), with their comment and file counts. A listed open task that
 * waits for others brings every task of its project, for its "waiting for" list.
 */
export async function tasksList(L: Load, input: Input): Promise<void> {
  const office = officeState(L);
  const inFilters = peopleFilter(office, { leaderId: str(input.leaderId), clientId: str(input.clientId), teamId: str(input.teamId), subCompanyId: str(input.subCompanyId) });
  const ids = Object.values(L.office.projects)
    .filter((p) => (input.activeProjectsOnly === false || p.status === 'active') && inFilters(p) && (!input.projectId || p.id === input.projectId))
    .map((p) => p.id);
  const person = str(input.ownerId) ?? (input.filter === 'mine' ? L.authority?.id : undefined);
  // The narrowing conditions, for the tasks of the projects and for the office tasks alike.
  const where: Cond[] = [];
  if (person) where.push({ or: [{ col: 'owner_id', in: [person] }, { has: 'helperIds', value: person }] });
  // The work of a person (owner, 2026-10-06): the tasks the person leads or helps on, and the tasks in review, of which the
  // handler keeps the ones the person reviews.
  const worker = str(input.workOf);
  if (worker) where.push({ or: [{ col: 'owner_id', in: [worker] }, { has: 'helperIds', value: worker }, { col: 'status', in: ['in_review'] }] });
  if (input.filter === 'review_for_me') where.push({ col: 'status', in: ['in_review'] });
  if (Array.isArray(input.status)) where.push({ col: 'status', in: input.status as string[] });
  if (input.includeDone === false) where.push({ col: 'status', notIn: ['done'] });
  if (input.filter === 'flagged') where.push({ field: 'flagged', in: ['true'] });
  const tasks = [
    ...(await L.select({ c: 'tasks', where: [{ col: 'project_id', in: ids }, ...where] })) as Task[],
    // The office tasks that the person sees, when no project filter is set (owner, 2026-10-06).
    ...(officeIn(input) ? await officeTasks(L, where) : []),
  ];
  const waiting = tasks.filter((t) => t.status !== 'done' && t.stageId !== null
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
  // The first 5 of each kind hold the first 5 of both together, which the handler cuts again (owner, 2026-10-06).
  await L.select({ c: 'tasks', where: [{ col: 'project_id', in: active }, { col: 'search_text', contains: query }], limit: 5 });
  await officeTasks(L, [{ col: 'search_text', contains: query }], { limit: 5 });
  // Every file of a project, and the files of the office tasks that the person sees. A file with a project names one that exists.
  const projects = Object.keys(L.office.projects);
  await L.select({ c: 'files', where: [{ col: 'project_id', in: projects }, { col: 'search_text', contains: query }], limit: 5 });
  const seen = (await officeTasks(L, [], { pick: OFFICE_TASK_HIT })).map((task) => task.id);
  await L.select({ c: 'files', where: [{ col: 'project_id', eq: null }, { col: 'task_id', in: seen }, { col: 'search_text', contains: query }], limit: 5 });
  await messageHits(L, input, seen);
}

/**
 * The Messages group (chat design 2026-10-19, item 16): the newest MESSAGE_HITS live messages of the chats that the person may open,
 * and the newest MESSAGE_HITS comments of the tasks that the person may read, whose folded text holds every word of the query. A query
 * with no word of 3 letters reads none. The handler keeps the newest 5 of all the rows, so the cut gives the same rows on the scoped
 * load as on the whole office. "seen" holds the office tasks that the person sees.
 */
async function messageHits(L: Load, input: Input, seen: readonly string[]): Promise<void> {
  const words = searchWords(String(input.text ?? ''));
  if (!L.authority || !searchesMessages(words)) return;
  const office = officeState(L);
  const chats = Object.values(L.office.conversations).filter((c) => canSeeConversation(office, c, L.authority!)).map((c) => c.id);
  const holds = words.map((word): Cond => ({ col: 'search_text', contains: word }));
  const newest = { order: { col: 'created_at', desc: true, id: true } as const, limit: MESSAGE_HITS };
  await L.select({ c: 'messages', where: [{ col: 'conversation_id', in: chats }, LIVE, ...holds], ...newest });
  // The comments of project tasks. Postgres keeps the project of a comment after its task goes, so a read can name a task that the load
  // does not hold. The handler drops such a comment, so the read goes again without that task, until no read names one.
  const projects = Object.keys(L.office.projects);
  const gone: string[] = [];
  for (;;) {
    const rows = (await L.select({
      c: 'comments', where: [{ col: 'target_type', in: ['task'] }, { col: 'project_id', in: projects }, ...holds, ...(gone.length > 0 ? [{ col: 'target_id', notIn: gone }] : [])], ...newest,
    })) as Comment[];
    await L.byKey('tasks', rows.map((comment) => comment.targetId));
    const missing = [...new Set(rows.map((comment) => comment.targetId))].filter((id) => !L.get('tasks', id));
    if (missing.length === 0) break;
    gone.push(...missing);
  }
  // The comments of the office tasks that the person sees (comment.read follows the view rule of the task).
  await L.select({ c: 'comments', where: [{ col: 'target_type', in: ['task'] }, { col: 'project_id', eq: null }, { col: 'target_id', in: seen }, ...holds], ...newest });
}

/** The fields of an office task that its view rule reads (taskResource). */
const OFFICE_TASK_PEOPLE = ['id', 'projectId', 'ownerId', 'helperIds', 'createdBy'] as const;
/** The same, and the title: a comment hit of an office task names it (chat design 2026-10-19, item 16). */
const OFFICE_TASK_HIT = [...OFFICE_TASK_PEOPLE, 'title'] as const;

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
  // A change of an office task shows only to a person who sees that task, so the limit counts only those (owner, 2026-10-06).
  // The live office tasks that the person sees come whole, because the labels of their changes name them.
  if (!can(L.authority, 'task.view', { office: true })) {
    const seen = (await officeTasks(L)).map((task) => task.id);
    where.push({ or: [{ field: 'officeTaskId', null: true }, { field: 'officeTaskId', in: seen }] });
  }
  const events = (await L.select({ c: 'events', where, order: { col: 'seq', desc: true }, limit: (input.limit as number | undefined) ?? 50 })) as Event[];
  await eventTargets(L, events);
}

/**
 * projectTemplates.usage and projectTemplates.syncPlan (fbk_008 item 4): the tasks of the listed projects, which the diff of a template
 * update reads. The projects, their stages and the people are in the office already. usage names no project, so it reads no task.
 * Only plain selects here, so the SQLite form needs no twin (the lite source compiles each select).
 */
export async function templateSyncTasks(L: Load, input: Input): Promise<void> {
  const ids = Array.isArray(input.projectIds)
    ? input.projectIds.filter((id): id is string => typeof id === 'string' && L.office.projects[id] !== undefined)
    : [];
  await tasksOf(L, ids);
}
