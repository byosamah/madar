import type { ChatRead, Comment, Conversation, Message, Task } from '../../../src/api/contract/entities';
import { canSeeConversation, TASK_THREAD_LIMIT } from '../../../src/api/chatState';
import { can } from '../../../src/api/permissions';
import { chatReadKey, unreadCountKey } from '../../../src/api/store';
import type { Load } from './build';
import type { Bound } from './query';
import { attachedFiles, LIVE, newestMessages, officeState, pickedByKey } from './steps';

/**
 * The chat loader (plan 4.6): the chats and the task threads of the person U.
 *
 * For each chat U may open: the read mark of U, the newest message (preview), and the unread number as one grouped count in the
 * database (plan 4.13, A9): the messages after the mark that U, U's agents and nobody acting for U wrote. The unread rows stay in
 * the database, so a chat with a long history and no mark reads one message, not its history.
 * For the task threads (chats.ts, taskThreads): the source finds the newest TASK_THREAD_LIMIT threads that U is part of, and the
 * loader brings each thread's task, its newest comment and U's newest own comment, and counts the comments by other people after
 * both U's mark and U's own last comment. These are what the preview, the order and the unread count read (AM 6, row 15).
 * The badge (chats.unreadCount) reads only the numbers: no newest message, and only the fields of its rules from the thread
 * tasks and comments (performance audit DB-6, DB-M1).
 */

type Input = Record<string, unknown>;

/**
 * The task fields of a thread that the badge reads (chats.unreadCount, performance audit DB-M1): taskThreads (chats.ts) reads the
 * id, the project, the lead and the maker, and the view rule of an office task (mayViewTask, taskResource) reads the helpers too.
 */
export const THREAD_TASK_FIELDS = ['id', 'projectId', 'ownerId', 'helperIds', 'createdBy'] as const;
/** The comment fields of a thread that the badge reads: taskThreads groups, sorts and finds the own comments with these. */
export const THREAD_COMMENT_FIELDS = ['id', 'targetType', 'targetId', 'createdAt', 'authorId'] as const;

/**
 * The conditions that keep the quiet lines of reasons out of a read of comments (fbk_027, owner 2026-10-19): a line has `dates` (a date
 * move, or a Madar shift) or `kind` (a reopening). The handlers read only the messages of a thread for the unread count and for the
 * reply that waits (taskUnread, waitingThread), so the loader counts and loads the same.
 */
const MESSAGES_ONLY = [{ field: 'dates', null: true }, { field: 'kind', null: true }] as const;

/** U and U's agents: a message or comment by one of them is U's own (principalOf). */
function meOf(L: Load, userId: string): string[] {
  return [userId, ...Object.values(L.office.users).filter((user) => user.kind === 'agent' && user.ownerId === userId).map((user) => user.id)];
}

const markOf = (L: Load, id: string, userId: string) => L.get<ChatRead>('chatReads', chatReadKey(id, userId))?.lastReadAt ?? '';

/** Only chats.markRead counts in a write: its handler keeps the count true (Load.countWhere). */
type Kept = { inWrite?: true };
/** badge: the read of chats.unreadCount, which needs the numbers only. */
type Mode = Kept & { badge?: true };

/** The read marks, newest message and unread count of these chats. */
async function chatsOf(L: Load, userId: string, conversations: readonly Conversation[], mode: Mode = {}): Promise<void> {
  const ids = conversations.map((c) => c.id);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, userId)));
  // unreadIn (chatState.ts) takes the count first, so the badge never reads the newest message.
  if (!mode.badge) await newestMessages(L, ids);
  const by = Object.fromEntries(ids.map((id): [string, Bound] => [id, { gt: markOf(L, id, userId) }]));
  await L.countWhere({
    c: 'messages', per: 'conversation_id',
    where: [{ bounds: { col: 'conversation_id', by } }, LIVE, { field: 'authorId', notIn: meOf(L, userId) }, { field: 'actingForId', notIn: [userId] }],
  }, ids, (id) => unreadCountKey(id, userId), mode);
}

