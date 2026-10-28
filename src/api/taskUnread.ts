import type { Comment, Project, Task, User } from './contract/entities';
import { markedUnread } from './chatState';
import { principalOf } from './permissions';
import { chatReadKey, unreadCountKey, type State } from './store';
import { isLine } from '../lib/commentLine';

/**
 * The unread rule of a task thread, in one place (fbk_071, owner 2026-10-27). The Inbox thread (chats.list, chats.unreadCount) and the
 * chat icon of a to-do row (tasks.list) both read it, so the two numbers never differ.
 */

/**
 * The comments of a thread by other people, after the last read mark and after the viewer's own last message. "comments" are in time
 * order. A quiet line of a reason is no message: it is never unread, and a line that the viewer wrote is no reply (fbk_027).
 */
export function newCommentsOf(state: State, readKey: string, comments: readonly Comment[], viewerId: string): number {
  const lastRead = state.chatReads[readKey]?.lastReadAt ?? '';
  const talk = comments.filter((c) => !isLine(c));
  const mine = talk.findLastIndex((c) => principalOf(state, c.authorId) === viewerId);
  return talk.filter((c, i) => i > mine && c.createdAt > lastRead && principalOf(state, c.authorId) !== viewerId).length;
}

/**
 * True when the person is part of the thread of a to-do: its lead, the leader of its project (for an office task, its maker), or a person
 * who wrote a comment in it (the person's own agent counts as the person). Only these people have the thread in the Inbox.
 */
export function inTaskThread(state: State, task: Task, project: Project | null, viewer: Pick<User, 'id'>, comments: readonly Comment[]): boolean {
  const leads = project ? project.leaderId === viewer.id : principalOf(state, task.createdBy) === viewer.id;
  return task.ownerId === viewer.id || leads || comments.some((c) => principalOf(state, c.authorId) === viewer.id);
}

/** The unread number of a thread: a thread that the person marked unread (chats.markUnread, fbk_028) counts at least 1. */
export function threadUnread(state: State, taskId: string, count: number, viewerId: string): number {
  return markedUnread(state, chatReadKey(taskId, viewerId)) ? Math.max(count, 1) : count;
}

/**
 * The unread number on the row of a to-do for one person. A count that a server loader put in the state comes first, and it is there
 * only for a thread that the person is part of; a loaded read with no count for the to-do means the person is no part of it, so 0. The
 * prototype has no counts, so it counts from the comments: "commentsOf" gives the comments of one to-do from the lookup of the call.
 */
export function taskRowUnread(state: State, task: Task, viewer: User, commentsOf: (taskId: string) => Comment[]): number {
  if (!viewer.active) return 0;
  const counted = state.counts?.[unreadCountKey(task.id, viewer.id)];
  if (counted !== undefined) return threadUnread(state, task.id, counted, viewer.id);
  if (state.counts !== undefined) return 0;
  const comments = [...commentsOf(task.id)];
  if (comments.length === 0) return 0;
  const project = task.projectId === null ? null : state.projects[task.projectId];
  if (project === undefined) return 0;
  if (!inTaskThread(state, task, project, viewer, comments)) return 0;
  comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return threadUnread(state, task.id, newCommentsOf(state, chatReadKey(task.id, viewer.id), comments, viewer.id), viewer.id);
}
