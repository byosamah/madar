import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ConversationId, FileId, MAX_ATTACHMENTS, MESSAGE_MAX, MessageId, TaskId, UserId, type Comment, type Conversation, type Message, type Project, type Task, type User } from '../contract/entities';
import { ChatRow, ChatThread, MessageView } from '../contract/views';
import { addDirectConversation, canSeeConversation, isArchived, MESSAGE_PAGE, MESSAGE_PAGE_MAX, messagePage, messagesOf, TASK_THREAD_LIMIT, unreadIn } from '../chatState';
import { forbidden, invalid, notFound } from '../errors';
import { notifyIn } from '../notify';
import { can, mayViewTask, principalOf } from '../permissions';
import { chatReadKey, nextId, unreadCountKey, type State } from '../store';
import { attachmentsOf, cardOf } from '../views';
import { assertFilesForDirect, assertFilesInProject } from './attach';
import { mentionedUserIds, plainText } from '../../lib/text';
import { markOf } from '../../lib/projectMark';

const PREVIEW_MAX = 140;

const previewOf = (body: string): string => {
  const flat = plainText(body).replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
};

function requireConversation(ctx: Ctx, id: string): Conversation {
  const conversation = ctx.state.conversations[id];
  if (!conversation) throw notFound('Conversation', id);
  if (!canSeeConversation(ctx.state, conversation, ctx.authority)) throw forbidden('You cannot open this chat.', { conversationId: id });
  return conversation;
}

/** The conversations the person may open. The Admin may open every project chat. */
function visibleConversations(state: State, viewer: User): Conversation[] {
  return Object.values(state.conversations).filter((c) => canSeeConversation(state, c, viewer));
}

function isMine(state: State, message: Message, viewerId: string): boolean {
  return message.actingForId === viewerId || principalOf(state, message.authorId) === viewerId;
}

/** True for a direct chat whose other person is no longer active: nobody reads new messages there (audit 2026-10-03, SHL-15). */
function personLeft(state: State, conversation: Conversation, viewer: User): boolean {
  if (conversation.kind !== 'direct') return false;
  return conversation.memberIds.some((id) => id !== viewer.id && state.users[id]?.active === false);
}

function rowOf(state: State, conversation: Conversation, viewer: User): ChatRow {
  const last = messagesOf(state, conversation.id).at(-1) ?? null;
  const project = conversation.projectId ? state.projects[conversation.projectId] : undefined;
  const otherId = conversation.kind === 'direct' ? conversation.memberIds.find((id) => id !== viewer.id) : undefined;
  const person = otherId ? cardOf(state, otherId) : null;
  const lastAt = last?.createdAt ?? conversation.createdAt;
  return {
    kind: conversation.kind,
    id: conversation.id,
    title: conversation.kind === 'project' ? (project?.name ?? '') : (person?.name ?? ''),
    project: project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null,
    person,
    taskId: null,
    preview: last ? previewOf(last.body) : '',
    previewAuthor: last ? cardOf(state, last.authorId) : null,
    previewMine: last ? isMine(state, last, viewer.id) : false,
    lastAt,
    unread: unreadIn(state, conversation.id, viewer.id),
    personLeft: personLeft(state, conversation, viewer),
    archived: isArchived(state.chatReads[chatReadKey(conversation.id, viewer.id)], lastAt),
  };
}

/**
 * The new comments of a task thread for one person: by other people, after their own last comment and after they last read
 * the thread. A thread counts as unread the same way a chat does, so feedback on my task never goes unseen (audit 2026-10-03, SHL-5).
 * A count that a server loader put in the state comes first, as unreadIn (plan 4.13, A9).
 */
function taskUnread(state: State, taskId: string, comments: Comment[], viewerId: string): number {
  const counted = state.counts?.[unreadCountKey(taskId, viewerId)];
  if (counted !== undefined) return counted;
  const lastRead = state.chatReads[chatReadKey(taskId, viewerId)]?.lastReadAt ?? '';
  const mine = comments.findLastIndex((c) => principalOf(state, c.authorId) === viewerId);
  return comments.filter((c, i) => i > mine && c.createdAt > lastRead && principalOf(state, c.authorId) !== viewerId).length;
}

