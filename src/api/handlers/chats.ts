import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ConversationId, FileId, GROUP_LOG_MAX, GROUP_MAX, GROUP_NAME_MAX, MAX_ATTACHMENTS, MESSAGE_MAX, MessageId, NotifyLevel, TaskId, UserId, emptyReactions, type Comment, type Conversation, type GroupLogEntry, type Message, type Project, type Reaction, type Task, type User } from '../contract/entities';
import { ChatRow, ChatThread, MessageView, WaitingRow, type GroupLine } from '../contract/views';
import { messagePageAround } from '../chatAround';
import { adminReachOf, addDirectConversation, addGroupConversation, canSeeConversation, hiddenByReach, closedChatError, isArchived, markedUnread, MESSAGE_PAGE, MESSAGE_PAGE_MAX, messagePage, messagesOf, personLeft, TASK_THREAD_LIMIT, unreadIn } from '../chatState';
import { forbidden, invalid, notFound } from '../errors';
import { isLiveMessage, namesPerson, notifyLevelOf, replyRefOf } from '../chatNaming';
import { readCopiesOf } from '../adminCopies';
import { notifyIn } from '../notify';
import { can, mayViewTask, principalOf, projectRoleOf } from '../permissions';
import { chatReadKey, nextId, unreadCountKey, type State } from '../store';
import { attachmentsOf, cardOf, mayViewFile } from '../views';
import { assertFilesForDirect, assertFilesInProject } from './attach';
import { replyNotHere } from './shared';
import { isLine, lineKindOf } from '../../lib/commentLine';
import { mentionedUserIds, plainText } from '../../lib/text';
import { listFormat } from '../../lib/dates';
import { personName } from '../../lib/personName';
import { markOf } from '../../lib/projectMark';

const PREVIEW_MAX = 140;

const previewOf = (body: string): string => {
  const flat = plainText(body).replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
};

/**
 * The chat the person may open. A chat that the person may not open answers as a missing chat, whatever its kind: a direct chat, a
 * group and a project chat alike, so an outsider learns nothing of it, not even that the id exists (owner rule of 2026-10-18 for a
 * group, chat design 2026-10-19, item 17, for the others). The answer equals the one for an id that was never made.
 */
