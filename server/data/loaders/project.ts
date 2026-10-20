import type { Payment, TrackerEntry } from '../../../src/api/contract/entities';
import type { Load } from './build';
import { attachedFiles, covers, feed, fileById, lineMinutes, namedFiles, projectView, tasksOf, trackerScope, type FeedFilter } from './steps';

/**
 * The project loader (plan 4.6): the calls that work on one project P. Each loads the project view of P when the call returns it
 * (ProjectDetail), and the lists of P that the call scans: its files, its Tracker entries or its payments.
 */

type Input = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/**
 * A call that returns the project view of P. projects.update may name a new cover file; setStatus and resume read the client wait
 * of the pause (pause.trackerId).
 */
export async function projectCall(L: Load, projectId: string | undefined, input: Input = {}): Promise<void> {
  await projectView(L, projectId);
  const project = projectId ? L.office.projects[projectId] : undefined;
  const patch = (input.patch ?? {}) as { coverFileId?: unknown };
  await L.byKey('files', [str(patch.coverFileId)]);
  await L.byKey('tracker', [project?.pause?.trackerId]);
}

/** stages.replace: also every task of a stage of P, and every file of those stages, whose stage it clears (AM 6, row 13). */
export async function stagesReplace(L: Load, input: Input): Promise<void> {
  const projectId = str(input.projectId) ?? '';
  await projectCall(L, projectId);
  const stageIds = Object.values(L.office.stages).filter((stage) => stage.projectId === projectId).map((stage) => stage.id);
  await L.select({ c: 'tasks', where: [{ col: 'stage_id', in: stageIds }] });
  await L.select({ c: 'files', where: [{ col: 'stage_id', in: stageIds }] });
}

/** projects.create: a new project has nothing in the database yet. The office lists hold the codes, marks and people. */
export async function projectsCreate(): Promise<void> {}

/** updates.list: feedFor of P with the filter and limit of the call, and the rows of the undo rules for agent changes. */
export async function updatesList(L: Load, input: Input): Promise<void> {
  const projectId = str(input.projectId);
  if (!projectId) return;
  // An agent change shows Undo only when events.undo would take it: its rules read the tasks of P (history.ts, assertMayUndo).
  await tasksOf(L, [projectId]);
  await feed(L, [projectId], (input.filter as FeedFilter | undefined) ?? 'all', (input.limit as number | undefined) ?? 50);
}

/**
 * The files of an office task, for a file call with no project (owner, 2026-10-06): the task (its view rule) and every file of it,
 * because a file of the same name on that task gets the next version.
 */
async function officeFiles(L: Load, taskId: string | undefined): Promise<void> {
  await L.byKey('tasks', [taskId]);
  await L.select({ c: 'files', where: [{ col: 'project_id', eq: null }, { col: 'task_id', in: [taskId ?? ''] }] });
}

/** files.list: every file of P (the filters run in the handler), or every file of one office task. */
export async function filesList(L: Load, input: Input): Promise<void> {
  if (!str(input.projectId)) return officeFiles(L, str(input.taskId));
  await L.select({ c: 'files', where: [{ col: 'project_id', in: [str(input.projectId) ?? ''] }] });
}

/**
 * files.upload: every file of P, because a file of the same name gets the next version (AM 6, row 12), and the task it names. A file of
 * a direct chat or a group (owner, 2026-10-19) reads nothing: the chat is in the office, and a second file with the same name is a new file.
 */
export async function filesUpload(L: Load, input: Input): Promise<void> {
  // A file of a meeting with no project (wave 2) reads the meeting by id (a meeting is not an office list), and no other file.
  if (str(input.meetingId)) return L.byKey('meetings', [str(input.meetingId)]);
  if (str(input.conversationId)) return;
  if (!str(input.projectId)) return officeFiles(L, str(input.taskId));
  const projectId = str(input.projectId) ?? '';
  await L.select({ c: 'files', where: [{ col: 'project_id', in: [projectId] }] });
  await L.byKey('tasks', [str(input.taskId)]);
  await covers(L, [projectId]);
}

/** files.delete and files.markDelivered: the file by id, and the office task of a file with no project. Projects are in the office. */
export async function fileCall(L: Load, input: Input): Promise<void> {
  const file = await fileById(L, str(input.id) ?? '');
  if (file?.projectId === null) await L.byKey('tasks', [file.taskId]);
  // The view rule of a file of a meeting reads the meeting (wave 2).
  if (file?.meetingId !== undefined) await L.byKey('meetings', [file.meetingId]);
}

/** payments.list and payments.create: the payments of P. */
export async function paymentsOfProject(L: Load, input: Input): Promise<void> {
  await L.select({ c: 'payments', where: [{ col: 'project_id', in: [str(input.projectId) ?? ''] }] });
}

/** payments.update, markReceived and delete: the payment by id. */
export async function paymentCall(L: Load, input: Input): Promise<Payment | undefined> {
  await L.byKey('payments', [str(input.id)]);
  return L.get<Payment>('payments', str(input.id));
}

/** tracker.list: every entry of P, with the reply task and the files each one names. */
export async function trackerList(L: Load, input: Input): Promise<void> {
  const entries = (await L.select({ c: 'tracker', where: [{ col: 'project_id', in: [str(input.projectId) ?? ''] }] })) as TrackerEntry[];
  await L.byKey('tasks', entries.map((entry) => entry.replyTaskId));
  await namedFiles(L, entries);
  // A line that Madar made for a meeting names the meeting and the files of its minutes (wave 2).
  await lineMinutes(L, entries);
}

/** tracker.log: the tasks of P (a reply task joins the stage tag) and the files the entry names. */
export async function trackerLog(L: Load, input: Input): Promise<void> {
  await tasksOf(L, [str(input.projectId) ?? '']);
  await attachedFiles(L, (input.fileIds as string[] | undefined) ?? []);
}

/** tracker.close, update, delete and assignReply: the entry, its reply task, the tasks of P, and every file named. */
export async function trackerCall(L: Load, input: Input): Promise<void> {
  await trackerScope(L, str(input.id) ?? '', (input.fileIds as string[] | undefined) ?? []);
  await attachedFiles(L, (input.fileIds as string[] | undefined) ?? []);
}

/**
 * tracker.export: every Tracker event of P, replayed in order (AM 4.11), and the files that any version of an entry names.
 */
export async function trackerExport(L: Load, input: Input): Promise<void> {
  const events = await L.select({ c: 'events', where: [{ col: 'project_id', in: [str(input.projectId) ?? ''] }, { col: 'target_type', eq: 'tracker' }] });
  const named = events.flatMap((event) => [event.before, event.after].map((side) => ({ fileIds: ((side ?? {}) as { fileIds?: unknown }).fileIds })))
    .map((side) => ({ fileIds: Array.isArray(side.fileIds) ? side.fileIds.filter((id): id is string => typeof id === 'string') : [] }));
  await namedFiles(L, named);
}