/** project is null for an office task. */
type TaskThread = { task: Task; project: Project | null; comments: Comment[] };

/**
 * Tasks I own, lead or commented on, that have at least one comment, with their comments in time order. The comments are
 * grouped by task in one pass. Reading follows the rule of comments.list, so a thread never shows what the comments call would refuse.
 * An office task is a thread of its lead, its maker (who holds the leader's place) and a person who commented, while that person
 * sees the task (owner, 2026-10-06).
 * Only the newest TASK_THREAD_LIMIT threads count, for the list and for the unread number alike (plan 4.13, A5).
 */
function taskThreads(state: State, viewer: User): TaskThread[] {
  if (!can(viewer, 'comment.read')) return [];
  const byTask = new Map<string, Comment[]>();
  for (const c of Object.values(state.comments)) {
    if (c.targetType !== 'task') continue;
    const list = byTask.get(c.targetId);
    if (list) list.push(c);
    else byTask.set(c.targetId, [c]);
  }
  const threads: TaskThread[] = [];
  for (const [taskId, comments] of byTask) {
    const task = state.tasks[taskId];
    if (!task) continue;
    const project = task.projectId === null ? null : state.projects[task.projectId];
    if (project === undefined || (task.projectId === null && !mayViewTask(state, viewer, task))) continue;
    const leads = project ? project.leaderId === viewer.id : principalOf(state, task.createdBy) === viewer.id;
    const involved = task.ownerId === viewer.id || leads
      || comments.some((c) => principalOf(state, c.authorId) === viewer.id);
    if (!involved) continue;
    comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    threads.push({ task, project, comments });
  }
  const lastAt = (thread: TaskThread) => thread.comments[thread.comments.length - 1].createdAt;
  threads.sort((a, b) => lastAt(b).localeCompare(lastAt(a)) || b.task.id.localeCompare(a.task.id));
  return threads.slice(0, TASK_THREAD_LIMIT);
}

function taskRows(state: State, viewer: User): ChatRow[] {
  return taskThreads(state, viewer).map(({ task, project, comments }) => {
    const last = comments[comments.length - 1];
    return {
      kind: 'task', id: task.id, title: task.title, project: project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null, person: null,
      taskId: task.id, preview: previewOf(last.body), previewAuthor: cardOf(state, last.authorId),
      previewMine: principalOf(state, last.authorId) === viewer.id, lastAt: last.createdAt, unread: taskUnread(state, task.id, comments, viewer.id), personLeft: false,
      archived: isArchived(state.chatReads[chatReadKey(task.id, viewer.id)], last.createdAt),
    };
  });
}

function messageViewOf(state: State, message: Message, viewerId: string): MessageView {
  return {
    message,
    author: cardOf(state, message.authorId),
    actingFor: message.actingForId !== message.authorId ? cardOf(state, message.actingForId) : null,
    mine: isMine(state, message, viewerId),
    files: attachmentsOf(state, message.fileIds),
  };
}

function totalUnread(state: State, viewer: User): number {
  const chats = visibleConversations(state, viewer).reduce((sum, c) => sum + unreadIn(state, c.id, viewer.id), 0);
  return chats + taskThreads(state, viewer).reduce((sum, t) => sum + taskUnread(state, t.task.id, t.comments, viewer.id), 0);
}

/**
 * Marks a chat or a task thread read up to now, or up to its last item when that is later. Nothing in it is unread after that,
 * so a count that a server loader put in the state becomes 0 (plan 4.13, A9). Without counts, the state gets none.
 */
function writeReadMark(ctx: Ctx, conversationId: string, lastAt: string | undefined): void {
  const lastReadAt = lastAt && lastAt > ctx.stamp ? lastAt : ctx.stamp;
  const key = chatReadKey(conversationId, ctx.authority.id);
  // The archive mark stays (owner, 2026-10-18): a newer message clears it in the view, not here.
  ctx.state.chatReads[key] = { ...ctx.state.chatReads[key], conversationId, userId: ctx.authority.id, lastReadAt };
  if (ctx.state.counts) ctx.state.counts[unreadCountKey(conversationId, ctx.authority.id)] = 0;
}