function requireConversation(ctx: Ctx, id: string): Conversation {
  const conversation = ctx.state.conversations[id];
  if (!conversation || !canSeeConversation(ctx.state, conversation, ctx.authority)) throw notFound('Conversation', id);
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

/**
 * The conversations in the Inbox list and in the badge: the ones the person may open, less the project chats that an Admin who picked
 * "Only my work" neither leads nor works on (owner, 2026-10-23). Such a chat still opens, from its project, a link, a search or a notice.
 */
function listedConversations(state: State, viewer: User): Conversation[] {
  const reach = adminReachOf(viewer);
  const all = visibleConversations(state, viewer);
  return reach === 'mine' ? all.filter((c) => !hiddenByReach(projectRoleOf(state, c.projectId, viewer.id), c, reach)) : all;
}

function isMine(state: State, message: Message, viewerId: string): boolean {
  return message.actingForId === viewerId || principalOf(state, message.authorId) === viewerId;
}

/**
 * The person who acts as the maker of a group: the maker while the maker is active, else the first active person of the group
 * (UX audit 2026-10-19, INT-05). The record keeps the first maker, so a turn-on gives the role back. Null when nobody is active.
 */
export function actingMaker(state: State, group: Conversation): string | null {
  const active = (id: string) => state.users[id]?.active === true;
  if (group.makerId && group.memberIds.includes(group.makerId) && active(group.makerId)) return group.makerId;
  return group.memberIds.find(active) ?? null;
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
    makerId: group ? (actingMaker(state, conversation) ?? conversation.makerId ?? null) : null,
    members: group ? conversation.memberIds.slice(0, 3).map((id) => cardOf(state, id)) : [],
    preview: last ? previewOf(last.body) : '',
    previewAuthor: last ? cardOf(state, last.authorId) : null,
    previewMine: last ? isMine(state, last, viewer.id) : false,
    previewKind: null,
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
  const key = chatReadKey(taskId, viewerId);
  const counted = state.counts?.[unreadCountKey(taskId, viewerId)];
  const count = counted ?? newCommentsOf(state, key, comments, viewerId);
  // A thread that the person marked unread (chats.markUnread, fbk_028) counts at least 1 until the person opens it again.
  return markedUnread(state, key) ? Math.max(count, 1) : count;
}

/** The comments by other people after the last read mark and after the viewer's own last message. */
function newCommentsOf(state: State, readKey: string, comments: Comment[], viewerId: string): number {
  const lastRead = state.chatReads[readKey]?.lastReadAt ?? '';
  // A quiet line of a reason is no message: it is never unread, and a line that the viewer wrote does not count as a reply (fbk_027).
  const talk = comments.filter((c) => !isLine(c));
  const mine = talk.findLastIndex((c) => principalOf(state, c.authorId) === viewerId);
  return talk.filter((c, i) => i > mine && c.createdAt > lastRead && principalOf(state, c.authorId) !== viewerId).length;
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
    // The newest item may be a quiet line of a reason: the row then shows its short line, from the kind and the reason (fbk_027).
    const kind = lineKindOf(last);
    return {
      kind: 'task', id: task.id, title: task.title, project: project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null, person: null,
      makerId: null, members: [], taskId: task.id, preview: previewOf(last.body), previewAuthor: cardOf(state, last.authorId),
      previewMine: principalOf(state, last.authorId) === viewer.id, previewKind: kind === 'message' ? null : kind, lastAt: last.createdAt, unread: taskUnread(state, task.id, comments, viewer.id), personLeft: false,
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
    replyTo: replyRefOf(state, message, viewer.id),
    namesMe: namesPerson(state, message, viewer.id),
  };
}

function totalUnread(state: State, viewer: User): number {
  const chats = listedConversations(state, viewer).reduce((sum, c) => sum + unreadIn(state, c.id, viewer.id), 0);
  return chats + taskThreads(state, viewer).reduce((sum, t) => sum + taskUnread(state, t.task.id, t.comments, viewer.id), 0);
}

/**
 * Marks a chat or a task thread read up to now, or up to its last item when that is later. Nothing in it is unread after that,
 * so a count that a server loader put in the state becomes 0 (plan 4.13, A9). Without counts, the state gets none.
 */
function writeReadMark(ctx: Ctx, conversationId: string, lastAt: string | undefined): void {
  const lastReadAt = lastAt && lastAt > ctx.stamp ? lastAt : ctx.stamp;
  const key = chatReadKey(conversationId, ctx.authority.id);
  // The archive mark stays (owner, 2026-10-18): a newer message clears it in the view, not here. A read ends the mark "unread" (fbk_028).
  const { markedUnread: _ended, ...kept } = ctx.state.chatReads[key] ?? {};
  ctx.state.chatReads[key] = { ...kept, conversationId, userId: ctx.authority.id, lastReadAt };
  if (ctx.state.counts) ctx.state.counts[unreadCountKey(conversationId, ctx.authority.id)] = 0;
}

function markReadNow(ctx: Ctx, conversation: Conversation): void {
  writeReadMark(ctx, conversation.id, messagesOf(ctx.state, conversation.id).at(-1)?.createdAt);
}

/**
 * A read of a chat or a task thread also reads its mention notices (chat design item 20): the unread notices of the person with the
 * trigger "mention" (a reply notice has it too) that point to this chat or task. The bell then shows nothing the person has seen,
 * and the mention mail and push of the 10-second wait find the notice read. Notices of other chats, and every other trigger (for
 * example added_to_group), stay as they are. chats.send does not call this: its loader loads no notices, and the open chat marked them.
 */
function readMentionNotices(ctx: Ctx, chatId: string): void {
  const targetType = chatId.startsWith('tsk_') ? 'task' : 'chat';
  for (const notice of Object.values(ctx.state.notifications)) {
    if (notice.userId === ctx.authority.id && !notice.read && notice.trigger === 'mention' && notice.targetType === targetType && notice.targetId === chatId) {
      notice.read = true;
    }
  }
}

export const chatsList = defineCall({
  input: z.object({}),
  output: z.array(ChatRow),
  readOnly: true,
  run(_input, ctx) {
    // A direct chat with no message shows only for the person who has a read mark on it, who opened it (chat design 2026-10-19, item 18).
    const shown = listedConversations(ctx.state, ctx.authority)
      .map((c) => rowOf(ctx.state, c, ctx.authority))
      .filter((row) => row.kind !== 'direct' || row.previewAuthor !== null || ctx.state.chatReads[chatReadKey(row.id, ctx.authority.id)] !== undefined);
    const rows = [...shown, ...taskRows(ctx.state, ctx.authority)];
    return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.id.localeCompare(a.id));
  },
});

/** The quiet lines of a group for the screen, oldest first, with the people named. They are no messages (UX audit 2026-10-19). */
function linesOf(state: State, group: Conversation): GroupLine[] {
  return (group.log ?? []).map((entry) => ({
    id: entry.id, at: entry.at, type: entry.type, actor: cardOf(state, entry.actorId), people: entry.personIds.map((id) => cardOf(state, id)), name: entry.name ?? null,
  }));
}

