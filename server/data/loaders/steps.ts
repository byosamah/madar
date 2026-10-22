import type { Comment, Event, FileRec, Message, Task, TrackerEntry, Update } from '../../../src/api/contract/entities';
import { COLLECTION } from '../../../src/api/events';
import { commentCountKey, emptyState, fileCountKey, type State } from '../../../src/api/store';
import { FEED_VERBS } from '../../../src/api/views';
import { can } from '../../../src/api/permissions';
import type { TableCollection } from '../tables';
import type { Cond, Select } from './query';
import type { Load } from './build';

/**
 * The reads that several loaders share (plan 4.6; task C2). Each step loads the complete set that a scan of the handlers can
 * match (AM 6), and the rows those records name by id (files, reply tasks, Tracker entries), so a check of "is it there" never
 * reads a row that the load left out.
 */

export type FeedFilter = 'all' | 'posts' | 'decisions' | 'tasks' | 'files';

/** The office lists as a State, for the rules of src/api that read them (permissions, team filters). Never changed. */
export function officeState(L: Load): State {
  return { ...emptyState(''), ...(L.office as unknown as Partial<State>) } as State;
}

/** Every task of these projects. A read may take only some fields (pick, AM 9). */
export async function tasksOf(L: Load, projectIds: readonly (string | null)[], pick?: readonly string[]): Promise<Task[]> {
  const ids = [...new Set(projectIds.filter((id): id is string => id !== null))];
  return (await L.select({ c: 'tasks', where: [{ col: 'project_id', in: ids }], ...(pick ? { pick } : {}) })) as Task[];
}

/** A person and the person's agents: a record that one of them made is the person's own (principalOf). */
export function selfAndAgents(L: Load, userId: string): string[] {
  return [userId, ...Object.values(L.office.users).filter((user) => user.kind === 'agent' && user.ownerId === userId).map((user) => user.id)];
}

/**
 * The office tasks that the person of the call sees, as conditions on the tasks table (owner, 2026-10-06): no project, and for
 * anyone but the Admin, the person leads it, helps on it or made it (the person or one of their agents). The rule of
 * can('task.view'); the handler checks it again on the rows.
 */
export function officeTaskConds(L: Load): Cond[] {
  const nobody: Cond[] = [{ col: 'id', in: [] }];
  if (!L.authority) return nobody;
  const me = L.authority.id;
  if (can(L.authority, 'task.view', { office: true })) return [{ col: 'project_id', eq: null }];
  if (!L.authority.active) return nobody;
  return [{ col: 'project_id', eq: null }, { or: [{ col: 'owner_id', in: [me] }, { has: 'helperIds', value: me }, { field: 'createdBy', in: selfAndAgents(L, me) }] }];
}

/** The office tasks that the person sees, with more conditions. A read may take only some fields. */
export async function officeTasks(L: Load, more: readonly Cond[] = [], o: { pick?: readonly string[]; limit?: number } = {}): Promise<Task[]> {
  return (await L.select({ c: 'tasks', where: [...officeTaskConds(L), ...more], ...o })) as Task[];
}

/**
 * The files by id that a write attaches or a message view names, and the office task of each file with no project: the attach rules
 * and the file rows of a message read its view rule (attach.ts, owner 2026-10-06; chats.ts, fbk_011).
 */
export async function attachedFiles(L: Load, fileIds: readonly (string | null | undefined)[]): Promise<void> {
  await L.byKey('files', fileIds);
  const office = fileIds.map((id) => L.get<FileRec>('files', id)).filter((file) => file?.projectId === null);
  await L.byKey('tasks', office.map((file) => file!.taskId));
  // The view rule of a file of a meeting with no project reads that meeting (a meeting is not an office list), so a call that carries
  // such a file brings the meeting too, and answers file_meeting or file_missing as the whole office does (wave 2).
  await L.byKey('meetings', office.map((file) => file!.meetingId));
}

/** The files that these records name by id: attachments of posts, comments, messages and Tracker entries. */
export async function namedFiles(L: Load, records: readonly { fileIds?: string[] }[], more: readonly (string | null | undefined)[] = []): Promise<void> {
  await L.byKey('files', [...records.flatMap((record) => record.fileIds ?? []), ...more]);
}

/**
 * What the Tracker line of a meeting that ended names (wave 2): the meeting, for the right to write its minutes, and the files of its
 * minutes. A line of any other kind names neither.
 */
