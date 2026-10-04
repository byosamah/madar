import type { Comment, Event, FileRec, Message, Task, TrackerEntry, Update } from '../../../src/api/contract/entities';
import { COLLECTION } from '../../../src/api/events';
import { commentCountKey, emptyState, fileCountKey, type State } from '../../../src/api/store';
import { FEED_VERBS } from '../../../src/api/views';
import type { TableCollection } from '../tables';
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
export async function tasksOf(L: Load, projectIds: readonly string[], pick?: readonly string[]): Promise<Task[]> {
  return (await L.select({ c: 'tasks', where: [{ col: 'project_id', in: [...new Set(projectIds)] }], ...(pick ? { pick } : {}) })) as Task[];
}

/** The files that these records name by id: attachments of posts, comments, messages and Tracker entries. */
export async function namedFiles(L: Load, records: readonly { fileIds?: string[] }[], more: readonly (string | null | undefined)[] = []): Promise<void> {
  await L.byKey('files', [...records.flatMap((record) => record.fileIds ?? []), ...more]);
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
  await tasksOf(L, [entry.projectId]);
  await L.byKey('tasks', [entry.replyTaskId]);
  await taskTail(L, [entry.replyTaskId]);
  return entry;
}

/** The newest message of each conversation, by stamp then id, as messagesOf (chatState.ts) orders them. */
export async function newestMessages(L: Load, conversationIds: readonly string[]): Promise<Message[]> {
  return (await L.select({
    c: 'messages', where: [{ col: 'conversation_id', in: conversationIds }],
    order: { col: 'created_at', desc: true, id: true }, per: 'conversation_id', limit: 1,
  })) as Message[];
}

/** The files of a file record by id (sharing and the file calls). */
export async function fileById(L: Load, id: string): Promise<FileRec | undefined> {
  await L.byKey('files', [id]);
  return L.get<FileRec>('files', id);
}