/** The log of a group with new lines at the end. The ids count up, and only the newest GROUP_LOG_MAX stay. */
function withLines(ctx: Ctx, group: Conversation, lines: Array<Pick<GroupLogEntry, 'type' | 'personIds'> & { name?: string }>): GroupLogEntry[] {
  const old = group.log ?? [];
  let seq = old.reduce((top, entry) => Math.max(top, Number(entry.id.slice(2)) || 0), 0);
  const added = lines.map((line): GroupLogEntry => {
    seq += 1;
    return { id: `gl${seq}`, at: ctx.stamp, type: line.type, actorId: ctx.authority.id, personIds: line.personIds, ...(line.name === undefined ? {} : { name: line.name }) };
  });
  return [...old, ...added].slice(-GROUP_LOG_MAX);
}

export const chatsMessages = defineCall({
  /**
   * One page of messages (plan 4.13, A5): the newest "limit" messages before the message "before", oldest first.
   * The screen asks for the next page with the id of the oldest message it shows. A page shorter than "limit" is the last one.
   * "around" (chat design 2026-10-19, item 17) opens the page at one message: 20 messages before it and every newer one, up to 500 in
   * all; "newer" says that more follow. A message that is no live message of this chat gives the newest page, with no error.
   */
  input: z.object({
    conversationId: ConversationId,
    before: MessageId.optional(),
    around: MessageId.optional(),
    limit: z.number().int().min(1).max(MESSAGE_PAGE_MAX).default(MESSAGE_PAGE),
  }),
  output: ChatThread,
  readOnly: true,
  run(input, ctx) {
    const conversation = requireConversation(ctx, input.conversationId);
    if (input.around !== undefined && input.before !== undefined) throw invalid('around', 'Give around or before, not both.');
    const around = input.around === undefined ? null : messagePageAround(ctx.state, conversation.id, input.limit, input.around);
    const page = around?.page ?? messagePage(ctx.state, conversation.id, input.limit, input.before);
    if (!page) throw invalid('before', 'This message is not in this chat.');
    const people = Object.values(ctx.state.users)
      .filter((u) => u.kind === 'human' && u.id !== ctx.authority.id && canSeeConversation(ctx.state, conversation, u))
      .map((u) => cardOf(ctx.state, u.id));
    return {
      chat: { ...rowOf(ctx.state, conversation, ctx.authority), id: conversation.id },
      people,
      messages: page.map((m) => messageViewOf(ctx.state, m, ctx.authority)),
      lines: conversation.kind === 'group' ? linesOf(ctx.state, conversation) : [],
      // The read time before this read (the read itself marks nothing, but the open of the screen does), for the "New" line.
      readUpTo: ctx.state.chatReads[chatReadKey(conversation.id, ctx.authority.id)]?.lastReadAt ?? null,
      notify: notifyLevelOf(ctx.state, conversation, ctx.authority.id),
      newer: around?.newer ?? false,
    };
  },
});

/**
 * The people that a message body names (chat design items 4 and 10): the active people of the chat whom the text names with @, and
 * the author of the old message when the message is a reply. A reply names the person behind the old message, unless that is the
 * sender, or the person left, or cannot open the chat. A person named in the text too has the one plain notice, so "replyOnly" is the
 * reply author named by the reply alone. "mentions" is the list the message keeps.
 */
function namesIn(ctx: Ctx, conversation: Conversation, body: string, old: Message | undefined): { named: string[]; replyOnly: string | undefined; mentions: string[] } {
  const named = mentionedUserIds(body).filter((id) => {
    const user = ctx.state.users[id];
    return user?.active === true && canSeeConversation(ctx.state, conversation, user);
  });
  const replyUser = old === undefined ? undefined : ctx.state.users[old.actingForId];
  const replyAuthor = replyUser !== undefined && replyUser.id !== ctx.authority.id && replyUser.active && canSeeConversation(ctx.state, conversation, replyUser)
    ? replyUser.id : undefined;
  const replyOnly = replyAuthor !== undefined && !named.includes(replyAuthor) ? replyAuthor : undefined;
  return { named, replyOnly, mentions: replyOnly === undefined ? named : [...named, replyOnly] };
}