export async function lineMinutes(L: Load, entries: readonly TrackerEntry[], o: { files?: boolean } = {}): Promise<void> {
  await L.byKey('meetings', entries.map((entry) => entry.meetingId));
  if (o.files !== false) await L.byKey('files', entries.flatMap((entry) => entry.minutes?.fileIds ?? []));
}

/** The comments on these targets: the rows for a write, the number for a read (plan 4.13, A4). */
export async function commentsOn(L: Load, targetType: 'task' | 'update', ids: readonly string[]): Promise<Comment[]> {
  if (ids.length === 0) return [];
  if (!L.write) {
    await L.counts('comments', 'target_id', ids, commentCountKey);
    return [];
  }
  return (await L.select({ c: 'comments', where: [{ col: 'target_type', eq: targetType }, { col: 'target_id', in: ids }] })) as Comment[];
}

/** The files of these tasks: the rows for a write, the number for a read. */
export async function filesOfTasks(L: Load, taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0) return;
  if (!L.write) await L.counts('files', 'task_id', taskIds, fileCountKey);
  else await L.select({ c: 'files', where: [{ col: 'task_id', in: taskIds }] });
}

/**
 * The rows that events name, for eventLabel and the undo rules: each target by id (tasks, posts, comments, files, Tracker entries,
 * payments, feedback), the reply task that a Tracker event names, and for a cover change the events of its story (the cover comes
 * back with its file only when that file delete is in the story, history.ts).
 */
export async function eventTargets(L: Load, events: readonly Event[]): Promise<void> {
  const byCollection = new Map<TableCollection, string[]>();
  for (const event of events) {
    const c = COLLECTION[event.targetType] as TableCollection | null;
    if (c) byCollection.set(c, [...(byCollection.get(c) ?? []), event.targetId]);
  }
  for (const [c, ids] of byCollection) await L.byKey(c, ids);
  const replyTasks = events.flatMap((event) => {
    const after = (event.after ?? {}) as { replyTaskId?: unknown };
    return event.targetType === 'tracker' && typeof after.replyTaskId === 'string' ? [after.replyTaskId] : [];
  });
  await L.byKey('tasks', replyTasks);
  // The minutes of a meeting (wave 2): the Undo right and the feed word of a Tracker event read the meeting of its line.
  const lines = events.filter((event) => event.targetType === 'tracker').map((event) => L.get<TrackerEntry>('tracker', event.targetId));
  await lineMinutes(L, lines.filter((entry): entry is TrackerEntry => entry !== undefined), { files: false });
  const covers = events.filter((event) => typeof ((event.before ?? {}) as { coverFileId?: unknown }).coverFileId === 'string');
  if (covers.length > 0) await L.select({ c: 'events', where: [{ col: 'correlation_id', in: covers.map((event) => event.correlationId) }] });
}

function feedVerbs(filter: FeedFilter): string[] {
  const verbs = [...FEED_VERBS];
  if (filter === 'tasks') return verbs.filter((verb) => verb.startsWith('task.'));
  if (filter === 'files') return verbs.filter((verb) => verb.startsWith('file.'));
  return verbs;
}

/**
 * feedFor (views.ts) for these projects: the newest "limit" posts and the newest "limit" feed events of each project, with every
 * row that ties with the last one, so the merge and the cut of the handler give the same items (AM 6, row 17). The posts bring their
 * attachments and their comments (counts for a read), the events their target rows.
 */
export async function feed(L: Load, projectIds: readonly string[], filter: FeedFilter, limit: number): Promise<void> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return;
  if (filter === 'all' || filter === 'posts' || filter === 'decisions') {
    const posts = (await L.select({
      c: 'updates',
      where: [{ col: 'project_id', in: ids }, ...(filter === 'decisions' ? [{ field: 'decision', in: ['true'] }] : [])],
      order: { col: 'created_at', desc: true }, per: 'project_id', limit, ties: true,
    })) as Update[];
    await namedFiles(L, posts);
    await commentsOn(L, 'update', posts.map((post) => post.id));
  }
  if (filter !== 'posts' && filter !== 'decisions') {
    const events = (await L.select({
      c: 'events',
      where: [{ col: 'project_id', in: ids }, { col: 'verb', in: feedVerbs(filter) }, { notUndone: true }],
      order: { col: 'created_at', desc: true }, per: 'project_id', limit, ties: true,
    })) as Event[];
    await eventTargets(L, events);
  }
}