/** The task threads of U, with the comments that their preview and order read, and their unread counts. */
async function threadsOf(L: Load, userId: string, mode: Mode): Promise<void> {
  if (!L.authority || !can(L.authority, 'comment.read')) return;
  const me = meOf(L, userId);
  const led = Object.values(L.office.projects).filter((project) => project.leaderId === userId).map((project) => project.id);
  // The Admin sees every office task, so an office thread the Admin commented on is the Admin's too (owner, 2026-10-06).
  const threads = await L.src.threads({ owner: userId, led, me, limit: TASK_THREAD_LIMIT, admin: can(L.authority, 'task.view', { office: true }) });
  if (threads.length === 0) return;
  const ids = threads.map((thread) => thread.id);
  if (mode.badge) await pickedByKey(L, 'tasks', ids, THREAD_TASK_FIELDS);
  else await L.byKey('tasks', ids);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, userId)));
  const newest = { order: { col: 'created_at', desc: true, id: true } as const, per: 'target_id', limit: 1, ...(mode.badge ? { pick: THREAD_COMMENT_FIELDS } : {}) };
  const onThreads = [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ids }] as const;
  await L.select({ c: 'comments', where: onThreads, ...newest });
  // U's newest comment of any kind: a person who only wrote a line of a reason is part of the thread (taskThreads).
  await L.select({ c: 'comments', where: [...onThreads, { field: 'authorId', in: me }], ...newest });
  // The unread comments come after U's own last message in the order of the thread (stamp, then id), as taskUnread reads them.
  // A line that U wrote is no reply, so the bound is the newest message of U (fbk_027).
  const own = (await L.select({ c: 'comments', where: [...onThreads, { field: 'authorId', in: me }, ...MESSAGES_ONLY], ...newest })) as Comment[];
  const lastOwn = new Map(own.map((comment) => [comment.targetId, { at: comment.createdAt, id: comment.id }]));
  const by = Object.fromEntries(ids.map((id): [string, Bound] => {
    const after = lastOwn.get(id);
    return [id, { gt: markOf(L, id, userId), ...(after ? { after } : {}) }];
  }));
  await L.countWhere({
    c: 'comments', per: 'target_id',
    where: [{ col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by } }, { field: 'authorId', notIn: me }, ...MESSAGES_ONLY],
  }, ids, (id) => unreadCountKey(id, userId), mode);
}

/** The chats U may open, from the office. */
function visible(L: Load): Conversation[] {
  const office = officeState(L);
  return L.authority ? Object.values(L.office.conversations).filter((c) => canSeeConversation(office, c, L.authority!)) : [];
}

/** Every chat and task thread of U. */
async function everyChat(L: Load, mode: Mode): Promise<void> {
  if (!L.authority) return;
  await chatsOf(L, L.authority.id, visible(L), mode);
  await threadsOf(L, L.authority.id, mode);
}

/** chats.list: every chat and task thread of U, with the previews. */
export async function chatsAll(L: Load): Promise<void> {
  await everyChat(L, {});
}

/** chats.unreadCount: the numbers of every chat and task thread of U, with no preview (performance audit DB-6). */
export async function chatsUnread(L: Load): Promise<void> {
  await everyChat(L, { badge: true });
}

/**
 * chats.archive: the chat (its office record, already loaded) or the task of a thread, and the own read mark, which the write keeps.
 * It reads no message and no comment: the archive mark needs neither (owner, 2026-10-18).
 */
export async function chatsArchive(L: Load, input: Input): Promise<void> {
  const id = typeof input.conversationId === 'string' ? input.conversationId : '';
  if (!L.authority || id === '') return;
  if (id.startsWith('tsk_')) await L.byKey('tasks', [id]);
  await L.byKey('chatReads', [chatReadKey(id, L.authority.id)]);
}

/** chats.markRead: as chats.list (it returns the full unread count), and the newest comment of a task thread it marks. */
export async function chatsMarkRead(L: Load, input: Input): Promise<void> {
  await everyChat(L, { inWrite: true });
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
    where: [{ col: 'conversation_id', in: [id] }, LIVE, ...(before ? [{ before: { at: before.createdAt, id: before.id } }] : [])],
    order: { col: 'created_at', desc: true, id: true }, limit,
  })) as Message[];
  // The old message of each reply on the page, by key: it may be older than the page. replyRefOf shows it only when it is live and in
  // this chat, and a deleted or foreign one reads as deleted, so no extra rule is needed here.
  await L.byKey('messages', page.map((message) => message.replyToId));
  // The page and the newest message: the files that the message views name, and the office task of each office file. A message view
  // shows a file row only when the viewer may view the file (messageViewOf), and that rule reads the task of an office file.
  const shown = [...page, ...L.list<Message>('messages').filter((m) => m.conversationId === id)];
  await attachedFiles(L, shown.flatMap((message) => message.fileIds ?? []));
}