/** Checks the files of a message against the room, then stores the message. A project room takes files of its project. A direct room takes files that both people may open. */
export function postMessage(ctx: Ctx, conversation: Conversation, body: string, fileIds: string[], replyToId?: string): MessageView {
  // A reply answers a live message of the same chat. Every other case gives one refusal, so the answer never tells that an id exists elsewhere.
  const old = replyToId === undefined ? undefined : ctx.state.messages[replyToId];
  if (replyToId !== undefined && (!old || !isLiveMessage(old) || old.conversationId !== conversation.id)) throw replyNotHere();
  // Files are refused unless a rule below allows them.
  if (fileIds.length > 0) {
    if (conversation.kind === 'project') {
      if (!conversation.projectId) throw invalid('fileIds', 'This chat has no project for files.', 'file_not_visible');
      assertFilesInProject(ctx, fileIds, conversation.projectId);
    } else {
      const others = conversation.memberIds.filter((id) => id !== ctx.authority.id);
      if (others.length === 0) throw invalid('fileIds', 'This chat has no other person.', 'file_not_visible');
      assertFilesForDirect(ctx, fileIds, others, conversation.id);
    }
  }
  const { named, replyOnly, mentions } = namesIn(ctx, conversation, body, old);
  const id = nextId(ctx.state, 'msg');
  const message: Message = {
    id, conversationId: conversation.id, authorId: ctx.actor.id, actingForId: ctx.authority.id, body, mentions, fileIds,
    ...(replyToId ? { replyToId } : {}), createdAt: ctx.stamp, editedAt: null,
  };
  ctx.state.messages[id] = message;
  notifyIn(ctx, { userIds: named, trigger: 'mention', targetType: 'chat', targetId: conversation.id, messageId: id });
  if (replyOnly !== undefined) {
    notifyIn(ctx, { userIds: [replyOnly], trigger: 'mention', targetType: 'chat', targetId: conversation.id, messageId: id, reply: true });
  }
  markReadNow(ctx, conversation);
  return messageViewOf(ctx.state, message, ctx.authority);
}

export const chatsSend = defineCall({
  input: z.object({
    conversationId: ConversationId,
    body: z.string().trim().min(1).max(MESSAGE_MAX),
    fileIds: z.array(FileId).max(MAX_ATTACHMENTS).default([]),
    // The message of the same chat that this one answers (chat design item 10). Its author is named.
    replyToId: MessageId.optional(),
  }),
  output: MessageView,
  run(input, ctx) {
    const conversation = requireConversation(ctx, input.conversationId);
    if (personLeft(ctx.state, conversation, ctx.authority)) throw closedChatError(conversation);
    return postMessage(ctx, conversation, input.body, input.fileIds, input.replyToId);
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
    readMentionNotices(ctx, input.conversationId);
    return { unread: totalUnread(ctx.state, ctx.authority) };
  },
});

/** The read time of a chat with no read mark yet: older than any message, so the archive marks nothing read. */
const NEVER_READ = '1970-01-01T00:00:00.000Z';

export const chatsMarkUnread = defineCall({
  /**
   * The person marks a chat or a task thread as unread again (fbk_028, owner 2026-10-23). It shows as unread (the row, the Inbox badge)
   * until the person opens it again: a read mark (chats.markRead, a sent message, an archive) ends it. The mark never adds to the number
   * of new messages. Only the person's own read mark changes, and no event, notice or push is written. An archived chat comes back to
   * the Inbox, so the badge never counts a chat that is out of the list. The checks are those of chats.markRead and chats.archive, so a
   * hidden chat answers the same way. MCP: deny list, as chats.markRead.
   */
  input: z.object({ conversationId: z.union([ConversationId, TaskId]) }),
  output: z.object({ unread: z.literal(true) }),
  run(input, ctx) {
    const id = input.conversationId;
    if (id.startsWith('tsk_')) requireTaskThread(ctx, id);
    else requireConversation(ctx, id);
    const key = chatReadKey(id, ctx.authority.id);
    const read = ctx.state.chatReads[key];
    ctx.state.chatReads[key] = {
      ...read, conversationId: id, userId: ctx.authority.id, lastReadAt: read?.lastReadAt ?? NEVER_READ,
      ...(read?.archivedAt ? { archivedAt: null } : {}), markedUnread: true,
    };
    return { unread: true as const };
  },
});