/** The cover file of each project, by id (summaryOf reads its versions). */
export async function covers(L: Load, projectIds: readonly string[]): Promise<void> {
  await L.byKey('files', projectIds.map((id) => L.office.projects[id]?.coverFileId));
}

/** What detailOf and summaryOf read for one project: all its tasks, the newest 2 posts and feed events, and its cover. */
export async function projectView(L: Load, projectId: string | undefined): Promise<void> {
  if (!projectId) return;
  await tasksOf(L, [projectId]);
  await feed(L, [projectId], 'all', 2);
  await covers(L, [projectId]);
}

/**
 * What a task needs beside the tasks of its project: its history (every event with the task as target: taskDetailOf, finishedOn),
 * its comments and files (counted for a read), and the Tracker entry it answers with that entry's files (replyTaskDone).
 */
export async function taskTail(L: Load, taskIds: readonly (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(taskIds.filter((id): id is string => typeof id === 'string' && id !== ''))];
  if (ids.length === 0) return;
  await L.select({ c: 'events', where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ids }] });
  await commentsOn(L, 'task', ids);
  await filesOfTasks(L, ids);
  const tasks = ids.map((id) => L.get<Task>('tasks', id)).filter((task): task is Task => task !== undefined);
  await L.byKey('tracker', tasks.map((task) => task.trackerEntryId));
  await namedFiles(L, tasks.map((task) => L.get<TrackerEntry>('tracker', task.trackerEntryId)).filter((entry): entry is TrackerEntry => entry !== undefined));
}

/** A task by id, then every task of its project and its tail. Returns the task, or undefined when it does not exist. */
export async function taskScope(L: Load, taskId: string): Promise<Task | undefined> {
  await L.byKey('tasks', [taskId]);
  const task = L.get<Task>('tasks', taskId);
  if (!task) return undefined;
  // An office task has no project, so it needs no other task (owner, 2026-10-06).
  await tasksOf(L, [task.projectId]);
  await taskTail(L, [taskId]);
  return task;
}

/** A Tracker entry by id with what trackerRowOf and the reply rules read: its files, its reply task, and that task's project and tail. */
export async function trackerScope(L: Load, entryId: string, moreFiles: readonly string[] = []): Promise<TrackerEntry | undefined> {
  await L.byKey('tracker', [entryId]);
  const entry = L.get<TrackerEntry>('tracker', entryId);
  if (!entry) return undefined;
  await namedFiles(L, [entry], moreFiles);
  await lineMinutes(L, [entry]);
  await tasksOf(L, [entry.projectId]);
  await L.byKey('tasks', [entry.replyTaskId]);
  await taskTail(L, [entry.replyTaskId]);
  return entry;
}

/**
 * The loader condition of a live message: no "deletedAt" (chat design item 11). It is the loader form of isLiveMessage
 * (`src/api/chatNaming.ts`). Every read of messages for a view, a count or a push check carries it, so a deleted message is never
 * loaded, never counted, never found and never pushed. It compiles on Postgres and on SQLite (`server/data/loaders/query.ts`).
 */
export const LIVE = { field: 'deletedAt', null: true } as const;

/** The newest live message of each conversation, by stamp then id, as messagesOf (chatState.ts) orders them. */
export async function newestMessages(L: Load, conversationIds: readonly string[]): Promise<Message[]> {
  return (await L.select(newestMessagesRead(conversationIds))) as Message[];
}

/** The read of newestMessages, for a load that joins it with other reads (Load.batch). */
export function newestMessagesRead(conversationIds: readonly string[]): Select {
  return {
    c: 'messages', where: [{ col: 'conversation_id', in: conversationIds }, LIVE],
    order: { col: 'created_at', desc: true, id: true }, per: 'conversation_id', limit: 1,
  };
}

/**
 * The rows of these keys that the load does not hold yet, with only some fields (AM 9): for a read that never saves and whose
 * handler reads only those fields. A later read of the same rows keeps the picked copy, so only a read that loads nothing else
 * of the table may use it.
 */
export async function pickedByKey(L: Load, c: TableCollection, keys: readonly string[], pick: readonly string[]): Promise<void> {
  const missing = [...new Set(keys.filter((key) => key !== ''))].filter((key) => !L.get(c, key));
  if (missing.length > 0) await L.select({ c, where: [{ col: 'id', in: missing }], pick });
}

/** The files of a file record by id (sharing and the file calls). */
export async function fileById(L: Load, id: string): Promise<FileRec | undefined> {
  await L.byKey('files', [id]);
  return L.get<FileRec>('files', id);
}
