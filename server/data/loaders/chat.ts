import type { ChatRead, Comment, Conversation, Message } from '../../../src/api/contract/entities';
import { canSeeConversation, TASK_THREAD_LIMIT } from '../../../src/api/chatState';
import { can } from '../../../src/api/permissions';
import { chatReadKey, unreadCountKey } from '../../../src/api/store';
import type { Load } from './build';
import type { Bound } from './query';
import { namedFiles, newestMessages, officeState } from './steps';

/**
 * The chat loader (plan 4.6): the chats and the task threads of the person U.
 *
 * For each chat U may open: the read mark of U, the newest message (preview), and the unread number as one grouped count in the
 * database (plan 4.13, A9): the messages after the mark that U, U's agents and nobody acting for U wrote. The unread rows stay in
 * the database, so a chat with a long history and no mark reads one message, not its history.
 * For the task threads (chats.ts, taskThreads): the source finds the newest TASK_THREAD_LIMIT threads that U is part of, and the
 * loader brings each thread's task, its newest comment and U's newest own comment, and counts the comments by other people after
 * both U's mark and U's own last comment. These are what the preview, the order and the unread count read (AM 6, row 15).
 */

type Input = Record<string, unknown>;

/** U and U's agents: a message or comment by one of them is U's own (principalOf). */
function meOf(L: Load, userId: string): string[] {
  return [userId, ...Object.values(L.office.users).filter((user) => user.kind === 'agent' && user.ownerId === userId).map((user) => user.id)];
}

const markOf = (L: Load, id: string, userId: string) => L.get<ChatRead>('chatReads', chatReadKey(id, userId))?.lastReadAt ?? '';

/** The read marks, newest message and unread count of these chats. */
async function chatsOf(L: Load, userId: string, conversations: readonly Conversation[]): Promise<void> {
  const ids = conversations.map((c) => c.id);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, userId)));
  await newestMessages(L, ids);
  const by = Object.fromEntries(ids.map((id): [string, Bound] => [id, { gt: markOf(L, id, userId) }]));
  await L.countWhere({
    c: 'messages', per: 'conversation_id',
    where: [{ bounds: { col: 'conversation_id', by } }, { field: 'authorId', notIn: meOf(L, userId) }, { field: 'actingForId', notIn: [userId] }],
  }, ids, (id) => unreadCountKey(id, userId));
}

/** The task threads of U, with the comments that their preview and order read, and their unread counts. */
async function threadsOf(L: Load, userId: string): Promise<void> {
  if (!L.authority || !can(L.authority, 'comment.read')) return;
  const me = meOf(L, userId);
  const led = Object.values(L.office.projects).filter((project) => project.leaderId === userId).map((project) => project.id);
  const threads = await L.src.threads({ owner: userId, led, me, limit: TASK_THREAD_LIMIT });
  if (threads.length === 0) return;
  const ids = threads.map((thread) => thread.id);
  await L.byKey('tasks', ids);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, userId)));
  const newest = { order: { col: 'created_at', desc: true, id: true } as const, per: 'target_id', limit: 1 };
  const onThreads = [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ids }] as const;
  await L.select({ c: 'comments', where: onThreads, ...newest });
  const own = (await L.select({ c: 'comments', where: [...onThreads, { field: 'authorId', in: me }], ...newest })) as Comment[];
  // The unread comments come after U's own last comment in the order of the thread (stamp, then id), as taskUnread reads them.
  const lastOwn = new Map(own.map((comment) => [comment.targetId, { at: comment.createdAt, id: comment.id }]));
  const by = Object.fromEntries(ids.map((id): [string, Bound] => {
    const after = lastOwn.get(id);
    return [id, { gt: markOf(L, id, userId), ...(after ? { after } : {}) }];
  }));
  await L.countWhere({
    c: 'comments', per: 'target_id',
    where: [{ col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by } }, { field: 'authorId', notIn: me }],
  }, ids, (id) => unreadCountKey(id, userId));
}

/** The chats U may open, from the office. */
function visible(L: Load): Conversation[] {
  const office = officeState(L);
  return L.authority ? Object.values(L.office.conversations).filter((c) => canSeeConversation(office, c, L.authority!)) : [];
}

/** chats.list and chats.unreadCount: every chat and task thread of U. */
export async function chatsAll(L: Load): Promise<void> {
  if (!L.authority) return;
  await chatsOf(L, L.authority.id, visible(L));
  await threadsOf(L, L.authority.id);
}

/** chats.markRead: as chats.list (it returns the full unread count), and the newest comment of a task thread it marks. */
export async function chatsMarkRead(L: Load, input: Input): Promise<void> {
  await chatsAll(L);
  const id = typeof input.conversationId === 'string' ? input.conversationId : '';
  if (!id.startsWith('tsk_') || !L.authority) return;
  await L.byKey('tasks', [id]);
  await L.byKey('chatReads', [chatReadKey(id, L.authority.id)]);
  await L.select({
    c: 'comments', where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: [id] }],
    order: { col: 'created_at', desc: true }, limit: 1, ties: true,
  });
}

/**
 * chats.messages: one chat. Its mark, newest message and unread count (the chat row), and one page: the newest "limit" messages
 * before the message "before", which comes too. The page is one unbroken run that ends at "before" (or at the newest message), so
 * the page that the handler cuts is the page of the whole chat.
 */
export async function chatsMessages(L: Load, input: Input): Promise<void> {
  const id = typeof input.conversationId === 'string' ? input.conversationId : '';
  const conversation = L.office.conversations[id];
  if (!L.authority || !conversation) return;
  await chatsOf(L, L.authority.id, [conversation]);
  const limit = (input.limit as number | undefined) ?? 200;
  let before: Message | undefined;
  if (typeof input.before === 'string') {
    await L.byKey('messages', [input.before]);
    before = L.get<Message>('messages', input.before);
    if (!before || before.conversationId !== id) return;
  }
  const page = (await L.select({
    c: 'messages',
    where: [{ col: 'conversation_id', in: [id] }, ...(before ? [{ before: { at: before.createdAt, id: before.id } }] : [])],
    order: { col: 'created_at', desc: true, id: true }, limit,
  })) as Message[];
  // The page and the newest message: the files that the message views name.
  await namedFiles(L, [...page, ...L.list<Message>('messages').filter((m) => m.conversationId === id)]);
}