export const chatsArchive = defineCall({
  /**
   * Archives a chat or a task thread for the person, or moves it back to the Inbox (owner, 2026-10-18). Only the person's own read
   * mark changes, and no event is written. The checks are those of chats.markRead, so a hidden chat answers the same way.
   * An archive also marks the chat read up to now (UX audit 2026-10-19, INT-01): the Inbox badge never counts a chat that the person
   * cannot find in the list. A new message brings the chat back with its own unread number. Moving back keeps the read mark.
   */
  input: z.object({ conversationId: z.union([ConversationId, TaskId]), archived: z.boolean() }),
  output: z.object({ archived: z.boolean() }),
  run(input, ctx) {
    const id = input.conversationId;
    if (id.startsWith('tsk_')) requireTaskThread(ctx, id);
    else requireConversation(ctx, id);
    if (input.archived) {
      writeReadMark(ctx, id, undefined);
      readMentionNotices(ctx, id);
    }
    const key = chatReadKey(id, ctx.authority.id);
    const read = ctx.state.chatReads[key];
    // Every other field of the mark stays, the "Notify me" choice too (chat design item 21).
    ctx.state.chatReads[key] = {
      ...read, conversationId: id, userId: ctx.authority.id, lastReadAt: read?.lastReadAt ?? NEVER_READ, archivedAt: input.archived ? ctx.stamp : null,
    };
    return { archived: input.archived };
  },
});

export const chatsSetNotify = defineCall({
  /**
   * Keeps the "Notify me" choice of the person for one chat (chat design item 21): "all" pushes every message, "named" pushes only a
   * message that names the person. A chat only: a task thread has no choice. Only the own read mark changes, every other field of it
   * stays, and no event, notice or message is written. With no mark yet, the mark holds NEVER_READ, so the chat stays as unread as it
   * was. The checks are those of chats.markRead, so a hidden chat answers the same way.
   */
  input: z.object({ conversationId: ConversationId, notify: NotifyLevel }),
  output: z.object({ notify: NotifyLevel }),
  run(input, ctx) {
    requireConversation(ctx, input.conversationId);
    const key = chatReadKey(input.conversationId, ctx.authority.id);
    const read = ctx.state.chatReads[key];
    ctx.state.chatReads[key] = {
      ...read, conversationId: input.conversationId, userId: ctx.authority.id, lastReadAt: read?.lastReadAt ?? NEVER_READ, notify: input.notify,
    };
    return { notify: input.notify };
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
    const chat = directWith(ctx, requireDirectPartner(ctx, input.userId));
    // A chat with no message shows only for the person who opened it, who gets a read mark (chat design 2026-10-19, item 18). An agent
    // writes no mark: its person sees the chat after the first message. A chat with messages, or with a mark, changes nothing.
    if (ctx.actor.kind === 'human' && messagesOf(ctx.state, chat.id).length === 0 && ctx.state.chatReads[chatReadKey(chat.id, ctx.authority.id)] === undefined) {
      writeReadMark(ctx, chat.id, undefined);
    }
    return { id: chat.id };
  },
});

/** A group name: 1 to 60 letters, with the spaces at its ends cut. */
const GroupName = z.string().trim().min(1).max(GROUP_NAME_MAX);

/**
 * The name of a group that the maker did not name (UX audit 2026-10-19, chats-09): the first names of the people, three at most,
 * in the language of the maker, then "+N" for the rest. The group can be renamed later like any other.
 */
function autoGroupName(state: State, maker: User, memberIds: string[]): string {
  const lang = maker.preferences.language;
  const firsts = memberIds.map((id) => personName(state.users[id], lang).split(/\s+/)[0]);
  const shown = firsts.slice(0, 3);
  const rest = firsts.length - shown.length;
  const text = rest > 0 ? `${shown.join(', ')} +${rest}` : listFormat(lang).format(shown);
  return Array.from(text).slice(0, GROUP_NAME_MAX).join('');
}

/**
 * A group of the person and 2 to 49 other active people (owner, 2026-10-18). The person is its maker. It writes no History event.
 * The name is optional: with none, the group takes the first names of its people.
 */
export const chatsCreateGroup = defineCall({
  input: z.object({ name: GroupName.optional(), memberIds: z.array(UserId).min(2).max(GROUP_MAX - 1) }),
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
    const name = input.name ?? autoGroupName(ctx.state, ctx.authority, input.memberIds);
    const group = addGroupConversation(ctx.state, name, ctx.authority.id, [ctx.authority.id, ...input.memberIds], ctx.stamp);
    return { id: group.id };
  },
});

