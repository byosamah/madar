import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import { chatReadKey } from '../store';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...projectCalls };

/**
 * chats.markUnread (fbk_028, owner 2026-10-23): the person marks a chat that they read as unread again. It shows as unread (the row,
 * the Inbox badge) until the person opens it again. It replaces the line "Waits for your reply". It is a private mark of the person, like
 * the read mark: no event, no notice, no push. Hala is the Admin, Faisal leads the project, Sara (usr_003) is on the team, Omar (usr_004)
 * is outside.
 */
function world() {
  const t = testApi(calls);
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Madar Second', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' });
  return { ...t, room: room.id };
}

const rowOf = async (t: ReturnType<typeof world>, id: string) => (await t.api.call('chats.list', {})).find((row) => row.id === id);
const codeOf = (promise: Promise<unknown>) => promise.then(() => 'ok', (error: { code: string }) => error.code);

/** Hala writes in the room, then Sara reads it: Sara has a chat with nothing unread. */
async function readByUser(t: ReturnType<typeof world>, id = t.room) {
  t.as('usr_001');
  await t.api.call('chats.send', { conversationId: id, body: 'Please check the riser.' });
  t.as('usr_003');
  await t.api.call('chats.markRead', { conversationId: id });
  expect((await rowOf(t, id))?.unread).toBe(0);
}

