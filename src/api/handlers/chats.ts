import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ConversationId, FileId, GROUP_MAX, GROUP_NAME_MAX, MAX_ATTACHMENTS, MESSAGE_MAX, MessageId, TaskId, UserId, type Comment, type Conversation, type Message, type Project, type Task, type User } from '../contract/entities';
import { ChatRow, ChatThread, MessageView, WaitingRow } from '../contract/views';
import { addDirectConversation, addGroupConversation, canSeeConversation, isArchived, MESSAGE_PAGE, MESSAGE_PAGE_MAX, messagePage, messagesOf, TASK_THREAD_LIMIT, unreadIn } from '../chatState';
import { forbidden, invalid, notFound } from '../errors';
import { notifyIn } from '../notify';
import { can, mayViewTask, principalOf } from '../permissions';
import { chatReadKey, nextId, unreadCountKey, type State } from '../store';
import { attachmentsOf, cardOf, mayViewFile } from '../views';
import { assertFilesForDirect, assertFilesInProject } from './attach';
import { mentionedUserIds, plainText } from '../../lib/text';
import { markOf } from '../../lib/projectMark';

const PREVIEW_MAX = 140;

const previewOf = (body: string): string => {
  const flat = plainText(body).replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
};

/**
 * The chat the person may open. A group that the person may not open answers as a missing chat, so an outsider learns nothing
 * of it (Review Focus 1, owner rule of 2026-10-18). A project or direct chat keeps its answer.
 */
function requireConversation(ctx: Ctx, id: string): Conversation {
  const conversation = ctx.state.conversations[id];
  if (!conversation) throw notFound('Conversation', id);
  if (!canSeeConversation(ctx.state, conversation, ctx.authority)) {
    if (conversation.kind === 'group') throw notFound('Conversation', id);
    throw forbidden('You cannot open this chat.', { conversationId: id });
  }
  return conversation;
}

/** A group the person may open. Any other chat is refused as not a group. */
function requireGroup(ctx: Ctx, id: string): Conversation {
  const conversation = requireConversation(ctx, id);
  if (conversation.kind !== 'group') throw invalid('conversationId', 'This chat is not a group.');
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
  const group = conversation.kind === 'group';
  return {
    kind: conversation.kind,
    id: conversation.id,
    title: conversation.kind === 'project' ? (project?.name ?? '') : group ? (conversation.name ?? '') : (person?.name ?? ''),
    project: project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null,
    person,
    taskId: null,
    makerId: group ? (conversation.makerId ?? null) : null,
    members: group ? conversation.memberIds.slice(0, 3).map((id) => cardOf(state, id)) : [],
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
      makerId: null, members: [], taskId: task.id, preview: previewOf(last.body), previewAuthor: cardOf(state, last.authorId),
      previewMine: principalOf(state, last.authorId) === viewer.id, lastAt: last.createdAt, unread: taskUnread(state, task.id, comments, viewer.id), personLeft: false,
      archived: isArchived(state.chatReads[chatReadKey(task.id, viewer.id)], last.createdAt),
    };
  });
}

/**
 * The file ids of a message that the viewer may see. A file that is gone stays, as a row with no name. A file that the viewer may
 * not view leaves the view with its name and id: a person who joins a group later, or a member who is not on a task, reads the
 * messages of other people (security review 2026-10-18, fbk_011). Every project file is open to every person; a file of an
 * office task shows only to the people of that task.
 */
function viewableFileIds(state: State, message: Message, viewer: User): string[] {
  return (message.fileIds ?? []).filter((id) => {
    const file = state.files[id];
    return file === undefined || mayViewFile(state, viewer, file);
  });
}