function markReadNow(ctx: Ctx, conversation: Conversation): void {
  writeReadMark(ctx, conversation.id, messagesOf(ctx.state, conversation.id).at(-1)?.createdAt);
}

export const chatsList = defineCall({
  input: z.object({}),
  output: z.array(ChatRow),
  readOnly: true,
  run(_input, ctx) {
    const rows = [...visibleConversations(ctx.state, ctx.authority).map((c) => rowOf(ctx.state, c, ctx.authority)), ...taskRows(ctx.state, ctx.authority)];
    return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.id.localeCompare(a.id));
  },
});

export const chatsMessages = defineCall({
  /**
   * One page of messages (plan 4.13, A5): the newest "limit" messages before the message "before", oldest first.
   * The screen asks for the next page with the id of the oldest message it shows. A page shorter than "limit" is the last one.
   */
  input: z.object({
    conversationId: ConversationId,
    before: MessageId.optional(),
    limit: z.number().int().min(1).max(MESSAGE_PAGE_MAX).default(MESSAGE_PAGE),
  }),
  output: ChatThread,
  readOnly: true,
  run(input, ctx) {
    const conversation = requireConversation(ctx, input.conversationId);
    const page = messagePage(ctx.state, conversation.id, input.limit, input.before);
    if (!page) throw invalid('before', 'This message is not in this chat.');
    const people = Object.values(ctx.state.users)
      .filter((u) => u.kind === 'human' && u.id !== ctx.authority.id && canSeeConversation(ctx.state, conversation, u))
      .map((u) => cardOf(ctx.state, u.id));
    return {
      chat: { ...rowOf(ctx.state, conversation, ctx.authority), id: conversation.id },
      people,
      messages: page.map((m) => messageViewOf(ctx.state, m, ctx.authority.id)),
    };
  },
});

/** Checks the files of a message against the room, then stores the message. A project room takes files of its project. A direct room takes files that both people may open. */
export function postMessage(ctx: Ctx, conversation: Conversation, body: string, fileIds: string[]): MessageView {
  // Files are refused unless a rule below allows them.
  if (fileIds.length > 0) {
    if (conversation.kind === 'project') {
      if (!conversation.projectId) throw invalid('fileIds', 'This chat has no project for files.', 'file_not_visible');
      assertFilesInProject(ctx, fileIds, conversation.projectId);
    } else {
      const others = conversation.memberIds.filter((id) => id !== ctx.authority.id);
      if (others.length === 0) throw invalid('fileIds', 'This chat has no other person.', 'file_not_visible');
      assertFilesForDirect(ctx, fileIds, others);
    }
  }
  const mentions = mentionedUserIds(body).filter((id) => {
    const user = ctx.state.users[id];
    return user?.active === true && canSeeConversation(ctx.state, conversation, user);
  });
  const id = nextId(ctx.state, 'msg');
  const message: Message = {
    id, conversationId: conversation.id, authorId: ctx.actor.id, actingForId: ctx.authority.id, body, mentions, fileIds,
    createdAt: ctx.stamp, editedAt: null,
  };
  ctx.state.messages[id] = message;
  notifyIn(ctx, { userIds: mentions, trigger: 'mention', targetType: 'chat', targetId: conversation.id });
  markReadNow(ctx, conversation);
  return messageViewOf(ctx.state, message, ctx.authority.id);
}

export const chatsSend = defineCall({
  input: z.object({
    conversationId: ConversationId,
    body: z.string().trim().min(1).max(MESSAGE_MAX),
    fileIds: z.array(FileId).max(MAX_ATTACHMENTS).default([]),
  }),
  output: MessageView,
  run(input, ctx) {
    const conversation = requireConversation(ctx, input.conversationId);
    if (personLeft(ctx.state, conversation, ctx.authority)) {
      throw forbidden('This person is inactive. This chat takes no new messages.', { conversationId: conversation.id, reason: 'person_left' });
    }
    return postMessage(ctx, conversation, input.body, input.fileIds);
  },
});