/**
 * chats.waiting (fbk_011, owner 2026-10-18): the rows that waitingFor (chats.ts) compares. Per visible chat: the archive mark and
 * the newest message (the direct and group rule). Per project chat: the newest message of the person, with its agents, and the
 * newest message that names the person. Per task thread: see threadsWaitingOf.
 */
export async function chatsWaiting(L: Load): Promise<void> {
  if (!L.authority) return;
  const me = L.authority.id;
  const meSet = meOf(L, me);
  const conversations = visible(L);
  const ids = conversations.map((c) => c.id);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, me)));
  await newestMessages(L, ids);
  const projectIds = conversations.filter((c) => c.kind === 'project').map((c) => c.id);
  if (projectIds.length > 0) {
    const newest = { order: { col: 'created_at', desc: true, id: true } as const, per: 'conversation_id', limit: 1 };
    await L.select({ c: 'messages', where: [{ col: 'conversation_id', in: projectIds }, LIVE, { or: [{ field: 'actingForId', in: [me] }, { field: 'authorId', in: meSet }] }], ...newest });
    await L.select({ c: 'messages', where: [{ col: 'conversation_id', in: projectIds }, LIVE, { has: 'mentions', value: me }], ...newest });
  }
  await threadsWaitingOf(L, me, meSet);
}

/**
 * The task threads of the person for chats.waiting: the task (its lead), the newest comment, and the newest comment of the person.
 * A thread that the person does not lead also gets the comments of other people after the person's last comment.
 * Comments keep no mention list, so the body names the person (mentionedUserIds). A thread the person leads needs
 * only its newest comment.
 */
async function threadsWaitingOf(L: Load, me: string, meSet: string[]): Promise<void> {
  if (!L.authority || !can(L.authority, 'comment.read')) return;
  const led = Object.values(L.office.projects).filter((project) => project.leaderId === me).map((project) => project.id);
  // The Admin sees every office task, so an office thread the Admin commented on is the Admin's too (owner, 2026-10-06).
  const threads = await L.src.threads({ owner: me, led, me: meSet, limit: TASK_THREAD_LIMIT, admin: can(L.authority, 'task.view', { office: true }) });
  if (threads.length === 0) return;
  const ids = threads.map((thread) => thread.id);
  await L.byKey('tasks', ids);
  await L.byKey('chatReads', ids.map((id) => chatReadKey(id, me)));
  const newest = { order: { col: 'created_at', desc: true, id: true } as const, per: 'target_id', limit: 1 };
  const onThreads = [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ids }] as const;
  // The newest comment and U's newest comment of any kind give the thread its place and its people (taskThreads). The reply that waits
  // reads the messages only (waitingThread), so the newest message, U's newest message and the messages after it come as well (fbk_027).
  await L.select({ c: 'comments', where: onThreads, ...newest });
  await L.select({ c: 'comments', where: [...onThreads, { field: 'authorId', in: meSet }], ...newest });
  await L.select({ c: 'comments', where: [...onThreads, ...MESSAGES_ONLY], ...newest });
  const own = (await L.select({ c: 'comments', where: [...onThreads, { field: 'authorId', in: meSet }, ...MESSAGES_ONLY], ...newest })) as Comment[];
  const named = ids.filter((id) => L.get<Task>('tasks', id)?.ownerId !== me);
  if (named.length === 0) return;
  const lastOwn = new Map(own.map((comment) => [comment.targetId, { at: comment.createdAt, id: comment.id }]));
  const by = Object.fromEntries(named.map((id): [string, Bound] => {
    const after = lastOwn.get(id);
    return [id, { gt: '', ...(after ? { after } : {}) }];
  }));
  await L.select({ c: 'comments', where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: named }, { bounds: { col: 'target_id', by } }, { field: 'authorId', notIn: meSet }, ...MESSAGES_ONLY] });
}