describe('chats.markUnread', () => {
  it('makes a chat that the person read unread again: its row and the Inbox badge count it', async () => {
    const t = world();
    await readByUser(t);
    expect(await t.api.call('chats.markUnread', { conversationId: t.room })).toEqual({ unread: true });
    expect((await rowOf(t, t.room))?.unread).toBe(1);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    expect((await t.api.call('chats.messages', { conversationId: t.room })).chat.unread).toBe(1);
  });

  it('is gone when the person opens the chat again: chats.markRead clears the mark and the number', async () => {
    const t = world();
    await readByUser(t);
    await t.api.call('chats.markUnread', { conversationId: t.room });
    expect(await t.api.call('chats.markRead', { conversationId: t.room })).toEqual({ unread: 0 });
    expect((await rowOf(t, t.room))?.unread).toBe(0);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
    expect(t.store.state.chatReads[chatReadKey(t.room, 'usr_003')]?.markedUnread).toBeUndefined();
  });

  it('is gone when the person writes in the chat', async () => {
    const t = world();
    await readByUser(t);
    await t.api.call('chats.markUnread', { conversationId: t.room });
    setNow(new Date(NOW.getTime() + 60_000));
    await t.api.call('chats.send', { conversationId: t.room, body: 'I will check it.' });
    expect((await rowOf(t, t.room))?.unread).toBe(0);
  });

  it('adds nothing to a chat that has unread messages: the number stays the number of messages', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: t.room, body: 'One.' });
    setNow(new Date(NOW.getTime() + 1_000));
    await t.api.call('chats.send', { conversationId: t.room, body: 'Two.' });
    t.as('usr_003');
    expect((await rowOf(t, t.room))?.unread).toBe(2);
    await t.api.call('chats.markUnread', { conversationId: t.room });
    expect((await rowOf(t, t.room))?.unread).toBe(2);
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect((await rowOf(t, t.room))?.unread).toBe(0);
  });

  it('keeps the mark when a new message comes: the number is the new messages, and the mark never adds one more', async () => {
    const t = world();
    await readByUser(t);
    await t.api.call('chats.markUnread', { conversationId: t.room });
    setNow(new Date(NOW.getTime() + 60_000));
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Any news?' });
    t.as('usr_003');
    expect((await rowOf(t, t.room))?.unread).toBe(1);
  });

  it('is private to the person: the other members of the chat keep their numbers', async () => {
    const t = world();
    await readByUser(t);
    t.as('usr_002');
    await t.api.call('chats.markRead', { conversationId: t.room });
    t.as('usr_003');
    await t.api.call('chats.markUnread', { conversationId: t.room });
    t.as('usr_002');
    expect((await rowOf(t, t.room))?.unread).toBe(0);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
  });

  it('works for a chat with nothing in it, and for a chat the person never opened', async () => {
    const t = world();
    t.as('usr_003');
    expect(t.store.state.chatReads[chatReadKey(t.room, 'usr_003')]).toBeUndefined();
    await t.api.call('chats.markUnread', { conversationId: t.room });
    expect((await rowOf(t, t.room))?.unread).toBe(1);
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect((await rowOf(t, t.room))?.unread).toBe(0);
  });

  it('works for a direct chat and for a group, also when the person wrote the last message', async () => {
    const t = world();
    const direct = addDirectConversation(t.store.state, 'usr_001', 'usr_003', STAMP).id;
    const group = addGroupConversation(t.store.state, 'Tower team', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], STAMP).id;
    t.as('usr_003');
    for (const id of [direct, group]) {
      await t.api.call('chats.send', { conversationId: id, body: 'My answer.' });
      expect((await rowOf(t, id))?.unread).toBe(0);
      await t.api.call('chats.markUnread', { conversationId: id });
      expect((await rowOf(t, id))?.unread).toBe(1);
    }
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(2);
    await t.api.call('chats.markRead', { conversationId: group });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
  });

  it('works for a task thread, also when the person wrote the last comment, and the thread read clears it', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please send the plan.' });
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Done, it is in the files.' });
    expect((await rowOf(t, 'tsk_001'))?.unread).toBe(0);
    await t.api.call('chats.markUnread', { conversationId: 'tsk_001' });
    expect((await rowOf(t, 'tsk_001'))?.unread).toBe(1);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    expect((await rowOf(t, 'tsk_001'))?.unread).toBe(0);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
  });

  it('brings an archived chat back to the Inbox, so the badge never counts a chat that is out of the list', async () => {
    const t = world();
    await readByUser(t);
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    expect((await rowOf(t, t.room))?.archived).toBe(true);
    await t.api.call('chats.markUnread', { conversationId: t.room });
    const row = await rowOf(t, t.room);
    expect(row).toMatchObject({ archived: false, unread: 1 });
  });

  it('writes no event and no notice, and sends no message', async () => {
    const t = world();
    await readByUser(t);
    const events = Object.keys(t.store.state.events).length;
    const notices = Object.keys(t.store.state.notifications).length;
    const messages = Object.keys(t.store.state.messages).length;
    await t.api.call('chats.markUnread', { conversationId: t.room });
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
    expect(Object.keys(t.store.state.notifications)).toHaveLength(notices);
    expect(Object.keys(t.store.state.messages)).toHaveLength(messages);
  });

  it('is harmless when called twice', async () => {
    const t = world();
    await readByUser(t);
    await t.api.call('chats.markUnread', { conversationId: t.room });
    await t.api.call('chats.markUnread', { conversationId: t.room });
    expect((await rowOf(t, t.room))?.unread).toBe(1);
  });

  it('answers a chat the person cannot open as chats.markRead does, and writes nothing', async () => {
    const t = world();
    const group = addGroupConversation(t.store.state, 'Private', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], STAMP).id;
    t.as('usr_004');
    for (const id of [t.room, group, 'cnv_999']) {
      const marked = await codeOf(t.api.call('chats.markRead', { conversationId: id }));
      expect(await codeOf(t.api.call('chats.markUnread', { conversationId: id })), id).toBe(marked);
      expect(t.store.state.chatReads[chatReadKey(id, 'usr_004')], id).toBeUndefined();
    }
    // Since chat design item 17, a chat that the person may not open answers not_found for every kind, as a group did.
    expect(await codeOf(t.api.call('chats.markUnread', { conversationId: t.room }))).toBe('not_found');
    expect(await codeOf(t.api.call('chats.markUnread', { conversationId: group }))).toBe('not_found');
  });

  it('answers an office task the person cannot see as a missing task', async () => {
    const t = world();
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', projectId: null, stageId: null, ownerId: 'usr_003', createdBy: 'usr_003' });
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'Office note.' });
    expect(await codeOf(t.api.call('chats.markUnread', { conversationId: 'tsk_002' }))).toBe('ok');
    t.as('usr_004');
    expect(await codeOf(t.api.call('chats.markUnread', { conversationId: 'tsk_002' }))).toBe('not_found');
    expect(t.store.state.chatReads[chatReadKey('tsk_002', 'usr_004')]).toBeUndefined();
  });
});