/**
 * Renames a group, adds people or removes people (owner, 2026-10-18). Any member renames and adds. Only the maker removes people
 * (the first active person while the maker is turned off), and the maker never removes itself (chats.leaveGroup does that). A
 * removal keeps at least two people. It writes no History event. Each change writes one quiet line in the group, and an added
 * person gets one notice (UX audit 2026-10-19, chats-10 and INT-15).
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
    const maker = actingMaker(ctx.state, group);
    if (remove.length > 0 && maker !== ctx.authority.id) {
      throw forbidden('Only the maker of the group removes people.', { conversationId: group.id, reason: 'not_maker' });
    }
    if (remove.some((id) => id === maker || !group.memberIds.includes(id))) throw invalid('remove', 'Pick a person of the group who is not the maker.');
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
    const renamed = input.name !== undefined && input.name !== group.name;
    const lines: Array<Pick<GroupLogEntry, 'type' | 'personIds'> & { name?: string }> = [
      ...(renamed ? [{ type: 'renamed' as const, personIds: [], name: input.name }] : []),
      ...(add.length > 0 ? [{ type: 'added' as const, personIds: add }] : []),
      ...(remove.length > 0 ? [{ type: 'removed' as const, personIds: remove }] : []),
    ];
    ctx.state.conversations[group.id] = {
      ...group, memberIds: [...kept, ...add], name: input.name ?? group.name, ...(lines.length > 0 ? { log: withLines(ctx, group, lines) } : {}),
    };
    if (add.length > 0) notifyIn(ctx, { userIds: add, trigger: 'added_to_group', targetType: 'chat', targetId: group.id });
    return { id: group.id };
  },
});

/**
 * Leaves a group. A person can always leave (UX audit 2026-10-19, chats-11): the people who stay keep the history, and the last
 * one reads a closed chat. When the maker leaves, the first other active person becomes the maker. A quiet line says who left.
 */
