import type { ChatRead, Conversation, Message } from '../../../src/api/contract/entities';
import { canSeeConversation, TASK_THREAD_LIMIT } from '../../../src/api/chatState';
import { can } from '../../../src/api/permissions';
import { chatReadKey } from '../../../src/api/store';
import type { Load } from './build';
import { namedFiles, newestMessages, officeState } from './steps';

/**
 * The chat loader (plan 4.6): the chats and the task threads of the person U.
 *
 * For each chat U may open: the read mark of U, the newest message (preview) and every message after the mark (the unread count).
 * For the task threads (chats.ts, taskThreads): the source finds the newest TASK_THREAD_LIMIT threads that U is part of, and the
 * loader brings each thread's task, its newest comment, U's newest own comment, and every comment after both U's mark and U's
 * own last comment. These are exactly the comments that the preview and the unread count read (AM 6, row 15).
 */

type Input = Record<string, unknown>;

/** The read marks, newest message and unread messages of these chats. */
async function chatsOf(L: Load, userId: string, conversations: readonly Conversation[]): Promise<void> {
  const ids = conversations.map((c) => c.id);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, userId)));
  await newestMessages(L, ids);
  const by = Object.fromEntries(ids.map((id) => [id, { gt: L.get<ChatRead>('chatReads', chatReadKey(id, userId))?.lastReadAt ?? '' }]));
  await L.select({ c: 'messages', where: [{ bounds: { col: 'conversation_id', by } }] });
}

/** The task threads of U, with the comments that their preview and unread count read. */
async function threadsOf(L: Load, userId: string): Promise<void> {
  if (!L.authority || !can(L.authority, 'comment.read')) return;
  const users = Object.values(L.office.users);
  const me = [userId, ...users.filter((user) => user.kind === 'agent' && user.ownerId === userId).map((user) => user.id)];
  const led = Object.values(L.office.projects).filter((project) => project.leaderId === userId).map((project) => project.id);
  const threads = await L.src.threads({ owner: userId, led, me, limit: TASK_THREAD_LIMIT });
  if (threads.length === 0) return;
  const ids = threads.map((thread) => thread.id);
  await L.byKey('tasks', ids);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, userId)));
  const newest = { order: { col: 'created_at', desc: true, id: true } as const, per: 'target_id', limit: 1 };
  const onThreads = [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ids }] as const;
  await L.select({ c: 'comments', where: onThreads, ...newest });
  await L.select({ c: 'comments', where: [...onThreads, { field: 'authorId', in: me }], ...newest });
  const by = Object.fromEntries(threads.map((thread) => [thread.id, {
    gt: L.get<ChatRead>('chatReads', chatReadKey(thread.id, userId))?.lastReadAt ?? '', ...(thread.mine ? { ge: thread.mine } : {}),
  }]));
  await L.select({ c: 'comments', where: [{ col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by } }] });
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
 * chats.messages: one chat. Its mark, newest message and unread messages (the chat row), and one page: the newest "limit" messages
 * before the message "before", which comes too. The loaded messages of the chat are one unbroken run up to the newest, so the page
 * that the handler cuts is the page of the whole chat.
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
  // Without "before", the page is the newest messages, and the unread ones may reach further back: the run is the whole tail.
  await namedFiles(L, [...page, ...L.list<Message>('messages').filter((m) => m.conversationId === id)]);
}