/** The checks of a task thread that the person reads or archives: the task is visible and its comments are readable. */
function requireTaskThread(ctx: Ctx, taskId: string): void {
  const task = ctx.state.tasks[taskId];
  // An office task that the person does not see reads as missing (owner, 2026-10-06).
  if (!task || !mayViewTask(ctx.state, ctx.authority, task)) throw notFound('Task', taskId);
  if (!can(ctx.authority, 'comment.read')) throw forbidden('You cannot read these comments.', { action: 'comment.read' });
}

/** A task thread read now: every comment in it so far counts as read. Reading follows the rule of comments.list. */
function markTaskReadNow(ctx: Ctx, taskId: string): void {
  requireTaskThread(ctx, taskId);
  const last = Object.values(ctx.state.comments)
    .filter((c) => c.targetType === 'task' && c.targetId === taskId)
    .reduce((latest, c) => (c.createdAt > latest ? c.createdAt : latest), '');
  writeReadMark(ctx, taskId, last);
}

export const chatsMarkRead = defineCall({
  /** A chat, or a task whose comments the Inbox shows as a thread (audit 2026-10-03, SHL-5). */
  input: z.object({ conversationId: z.union([ConversationId, TaskId]) }),
  output: z.object({ unread: z.number().int().min(0) }),
  run(input, ctx) {
    if (input.conversationId.startsWith('tsk_')) markTaskReadNow(ctx, input.conversationId);
    else markReadNow(ctx, requireConversation(ctx, input.conversationId));
    return { unread: totalUnread(ctx.state, ctx.authority) };
  },
});

/** The read time of a chat with no read mark yet: older than any message, so the archive marks nothing read. */
const NEVER_READ = '1970-01-01T00:00:00.000Z';

export const chatsArchive = defineCall({
  /**
   * Archives a chat or a task thread for the person, or moves it back to the Inbox (owner, 2026-10-18). Only the person's own read
   * mark changes, and no event is written. The checks are those of chats.markRead, so a hidden chat answers the same way.
   */
  input: z.object({ conversationId: z.union([ConversationId, TaskId]), archived: z.boolean() }),
  output: z.object({ archived: z.boolean() }),
  run(input, ctx) {
    const id = input.conversationId;
    if (id.startsWith('tsk_')) requireTaskThread(ctx, id);
    else requireConversation(ctx, id);
    const key = chatReadKey(id, ctx.authority.id);
    const read = ctx.state.chatReads[key];
    ctx.state.chatReads[key] = {
      conversationId: id, userId: ctx.authority.id, lastReadAt: read?.lastReadAt ?? NEVER_READ, archivedAt: input.archived ? ctx.stamp : null,
    };
    return { archived: input.archived };
  },
});

/** The direct chat of the sender with another person. It is made when it does not exist. */
export function directWith(ctx: Ctx, other: User): Conversation {
  const existing = Object.values(ctx.state.conversations).find(
    (c) => c.kind === 'direct' && c.memberIds.includes(ctx.authority.id) && c.memberIds.includes(other.id),
  );
  return existing ?? addDirectConversation(ctx.state, ctx.authority.id, other.id, ctx.stamp);
}

export function requireDirectPartner(ctx: Ctx, userId: string): User {
  const other = ctx.state.users[userId];
  if (!other) throw notFound('User', userId);
  if (principalOf(ctx.state, other.id) === ctx.authority.id) throw invalid('userId', 'You cannot message yourself.');
  if (other.kind !== 'human' || !other.active) throw invalid('userId', 'Pick an active person. Agents act for a person.');
  return other;
}

export const chatsOpenDirect = defineCall({
  input: z.object({ userId: UserId }),
  output: z.object({ id: ConversationId }),
  run(input, ctx) {
    return { id: directWith(ctx, requireDirectPartner(ctx, input.userId)).id };
  },
});

export const chatsUnreadCount = defineCall({
  input: z.object({}),
  output: z.object({ unread: z.number().int().min(0) }),
  readOnly: true,
  run(_input, ctx) {
    return { unread: totalUnread(ctx.state, ctx.authority) };
  },
});

export const chatCalls = {
  'chats.list': chatsList,
  'chats.messages': chatsMessages,
  'chats.send': chatsSend,
  'chats.markRead': chatsMarkRead,
  'chats.archive': chatsArchive,
  'chats.openDirect': chatsOpenDirect,
  'chats.unreadCount': chatsUnreadCount,
};