export const chatsLeaveGroup = defineCall({
  input: z.object({ conversationId: ConversationId }),
  output: z.object({}),
  run(input, ctx) {
    const group = requireGroup(ctx, input.conversationId);
    const kept = group.memberIds.filter((id) => id !== ctx.authority.id);
    const makerId = group.makerId === ctx.authority.id
      ? (kept.find((id) => ctx.state.users[id]?.active === true) ?? kept[0] ?? ctx.authority.id)
      : group.makerId;
    ctx.state.conversations[group.id] = { ...group, memberIds: kept, makerId, log: withLines(ctx, group, [{ type: 'left', personIds: [] }]) };
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

/**
 * True when the viewer put a 👍 or a ✅ on the message or comment that waits (chat design item 22): that counts as the answer. A reaction
 * of an agent of the viewer counts as the viewer's own. A 👀 is no answer: it says "seen", not "done".
 */
export function answeredByReaction(state: State, reactions: Partial<Record<Reaction, string[]>> | undefined, viewerId: string): boolean {
  return (['👍', '✅'] as const).some((emoji) => (reactions?.[emoji] ?? []).some((id) => principalOf(state, id) === viewerId));
}

/** A chat that waits for the reply of the viewer, with the message that waits. Null when nothing waits. */
function waitingChat(state: State, conversation: Conversation, viewer: User, now: Date): WaitingRow | null {
  const messages = messagesOf(state, conversation.id);
  const last = messages.at(-1);
  const lastAt = last?.createdAt ?? conversation.createdAt;
  if (isArchived(state.chatReads[chatReadKey(conversation.id, viewer.id)], lastAt)) return null;
  // A group with nobody else in it takes no reply (UX audit 2026-10-19, chats-11).
  if (conversation.kind === 'group' && personLeft(state, conversation, viewer)) return null;
  let waiting: Message | undefined;
  if (conversation.kind === 'direct') {
    // A direct chat: its newest message came from another person.
    if (last && !isMine(state, last, viewer.id)) waiting = last;
  } else {
    // A group or a project chat: the newest message of another person that names the viewer (an @mention, or a reply to a message of the
    // viewer, which joined "mentions" when it was sent), and is newer than the viewer's newest message (chat design item 22).
    const own = messages.findLast((m) => isMine(state, m, viewer.id));
    const named = messages.findLast((m) => namesPerson(state, m, viewer.id));
    if (named && (!own || laterThan(named, own))) waiting = named;
  }
  // A 👍 or a ✅ of the viewer on the message that waits is the answer.
  if (!waiting || answeredByReaction(state, waiting.reactions, viewer.id)) return null;
  const row = rowOf(state, conversation, viewer);
  return {
    kind: conversation.kind, id: conversation.id, title: row.title, project: row.project, from: cardOf(state, waiting.authorId),
    body: Array.from(plainText(waiting.body)).slice(0, WAITING_BODY_MAX).join(''), at: waiting.createdAt, days: daysSince(waiting.createdAt, now),
  };
}

/**
 * A task thread that waits for the reply of the viewer. Its newest comment came from another person.
 * The viewer leads the task, or a newer comment of another person names the viewer: an @ in the body, or a reply to a comment of the
 * viewer (namesPerson). Comments keep no mention list, so the body holds the mention markup. The row shows the newest comment for the
 * lead, and the named comment otherwise. A 👍 or ✅ of the viewer on that comment is the answer (chat design item 22).
 */
function waitingThread(state: State, thread: TaskThread, viewer: User, now: Date): WaitingRow | null {
  const { task, project } = thread;
  // A quiet line of a reason waits for no reply (fbk_027): only the messages of the thread count.
  const comments = thread.comments.filter((c) => !isLine(c));
  const last = comments.at(-1);
  if (!last || principalOf(state, last.authorId) === viewer.id) return null;
  if (isArchived(state.chatReads[chatReadKey(task.id, viewer.id)], last.createdAt)) return null;
  const own = comments.findLast((c) => principalOf(state, c.authorId) === viewer.id);
  const others = comments.filter((c) => principalOf(state, c.authorId) !== viewer.id && (!own || laterThan(c, own)));
  const waiting = task.ownerId === viewer.id ? others.at(-1) : others.findLast((c) => namesPerson(state, c, viewer.id));
  if (!waiting || answeredByReaction(state, waiting.reactions, viewer.id)) return null;
  return {
    kind: 'task', id: task.id, title: task.title, project: project ? { id: project.id, code: project.code, name: project.name, mark: markOf(project) } : null,
    from: cardOf(state, waiting.authorId), body: Array.from(plainText(waiting.body)).slice(0, WAITING_BODY_MAX).join(''),
    at: waiting.createdAt, days: daysSince(waiting.createdAt, now),
  };
}

/**
 * The chats and task threads that wait for the reply of the person (fbk_011, owner 2026-10-18), oldest first.
 * - A direct chat waits when its newest message came from another person.
 * - A group or a project chat waits when a message that names the person (an @mention or a reply to the person) is newer than the
 *   person's newest message (design item 22; a group no longer waits for each member).
 * - A task thread waits when its newest comment came from another person, and the person leads the task or is named (see waitingThread).
 * - In every kind, a 👍 or ✅ of the person on the message that waits is the answer (answeredByReaction).
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

/**
 * The message by id, for a call that changes it (chat design items 11 and 12). A missing message, a message of a chat that the person
 * may not open, and (unless "allowDeleted") a deleted message all answer not_found, the same answer for an id that was never made, so
 * an outsider learns nothing of a chat (Review Focus 5). With "author", a person who is not the author gets forbidden with the reason
 * not_author: the person can open the chat, so the refusal tells nothing new. An agent's message belongs to its person (isMine).
 */
export function requireMessage(ctx: Ctx, id: string, rules: { author: boolean; allowDeleted: boolean }): { message: Message; conversation: Conversation } {
  const message = ctx.state.messages[id];
  const conversation = message ? ctx.state.conversations[message.conversationId] : undefined;
  if (!message || !conversation || !canSeeConversation(ctx.state, conversation, ctx.authority) || (!rules.allowDeleted && !isLiveMessage(message))) {
    throw notFound('Message', id);
  }
  if (rules.author && !isMine(ctx.state, message, ctx.authority.id)) {
    throw forbidden('You can change only your own messages.', { messageId: id, reason: 'not_author' });
  }
  return { message, conversation };
}

/** The old message that a reply answers, for the names of an edit: the same chat only, also when it is deleted since. */
function replyTargetOf(ctx: Ctx, message: Message): Message | undefined {
  const old = message.replyToId === undefined ? undefined : ctx.state.messages[message.replyToId];
  return old !== undefined && old.conversationId === message.conversationId ? old : undefined;
}

/** Takes away the notices that point to one message, for the given people only (every person when "userIds" is left out). */
function dropMessageNotices(ctx: Ctx, message: Message, userIds?: readonly string[]): void {
  for (const [key, notice] of Object.entries(ctx.state.notifications)) {
    if (notice.targetType !== 'chat' || notice.targetId !== message.conversationId || notice.messageId !== message.id) continue;
    // A copy for an Admin names the people of the original (owner, 2026-10-23): an edit that removes a name takes that name out of the
    // copy, and the copy goes when no name is left. A delete (no userIds) takes every copy.
    if (notice.forUserIds !== undefined && userIds !== undefined) {
      const left = notice.forUserIds.filter((id) => !userIds.includes(id));
      if (left.length === 0) delete ctx.state.notifications[key];
      else if (left.length < notice.forUserIds.length) ctx.state.notifications[key] = { ...notice, forUserIds: left };
      continue;
    }
    if (userIds === undefined || userIds.includes(notice.userId)) delete ctx.state.notifications[key];
  }
}

/**
 * Toggles the reaction of the person behind the call on a chat message (chat design item 12). Any person who may open the chat reacts, in
 * a closed chat too. It writes no event and no notice and leaves "createdAt" alone, so it makes no unread mark and no push. A message
 * with no reactions record starts from none.
 */
export function toggleMessageReaction(ctx: Ctx, messageId: string, emoji: Reaction): MessageView {
  const { message } = requireMessage(ctx, messageId, { author: false, allowDeleted: false });
  const now = { ...emptyReactions(), ...message.reactions };
  const me = ctx.authority.id;
  const next = now[emoji].includes(me) ? now[emoji].filter((id) => id !== me) : [...now[emoji], me];
  const reacted: Message = { ...message, reactions: { ...now, [emoji]: next } };
  ctx.state.messages[message.id] = reacted;
  return messageViewOf(ctx.state, reacted, ctx.authority);
}

export const chatsEditMessage = defineCall({
  /**
   * The author changes the words of a chat message, at any time, in a closed chat too (design item 11). The same words change nothing.
   * The names are found again: a person named for the first time gets the mention notice, a person whose name the edit removes loses
   * the notices of this message, and the reply author stays named while that person is active and in the chat. It writes no History
   * event, as a message never does.
   */
  input: z.object({ id: MessageId, body: z.string().trim().min(1).max(MESSAGE_MAX) }),
  output: MessageView,
  run(input, ctx) {
    const { message, conversation } = requireMessage(ctx, input.id, { author: true, allowDeleted: false });
    if (input.body === message.body) return messageViewOf(ctx.state, message, ctx.authority);
    const { named, replyOnly, mentions } = namesIn(ctx, conversation, input.body, replyTargetOf(ctx, message));
    const edited: Message = { ...message, body: input.body, mentions, editedAt: ctx.stamp };
    ctx.state.messages[message.id] = edited;
    dropMessageNotices(ctx, message, message.mentions.filter((id) => !mentions.includes(id)));
    const first = (ids: readonly string[]) => ids.filter((id) => !message.mentions.includes(id));
    notifyIn(ctx, { userIds: first(named), trigger: 'mention', targetType: 'chat', targetId: conversation.id, messageId: message.id });
    if (replyOnly !== undefined) {
      notifyIn(ctx, { userIds: first([replyOnly]), trigger: 'mention', targetType: 'chat', targetId: conversation.id, messageId: message.id, reply: true });
    }
    return messageViewOf(ctx.state, edited, ctx.authority);
  },
});

export const chatsDeleteMessage = defineCall({
  /**
   * The author deletes a chat message for everyone, with no question (design item 11). The message leaves every read path and its notices
   * go. A file of the message stays. The Undo of the toast calls this again with "deleted: false": the message comes back and the people it
   * names get their notices again, already read, so a restore sends no second push and no second mention mail. The same value changes
   * nothing. It works in a closed chat. It writes no History event, as chats.archive does not.
   */
  input: z.object({ id: MessageId, deleted: z.boolean().default(true) }),
  output: z.object({ deleted: z.boolean() }),
  run(input, ctx) {
    const { message, conversation } = requireMessage(ctx, input.id, { author: true, allowDeleted: true });
    const gone = !isLiveMessage(message);
    if (input.deleted === gone) return { deleted: gone };
    if (input.deleted) {
      ctx.state.messages[message.id] = { ...message, deletedAt: ctx.stamp };
      dropMessageNotices(ctx, message);
      return { deleted: true };
    }
    const { deletedAt: _deletedAt, ...live } = message;
    ctx.state.messages[message.id] = live;
    const { named, replyOnly } = namesIn(ctx, conversation, message.body, replyTargetOf(ctx, message));
    const again = notifyIn(ctx, { userIds: named, trigger: 'mention', targetType: 'chat', targetId: conversation.id, messageId: message.id });
    if (replyOnly !== undefined) {
      again.push(...notifyIn(ctx, { userIds: [replyOnly], trigger: 'mention', targetType: 'chat', targetId: conversation.id, messageId: message.id, reply: true }));
    }
    for (const notice of again) notice.read = true;
    readCopiesOf(ctx, message.id);
    return { deleted: false };
  },
});

export const chatCalls = {
  'chats.list': chatsList,
  'chats.messages': chatsMessages,
  'chats.send': chatsSend,
  'chats.editMessage': chatsEditMessage,
  'chats.deleteMessage': chatsDeleteMessage,
  'chats.markRead': chatsMarkRead,
  'chats.markUnread': chatsMarkUnread,
  'chats.archive': chatsArchive,
  'chats.setNotify': chatsSetNotify,
  'chats.openDirect': chatsOpenDirect,
  'chats.createGroup': chatsCreateGroup,
  'chats.updateGroup': chatsUpdateGroup,
  'chats.leaveGroup': chatsLeaveGroup,
  'chats.unreadCount': chatsUnreadCount,
  'chats.waiting': chatsWaiting,
};
