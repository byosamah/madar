import type { Conversation, Message, User } from './contract/entities';
import { can, principalOf, projectRoleOf } from './permissions';
import { chatReadKey, nextId, type State } from './store';

/** Makes the chat room of a project. A project has one. */
export function addProjectConversation(state: State, projectId: string, createdAt: string): Conversation {
  const id = nextId(state, 'cnv');
  const conversation: Conversation = { id, kind: 'project', projectId, memberIds: [], createdAt };
  state.conversations[id] = conversation;
  return conversation;
}

export function addDirectConversation(state: State, a: string, b: string, createdAt: string): Conversation {
  const id = nextId(state, 'cnv');
  const conversation: Conversation = { id, kind: 'direct', projectId: null, memberIds: [a, b].sort(), createdAt };
  state.conversations[id] = conversation;
  return conversation;
}

/** Removes the chat room of a project, with its messages, read marks and mention notices. */
export function dropProjectConversation(state: State, projectId: string): void {
  for (const conversation of Object.values(state.conversations)) {
    if (conversation.kind !== 'project' || conversation.projectId !== projectId) continue;
    const id = conversation.id;
    for (const [key, message] of Object.entries(state.messages)) if (message.conversationId === id) delete state.messages[key];
    for (const [key, read] of Object.entries(state.chatReads)) if (read.conversationId === id) delete state.chatReads[key];
    for (const [key, n] of Object.entries(state.notifications)) if (n.targetType === 'chat' && n.targetId === id) delete state.notifications[key];
    delete state.conversations[id];
  }
}

/** The one rule of who sees a chat room: a direct chat is for its two people, a project chat for the team and the Admin. */
export function canSeeConversation(state: State, conversation: Conversation, user: User): boolean {
  if (!user.active) return false;
  if (conversation.kind === 'direct') return conversation.memberIds.includes(user.id);
  const projectId = conversation.projectId;
  if (!projectId || !state.projects[projectId]) return false;
  return can(user, 'chat.project', { projectRole: projectRoleOf(state, projectId, user.id) });
}

/** The messages of one page of a chat when the screen names no limit, and the most it may ask for (plan 4.13, A5; AM 7.5). */
export const MESSAGE_PAGE = 200;
export const MESSAGE_PAGE_MAX = 500;
/** The most task threads that chats.list shows. The Inbox keeps the newest; older threads stay on their task. */
export const TASK_THREAD_LIMIT = 100;

/** The messages of a conversation, oldest first: by stamp, then by id. The server reads them in the same order. */
export function messagesOf(state: State, conversationId: string): Message[] {
  return Object.values(state.messages)
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** Messages that other people wrote after the person last read the room. A person's own agent counts as the person. */
export function unreadIn(state: State, conversationId: string, userId: string): number {
  const lastRead = state.chatReads[chatReadKey(conversationId, userId)]?.lastReadAt ?? '';
  return Object.values(state.messages).filter(
    (m) => m.conversationId === conversationId && m.createdAt > lastRead && principalOf(state, m.authorId) !== userId && m.actingForId !== userId,
  ).length;
}

/**
 * One page of a conversation: the newest "limit" messages that come before the message "before", oldest first.
 * "before" is a message id, not a stamp, so messages with the same stamp never fall between two pages.
 * Null when "before" is not a message of this conversation.
 */
export function messagePage(state: State, conversationId: string, limit: number, before?: string): Message[] | null {
  const all = messagesOf(state, conversationId);
  const end = before === undefined ? all.length : all.findIndex((m) => m.id === before);
  if (end < 0) return null;
  return all.slice(Math.max(0, end - limit), end);
}
