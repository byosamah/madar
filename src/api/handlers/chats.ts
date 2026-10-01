import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ConversationId, MESSAGE_MAX, UserId, type Conversation, type Message, type User } from '../contract/entities';
import { ChatRow, ChatThread, MessageView } from '../contract/views';
import { addDirectConversation, canSeeConversation, messagesOf, unreadIn } from '../chatState';
import { forbidden, invalid, notFound } from '../errors';
import { notify } from '../notify';
import { can, principalOf } from '../permissions';
import { chatReadKey, nextId, type State } from '../store';
import { cardOf } from '../views';
import { mentionedUserIds, plainText } from '../../lib/text';

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

function rowOf(state: State, conversation: Conversation, viewer: User): ChatRow {
  const last = messagesOf(state, conversation.id).at(-1) ?? null;
  const project = conversation.projectId ? state.projects[conversation.projectId] : undefined;
  const otherId = conversation.kind === 'direct' ? conversation.memberIds.find((id) => id !== viewer.id) : undefined;
  const person = otherId ? cardOf(state, otherId) : null;
  return {
    kind: conversation.kind,
    id: conversation.id,
    title: conversation.kind === 'project' ? (project?.name ?? '') : (person?.name ?? ''),
    project: project ? { id: project.id, code: project.code, name: project.name } : null,
    person,
    taskId: null,
    preview: last ? previewOf(last.body) : '',
    previewAuthor: last ? cardOf(state, last.authorId) : null,
    previewMine: last ? isMine(state, last, viewer.id) : false,
    lastAt: last?.createdAt ?? conversation.createdAt,
    unread: unreadIn(state, conversation.id, viewer.id),
  };
}

/** Tasks I own, lead or commented on, that have at least one comment. Reading follows the rule of comments.list, so a thread never shows what the comments call would refuse. */
function taskRows(state: State, viewer: User): ChatRow[] {
  const rows: ChatRow[] = [];
  if (!can(viewer, 'comment.read')) return rows;
  for (const task of Object.values(state.tasks)) {
    const comments = Object.values(state.comments)
      .filter((c) => c.targetType === 'task' && c.targetId === task.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const last = comments.at(-1);
    const project = state.projects[task.projectId];
    if (!last || !project) continue;
    const involved = task.ownerId === viewer.id || project.leaderId === viewer.id
      || comments.some((c) => principalOf(state, c.authorId) === viewer.id);
    if (!involved) continue;
    rows.push({
      kind: 'task', id: task.id, title: task.title, project: { id: project.id, code: project.code, name: project.name }, person: null,
      taskId: task.id, preview: previewOf(last.body), previewAuthor: cardOf(state, last.authorId),
      previewMine: principalOf(state, last.authorId) === viewer.id, lastAt: last.createdAt, unread: 0,
    });
  }
  return rows;
}

function messageViewOf(state: State, message: Message, viewerId: string): MessageView {
  return {
    message,
    author: cardOf(state, message.authorId),
    actingFor: message.actingForId !== message.authorId ? cardOf(state, message.actingForId) : null,
    mine: isMine(state, message, viewerId),
  };
}

function totalUnread(state: State, viewer: User): number {
  return visibleConversations(state, viewer).reduce((sum, c) => sum + unreadIn(state, c.id, viewer.id), 0);
}

function markReadNow(ctx: Ctx, conversation: Conversation): void {
  const last = messagesOf(ctx.state, conversation.id).at(-1);
  const lastReadAt = last && last.createdAt > ctx.stamp ? last.createdAt : ctx.stamp;
  ctx.state.chatReads[chatReadKey(conversation.id, ctx.authority.id)] = { conversationId: conversation.id, userId: ctx.authority.id, lastReadAt };
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
  input: z.object({ conversationId: ConversationId }),
  output: ChatThread,
  readOnly: true,
  run(input, ctx) {
    const conversation = requireConversation(ctx, input.conversationId);
    const people = Object.values(ctx.state.users)
      .filter((u) => u.kind === 'human' && u.id !== ctx.authority.id && canSeeConversation(ctx.state, conversation, u))
      .map((u) => cardOf(ctx.state, u.id));
    return {
      chat: { ...rowOf(ctx.state, conversation, ctx.authority), id: conversation.id },
      people,
      messages: messagesOf(ctx.state, conversation.id).map((m) => messageViewOf(ctx.state, m, ctx.authority.id)),
    };
  },
});

export const chatsSend = defineCall({
  input: z.object({ conversationId: ConversationId, body: z.string().trim().min(1).max(MESSAGE_MAX) }),
  output: MessageView,
  run(input, ctx) {
    const conversation = requireConversation(ctx, input.conversationId);
    const mentions = mentionedUserIds(input.body).filter((id) => {
      const user = ctx.state.users[id];
      return user?.active === true && canSeeConversation(ctx.state, conversation, user);
    });
    const id = nextId(ctx.state, 'msg');
    const message: Message = {
      id, conversationId: conversation.id, authorId: ctx.actor.id, actingForId: ctx.authority.id, body: input.body, mentions,
      createdAt: ctx.stamp, editedAt: null,
    };
    ctx.state.messages[id] = message;
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: mentions, trigger: 'mention', targetType: 'chat', targetId: conversation.id });
    markReadNow(ctx, conversation);
    return messageViewOf(ctx.state, message, ctx.authority.id);
  },
});

export const chatsMarkRead = defineCall({
  input: z.object({ conversationId: ConversationId }),
  output: z.object({ unread: z.number().int().min(0) }),
  run(input, ctx) {
    markReadNow(ctx, requireConversation(ctx, input.conversationId));
    return { unread: totalUnread(ctx.state, ctx.authority) };
  },
});

export const chatsOpenDirect = defineCall({
  input: z.object({ userId: UserId }),
  output: z.object({ id: ConversationId }),
  run(input, ctx) {
    const other = ctx.state.users[input.userId];
    if (!other) throw notFound('User', input.userId);
    if (principalOf(ctx.state, other.id) === ctx.authority.id) throw invalid('userId', 'You cannot message yourself.');
    if (other.kind !== 'human' || !other.active) throw invalid('userId', 'Pick an active person. Agents act for a person.');
    const existing = Object.values(ctx.state.conversations).find(
      (c) => c.kind === 'direct' && c.memberIds.includes(ctx.authority.id) && c.memberIds.includes(other.id),
    );
    return { id: (existing ?? addDirectConversation(ctx.state, ctx.authority.id, other.id, ctx.stamp)).id };
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
  'chats.openDirect': chatsOpenDirect,
  'chats.unreadCount': chatsUnreadCount,
};
