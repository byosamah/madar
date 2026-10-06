import type { Comment, Message, Stage, Update } from '../../../src/api/contract/entities';
import { chatReadKey } from '../../../src/api/store';
import type { Load } from './build';
import { commentsOn, namedFiles, newestMessages, taskScope, tasksOf } from './steps';

/**
 * The task loader (plan 4.6) and the content loader: a task call loads every task of the project of T (stage tag, prerequisites,
 * dependents: AM 6, rows 13 and 16) and the tail of T (its events, comments, files and Tracker entry). A content call loads the
 * comment or post by id, its target, the comments of the target and the files they name.
 */

type Input = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** tasks.get and every task write that names a task by input.id. */
export async function taskCall(L: Load, input: Input): Promise<void> {
  await taskScope(L, str(input.id) ?? '');
}

/** tasks.take: the task by input.taskId, the same scope as the other task writes. */
export async function tasksTake(L: Load, input: Input): Promise<void> {
  await taskScope(L, str(input.taskId) ?? '');
}

/** tasks.create: every task of P. The new task has no tail yet. */
export async function tasksCreate(L: Load, input: Input): Promise<void> {
  await tasksOf(L, [str(input.projectId) ?? '']);
}

/** tasks.createFromTemplate: the project of the stage it names. */
export async function tasksCreateFromTemplate(L: Load, input: Input): Promise<void> {
  const stage = L.get<Stage>('stages', str(input.stageId));
  if (stage) await tasksOf(L, [stage.projectId]);
}

/** taskTemplates.save from a task: the task by id (its stage is in the office). */
export async function taskTemplatesSave(L: Load, input: Input): Promise<void> {
  await L.byKey('tasks', [str(input.fromTaskId)]);
}

/** The target of a comment: the task or the post by id. */
async function target(L: Load, targetType: unknown, targetId: unknown): Promise<void> {
  await L.byKey(targetType === 'task' ? 'tasks' : 'updates', [str(targetId)]);
}

/** comments.list: the target, every comment on it, and the files they name. */
export async function commentsList(L: Load, input: Input): Promise<void> {
  await target(L, input.targetType, input.targetId);
  const comments = (await L.select({
    c: 'comments', where: [{ col: 'target_type', eq: String(input.targetType) }, { col: 'target_id', in: [str(input.targetId) ?? ''] }],
  })) as Comment[];
  await namedFiles(L, comments);
}

/** comments.create: the target and the files the new comment names. */
export async function commentsCreate(L: Load, input: Input): Promise<void> {
  await target(L, input.targetType, input.targetId);
  await L.byKey('files', (input.fileIds as string[] | undefined) ?? []);
}

/** comments.update, comments.delete and reactions.toggle: the comment, its target and its files. */
export async function commentCall(L: Load, input: Input): Promise<void> {
  const id = str(input.id) ?? str(input.commentId);
  await L.byKey('comments', [id]);
  const comment = L.get<Comment>('comments', id);
  if (!comment) return;
  await target(L, comment.targetType, comment.targetId);
  await namedFiles(L, [comment]);
}

/** updates.create: the files the new post names. Its project is in the office. */
export async function updatesCreate(L: Load, input: Input): Promise<void> {
  await L.byKey('files', (input.fileIds as string[] | undefined) ?? []);
}

/** updates.update and updates.delete: the post, its comments (the count in its feed item) and its files. */
export async function updateCall(L: Load, input: Input): Promise<void> {
  await L.byKey('updates', [str(input.id)]);
  const update = L.get<Update>('updates', str(input.id));
  if (!update) return;
  await commentsOn(L, 'update', [update.id]);
  await namedFiles(L, [update]);
}

/**
 * files.share: the file, and for each target what the share writes beside: a task comment (the task), or a chat message (the
 * newest message of the room, for the read mark). The rooms are in the office.
 */
export async function filesShare(L: Load, input: Input): Promise<void> {
  await L.byKey('files', [str(input.fileId)]);
  const file = L.get<{ projectId: string | null; taskId: string | null }>('files', str(input.fileId));
  // A file of an office task: its task, for the view rule (owner, 2026-10-06).
  if (file?.projectId === null) await L.byKey('tasks', [file.taskId]);
  const shareTarget = (input.target ?? {}) as { kind?: string; taskId?: string; userId?: string };
  if (shareTarget.kind === 'task') {
    await L.byKey('tasks', [shareTarget.taskId]);
    return;
  }
  const rooms = Object.values(L.office.conversations).filter((room) => {
    if (shareTarget.kind === 'project_chat') return room.kind === 'project' && room.projectId === file?.projectId;
    return room.kind === 'direct' && L.authority !== undefined && room.memberIds.includes(L.authority.id) && room.memberIds.includes(shareTarget.userId ?? '');
  });
  await roomsForPost(L, rooms.map((room) => room.id));
}

/** A message rewrites the read mark of the sender (markReadNow): the newest message of the room, and the mark itself. */
async function roomsForPost(L: Load, roomIds: readonly string[]): Promise<Message[]> {
  if (L.authority) await L.byKey('chatReads', roomIds.map((id) => chatReadKey(id, L.authority!.id)));
  return newestMessages(L, roomIds);
}

/** chats.send: the files the message names, and the newest message of the room (the read mark of the sender). */
export async function chatsSend(L: Load, input: Input): Promise<Message[]> {
  await L.byKey('files', (input.fileIds as string[] | undefined) ?? []);
  return roomsForPost(L, [str(input.conversationId) ?? '']);
}

