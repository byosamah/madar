import { isLiveMessage } from './chatNaming';
import type { AdminReach, ChatRead, Conversation, Message, NotifyLevel, User } from './contract/entities';
import { forbidden, invalid, notFound } from './errors';
import { can, principalOf, projectRoleOf, type ProjectRole } from './permissions';
import { chatReadKey, nextId, unreadCountKey, type State } from './store';

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

/** Makes a group. Its people keep the order in which they joined, so the maker stays first (no sort, unlike a direct chat). */
export function addGroupConversation(state: State, name: string, makerId: string, memberIds: string[], createdAt: string): Conversation {
  const id = nextId(state, 'cnv');
  const conversation: Conversation = { id, kind: 'group', projectId: null, memberIds: [...memberIds], name, makerId, createdAt };
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

/**
 * The one rule of who sees a chat room: a direct chat is for its two people, a group for its people (never the Admin alone),
 * and a project chat for the team and the Admin.
 */
export function canSeeConversation(state: State, conversation: Conversation, user: User): boolean {
  if (!user.active) return false;
  if (conversation.kind !== 'project') return conversation.memberIds.includes(user.id);
  const projectId = conversation.projectId;
  if (!projectId || !state.projects[projectId]) return false;
  return can(user, 'chat.project', { projectRole: projectRoleOf(state, projectId, user.id) });
}

/**
 * True for a chat that takes no new messages: a direct chat whose other person is no longer active (audit 2026-10-03, SHL-15), or
 * a group with no other active person (UX audit 2026-10-19, chats-11). The history stays readable.
 */
export function personLeft(state: State, conversation: Conversation, viewer: User): boolean {
  const others = conversation.memberIds.filter((id) => id !== viewer.id);
  if (conversation.kind === 'group') return !others.some((id) => state.users[id]?.active === true);
  if (conversation.kind !== 'direct') return false;
  return others.some((id) => state.users[id]?.active === false);
}

/** The refusal of a message or a file for a chat that is closed (personLeft). One text for chats.send and for the upload of a file. */
export function closedChatError(conversation: Conversation) {
  return forbidden(
    conversation.kind === 'group' ? 'Everyone else left this group. This chat takes no new messages.' : 'This person is inactive. This chat takes no new messages.',
    { conversationId: conversation.id, reason: 'person_left' },
  );
}

/**
 * The chat that a person may put a file into (owner, 2026-10-19): a direct chat or a group that the person may open, and that is not
 * closed. A chat that the person may not open reads as a missing chat, for a direct chat and for a group alike, and so does every
 * agent: an agent never uploads. A project chat uses the files of its project. The browser and the server both use this rule.
 */
export function chatForUpload(state: State, conversationId: string, person: User, actor: User): Conversation {
  const conversation = state.conversations[conversationId];
  if (!conversation || actor.kind === 'agent' || !canSeeConversation(state, conversation, person)) throw notFound('Conversation', conversationId);
  if (conversation.kind === 'project') throw invalid('conversationId', 'A project chat uses the files of its project. Name the project.', 'file_chat');
  if (personLeft(state, conversation, person)) throw closedChatError(conversation);
  return conversation;
}

/**
 * The "Notify me" level from a stored read mark and the kind of the chat (design item 21): the stored level, else "named" for a project
 * chat and "all" for a direct chat or a group. A loader and the push facts hold no State, so they use this. notifyLevelOf
 * (chatNaming.ts) reads the same rule from a State, and a test keeps the two equal.
 */
export function levelFromRead(read: Pick<ChatRead, 'notify'> | undefined, kind: Conversation['kind']): NotifyLevel {
  return read?.notify ?? (kind === 'project' ? 'named' : 'all');
}

/**
 * What reaches a person (owner, 2026-10-23). Only a person with the Admin role has a choice: every other person reads "mixed", whatever
 * is stored. A missing value means "mixed", which is the rule of chat design item 23. The loader and the handlers both read this one rule.
 */
export function adminReachOf(user: Pick<User, 'systemRole' | 'preferences'>): AdminReach {
  return user.systemRole === 'admin' ? (user.preferences.adminReach ?? 'mixed') : 'mixed';
}

/**
 * True when the unread count of a chat holds only the messages that name the person (chat design item 23): the project chat of a project
 * that the person neither leads nor works on the team of, for a person who did not pick All messages. Only an Admin opens a project
 * chat with the role "other" (`can`, "chat.project"), so this is the Admin's "other project chat". A task lead outside the team does not
 * count as on the project. The Admin who picked "Everything" (`reach` "all") counts every message of it. The loader
 * (server/data/loaders/chat.ts) and unreadIn use this one rule. The push does not use it: levelFromRead alone decides the push.
 */
export function countsNamedOnly(role: ProjectRole, conversation: Conversation, level: NotifyLevel, reach: AdminReach = 'mixed'): boolean {
  return conversation.kind === 'project' && role === 'other' && level !== 'all' && reach !== 'all';
}

/**
 * True when the chat leaves the list, the count and the badge of the Admin who picked "Only my work": a project chat that the Admin
 * neither leads nor works on the team of. The chat still opens (canSeeConversation does not change). The loader and the handlers
 * use this one rule.
 */
export function hiddenByReach(role: ProjectRole, conversation: Conversation, reach: AdminReach): boolean {
  return reach === 'mine' && conversation.kind === 'project' && role === 'other';
}

/** The messages of one page of a chat when the screen names no limit, and the most it may ask for (plan 4.13, A5; AM 7.5). */
export const MESSAGE_PAGE = 200;
export const MESSAGE_PAGE_MAX = 500;
/** The most task threads that chats.list shows. The Inbox keeps the newest; older threads stay on their task. */
export const TASK_THREAD_LIMIT = 100;

/**
 * The live messages of a conversation, oldest first: by stamp, then by id. The server reads them in the same order. A deleted message
 * (deletedAt set, chat design item 11) is not here, so no page, preview, count or wait reads it until an Undo.
 */
export function messagesOf(state: State, conversationId: string): Message[] {
  return Object.values(state.messages)
    .filter((m) => m.conversationId === conversationId && isLiveMessage(m))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * Live messages that other people wrote after the person last read the room. A person's own agent counts as the person.
 * A count that a server loader put in the state comes first (plan 4.13, A9); without it, a scan of the messages in the state.
 * The Admin's other project chats count only the messages that name the Admin (countsNamedOnly, design item 23), unless the Admin
 * picked "Everything".
 * A chat that the person marked unread (chats.markUnread, fbk_028) counts at least 1 until the person opens it again, in every kind
 * and also in the Admin's other project chats. The mark never adds one: a chat with 3 new messages that is marked unread still has 3.
 */
export function unreadIn(state: State, conversationId: string, userId: string): number {
  const key = chatReadKey(conversationId, userId);
  const counted = state.counts?.[unreadCountKey(conversationId, userId)];
  const read = state.chatReads[key];
  const lastRead = read?.lastReadAt ?? '';
  // The Admin's other project chats count only the messages that name the Admin, unless the Admin picked All messages (item 23).
  const chat = state.conversations[conversationId];
  const person = state.users[userId];
  const namedOnly = chat !== undefined && person !== undefined
    && countsNamedOnly(projectRoleOf(state, chat.projectId, userId), chat, levelFromRead(read, chat.kind), adminReachOf(person));
  const count = counted ?? Object.values(state.messages).filter(
    (m) => m.conversationId === conversationId && isLiveMessage(m) && m.createdAt > lastRead && principalOf(state, m.authorId) !== userId && m.actingForId !== userId
      && (!namedOnly || m.mentions.includes(userId)),
  ).length;
  return markedUnread(state, key) ? Math.max(count, 1) : count;
}

/** True when the person marked the chat or the task thread unread and has not opened it since. */
export function markedUnread(state: State, readKey: string): boolean {
  return state.chatReads[readKey]?.markedUnread === true;
}

/**
 * True when the person archived the chat and no message came after the archive (owner, 2026-10-18). A new message, from anyone,
 * brings the chat back in the view: its time is newer than the archive. "lastAt" is the time of the newest message (or of the chat).
 */
export function isArchived(read: ChatRead | undefined, lastAt: string | null): boolean {
  if (!read?.archivedAt) return false;
  return lastAt === null || lastAt <= read.archivedAt;
}

/**
 * One page of a conversation: the newest "limit" live messages that come before the message "before", oldest first.
 * "before" is a message id, not a stamp, so messages with the same stamp never fall between two pages. A "before" that is a deleted
 * message of the conversation works too (chat design item 11): the screen asks with the oldest message it shows, and that message may
 * have been deleted since. Null when "before" is not a message of this conversation.
 */
export function messagePage(state: State, conversationId: string, limit: number, before?: string): Message[] | null {
  const all = messagesOf(state, conversationId);
  if (before === undefined) return all.slice(Math.max(0, all.length - limit));
  const cut = state.messages[before];
  if (!cut || cut.conversationId !== conversationId) return null;
  // The live messages that come before the cut in the order of messagesOf: the stamp, then the id.
  const end = all.filter((m) => (m.createdAt.localeCompare(cut.createdAt) || m.id.localeCompare(cut.id)) < 0).length;
  return all.slice(Math.max(0, end - limit), end);
}