function messageViewOf(state: State, message: Message, viewer: User): MessageView {
  const fileIds = viewableFileIds(state, message, viewer);
  return {
    message: message.fileIds === undefined ? message : { ...message, fileIds },
    author: cardOf(state, message.authorId),
    actingFor: message.actingForId !== message.authorId ? cardOf(state, message.actingForId) : null,
    mine: isMine(state, message, viewer.id),
    files: attachmentsOf(state, fileIds),
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
      messages: page.map((m) => messageViewOf(ctx.state, m, ctx.authority)),
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
  return messageViewOf(ctx.state, message, ctx.authority);
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

/** A group name: 1 to 60 letters, with the spaces at its ends cut. */
const GroupName = z.string().trim().min(1).max(GROUP_NAME_MAX);

/** A group of the person and 2 to 49 other active people (owner, 2026-10-18). The person is its maker. It writes no History event. */
export const chatsCreateGroup = defineCall({
  input: z.object({ name: GroupName, memberIds: z.array(UserId).min(2).max(GROUP_MAX - 1) }),
  output: z.object({ id: ConversationId }),
  run(input, ctx) {
    const seen = new Set<string>();
    for (const id of input.memberIds) {
      const user = ctx.state.users[id];
      if (!user || user.kind !== 'human' || !user.active) throw invalid('memberIds', 'Pick active people. Agents act for a person.');
      if (id === ctx.authority.id) throw invalid('memberIds', 'You are in the group already.');
      if (seen.has(id)) throw invalid('memberIds', 'A person is in the list twice.');
      seen.add(id);
    }
    const group = addGroupConversation(ctx.state, input.name, ctx.authority.id, [ctx.authority.id, ...input.memberIds], ctx.stamp);
    return { id: group.id };
  },
});

/**
 * Renames a group, adds people or removes people (owner, 2026-10-18). Any member renames and adds. Only the maker removes people,
 * and the maker never removes itself (chats.leaveGroup does that). A group keeps at least two people. It writes no History event.
 */
export const chatsUpdateGroup = defineCall({
  input: z.object({
    conversationId: ConversationId,
    name: GroupName.optional(),
    add: z.array(UserId).max(GROUP_MAX).optional(),
    remove: z.array(UserId).max(GROUP_MAX).optional(),
  }),
  output: z.object({ id: ConversationId }),
  run(input, ctx) {
    const group = requireGroup(ctx, input.conversationId);
    const add = input.add ?? [];
    const remove = input.remove ?? [];
    if (remove.length > 0 && group.makerId !== ctx.authority.id) {
      throw forbidden('Only the maker of the group removes people.', { conversationId: group.id, reason: 'not_maker' });
    }
    if (remove.some((id) => id === group.makerId || !group.memberIds.includes(id))) throw invalid('remove', 'Pick a person of the group who is not the maker.');
    const kept = group.memberIds.filter((id) => !remove.includes(id));
    const seen = new Set<string>();
    for (const id of add) {
      const user = ctx.state.users[id];
      if (!user || user.kind !== 'human' || !user.active) throw invalid('add', 'Pick active people. Agents act for a person.');
      if (group.memberIds.includes(id)) throw invalid('add', 'This person is in the group already.');
      if (seen.has(id)) throw invalid('add', 'A person is in the list twice.');
      seen.add(id);
    }
    if (kept.length + add.length > GROUP_MAX) throw invalid('add', 'A group holds 50 people at most.', 'group_full');
    if (kept.length + add.length < 2) throw invalid('remove', 'A group keeps at least two people.', 'group_too_small');
    ctx.state.conversations[group.id] = { ...group, memberIds: [...kept, ...add], name: input.name ?? group.name };
    return { id: group.id };
  },
});

/** Leaves a group. When the maker leaves, the first other person in the group becomes the maker. A group keeps at least two people. */
export const chatsLeaveGroup = defineCall({
  input: z.object({ conversationId: ConversationId }),
  output: z.object({}),
  run(input, ctx) {
    const group = requireGroup(ctx, input.conversationId);
    const kept = group.memberIds.filter((id) => id !== ctx.authority.id);
    if (kept.length < 2) throw invalid('conversationId', 'A group keeps at least two people.', 'group_too_small');
    ctx.state.conversations[group.id] = { ...group, memberIds: kept, makerId: group.makerId === ctx.authority.id ? kept[0] : group.makerId };
    return {};
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

/** The first characters of a waiting message that chats.waiting gives: plain text, so no mention markup. */
const WAITING_BODY_MAX = 280;
const DAY_MS = 86_400_000;

/** True when a is newer than b, in the order of messagesOf: the stamp, then the id. */
const laterThan = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): boolean =>
  (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) > 0;

/** The whole days from a stamp to now. */
const daysSince = (at: string, now: Date): number => Math.max(0, Math.floor((now.getTime() - Date.parse(at)) / DAY_MS));

/** A chat that waits for the reply of the viewer, with the message that waits. Null when nothing waits. */
function waitingChat(state: State, conversation: Conversation, viewer: User, now: Date): WaitingRow | null {
  const messages = messagesOf(state, conversation.id);
  const last = messages.at(-1);
  const lastAt = last?.createdAt ?? conversation.createdAt;
  if (isArchived(state.chatReads[chatReadKey(conversation.id, viewer.id)], lastAt)) return null;
  let waiting: Message | undefined;
  if (conversation.kind === 'project') {
    // A project chat: a message that names the viewer, and is newer than the viewer's newest message.
    const own = messages.findLast((m) => isMine(state, m, viewer.id));
    const named = messages.findLast((m) => m.mentions.includes(viewer.id));
    if (named && (!own || laterThan(named, own))) waiting = named;
  } else if (last && !isMine(state, last, viewer.id)) {
    // A direct or group chat: its newest message came from another person.
    waiting = last;
  }
  if (!waiting) return null;
  const row = rowOf(state, conversation, viewer);
  return {
    kind: conversation.kind, id: conversation.id, title: row.title, project: row.project, from: cardOf(state, waiting.authorId),
    body: Array.from(plainText(waiting.body)).slice(0, WAITING_BODY_MAX).join(''), at: waiting.createdAt, days: daysSince(waiting.createdAt, now),
  };
}

/**
 * A task thread that waits for the reply of the viewer. Its newest comment came from another person.
 * The viewer leads the task, or a newer comment of another person names the viewer with @. Comments keep
 * no mention list, so the body holds the mention markup. The row shows the newest comment for the lead,
 * and the named comment otherwise.
 */
function waitingThread(state: State, thread: TaskThread, viewer: User, now: Date): WaitingRow | null {
  const { task, project, comments } = thread;
  const last = comments.at(-1);
  if (!last || principalOf(state, last.authorId) === viewer.id) return null;
  if (isArchived(state.chatReads[chatReadKey(task.id, viewer.id)], last.createdAt)) return null;
  const own = comments.findLast((c) => principalOf(state, c.authorId) === viewer.id);
  const others = comments.filter((c) => principalOf(state, c.authorId) !== viewer.id && (!own || laterThan(c, own)));
  const waiting = task.ownerId === viewer.id ? others.at(-1) : others.findLast((c) => mentionedUserIds(c.body).includes(viewer.id));
  if (!waiting) return null;
  return {
    kind: 'task', id: task.id, title: task.title, project: project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null,
    from: cardOf(state, waiting.authorId), body: Array.from(plainText(waiting.body)).slice(0, WAITING_BODY_MAX).join(''),
    at: waiting.createdAt, days: daysSince(waiting.createdAt, now),
  };
}

/**
 * The chats and task threads that wait for the reply of the person (fbk_011, owner 2026-10-18), oldest first.
 * - A direct or group chat waits when its newest message came from another person.
 * - A project chat waits when a message that names the person is newer than the person's newest message.
 * - A task thread waits when its newest comment came from another person, and the person leads the task or is named (see waitingThread).
 * A message or comment of an agent of the person counts as the person's own. An archived chat does not count. A chat or task that
 * the person may not open is never in the list: the chats come from canSeeConversation, the threads from taskThreads.
 */
export function waitingFor(state: State, personId: string, now: Date): WaitingRow[] {
  const viewer = state.users[personId];
  if (!viewer) return [];
  const rows: WaitingRow[] = [];
  for (const conversation of Object.values(state.conversations)) {
    if (!canSeeConversation(state, conversation, viewer)) continue;
    const row = waitingChat(state, conversation, viewer, now);
    if (row) rows.push(row);
  }
  for (const thread of taskThreads(state, viewer)) {
    const row = waitingThread(state, thread, viewer, now);
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export const chatsWaiting = defineCall({
  /** The chats and task threads that wait for the reply of the person. Read only: it marks nothing read (fbk_011). */
  input: z.object({}),
  output: z.array(WaitingRow),
  readOnly: true,
  run(_input, ctx) {
    return waitingFor(ctx.state, ctx.authority.id, ctx.now);
  },
});

export const chatCalls = {
  'chats.list': chatsList,
  'chats.messages': chatsMessages,
  'chats.send': chatsSend,
  'chats.markRead': chatsMarkRead,
  'chats.archive': chatsArchive,
  'chats.openDirect': chatsOpenDirect,
  'chats.createGroup': chatsCreateGroup,
  'chats.updateGroup': chatsUpdateGroup,
  'chats.leaveGroup': chatsLeaveGroup,
  'chats.unreadCount': chatsUnreadCount,
  'chats.waiting': chatsWaiting,
};
