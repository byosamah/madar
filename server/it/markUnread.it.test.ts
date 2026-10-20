import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCall } from '../core/runCall';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * chats.markUnread (fbk_028, owner 2026-10-23) through runCall on the local database as madar_server: the mark in the doc of the read
 * mark, the unread numbers that come from the SQL counts of the loaders (the list, the badge, the chat), the end of the mark by a read, no
 * event, and the signal to the person alone. The memory form of the same probes runs in src/api/handlers/chatsMarkUnread.test.ts,
 * server/core/chatsMarkUnreadSignal.test.ts and server/data/loaders/loaders.test.ts.
 */
describe.runIf(process.env.MADAR_IT === '1')('chats.markUnread, on the local database', () => {
  const PERSON = 'usr_001';
  let office: ItOffice;
  let deps: ReturnType<ItOffice['isolate']>;
  let room: string;
  let thread: string;
  const call = (userId: string, name: string, input: unknown) => runCall(deps, { principal: { userId }, name, input, batch: newBatch() });
  const output = async <T,>(name: string, input: unknown, userId = PERSON): Promise<T> => {
    const result = await call(userId, name, input);
    if (!result.ok) throw new Error(`${name} failed: ${result.error.message}`);
    return result.output as T;
  };
  type Row = { id: string; unread: number };
  const unreadOf = async (id: string) => (await output<Row[]>('chats.list', {})).find((row) => row.id === id)?.unread;
  const readMark = async (id: string) => (await office.sql<{ doc: Record<string, unknown> }>('select doc from chat_reads where id = $1', [`${id}:${PERSON}`]))[0]?.doc;

  beforeAll(async () => {
    office = await startOffice('unr');
    deps = office.isolate();
    room = Object.values(office.seed.conversations).find((c) => c.kind === 'project' && c.projectId === 'prj_001')!.id;
    thread = Object.values(office.seed.tasks).find((t) => t.projectId === 'prj_001' && t.status !== 'done')!.id;
    // The person writes in the thread, so the thread is the person's own. Then the person reads the room and the thread.
    await output('comments.create', { targetType: 'task', targetId: thread, body: 'A note for the thread.' });
    await output('chats.markRead', { conversationId: room });
    await output('chats.markRead', { conversationId: thread });
  }, 90_000);

  afterAll(async () => {
    await office?.close();
  });

  it('makes a read chat and a read thread unread again in the list and in the badge, from the counts of the database', async () => {
    expect(await unreadOf(room)).toBe(0);
    expect(await unreadOf(thread)).toBe(0);
    const badge = (await output<{ unread: number }>('chats.unreadCount', {})).unread;
    for (const id of [room, thread]) expect(await output('chats.markUnread', { conversationId: id })).toEqual({ unread: true });
    expect(await unreadOf(room)).toBe(1);
    expect(await unreadOf(thread)).toBe(1);
    expect((await output<{ unread: number }>('chats.unreadCount', {})).unread).toBe(badge + 2);
    expect((await output<{ chat: { unread: number } }>('chats.messages', { conversationId: room })).chat.unread).toBe(1);
    expect(await readMark(room)).toMatchObject({ conversationId: room, userId: PERSON, markedUnread: true });
  });

  it('writes no event and tells only the person, with the kind of the read marks', async () => {
    await output('chats.markRead', { conversationId: room });
    const events = await office.sql<{ n: string }>('select count(*)::text as n from events');
    const sent = deps.signal.sent.length;
    await output('chats.markUnread', { conversationId: room });
    expect(await office.sql<{ n: string }>('select count(*)::text as n from events')).toEqual(events);
    const signals = deps.signal.sent.slice(sent);
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.channel).toBe(`person:${PERSON}`);
      expect(signal.kinds).toEqual(['chatReads']);
    }
  });

  it('ends with a read mark: the number goes and the mark leaves the doc, for a chat and for a thread', async () => {
    for (const id of [room, thread]) {
      await output('chats.markUnread', { conversationId: id });
      await output('chats.markRead', { conversationId: id });
      expect(await unreadOf(id)).toBe(0);
      expect(await readMark(id)).not.toHaveProperty('markedUnread');
    }
  });

  it('is private: another member of the chat keeps the number of their own', async () => {
    const other = Object.values(office.seed.members).find((m) => m.projectId === 'prj_001' && m.userId !== PERSON && office.seed.users[m.userId].kind === 'human')!.userId;
    await output('chats.markRead', { conversationId: room }, other);
    expect((await output<Row[]>('chats.list', {}, other)).find((row) => row.id === room)?.unread).toBe(0);
    await output('chats.markUnread', { conversationId: room });
    expect((await output<Row[]>('chats.list', {}, other)).find((row) => row.id === room)?.unread).toBe(0);
    expect(await unreadOf(room)).toBe(1);
    await output('chats.markRead', { conversationId: room });
  });

  it('answers a chat that does not exist as chats.markRead does', async () => {
    const read = await call(PERSON, 'chats.markRead', { conversationId: 'cnv_999' });
    const marked = await call(PERSON, 'chats.markUnread', { conversationId: 'cnv_999' });
    expect(read.ok).toBe(false);
    expect(marked.ok).toBe(false);
    if (!read.ok && !marked.ok) expect(marked.error.code).toBe(read.error.code);
  });
});
