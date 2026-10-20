import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addDirectConversation, addProjectConversation, messagePage, messagesOf, unreadIn } from '../chatState';
import type { Message } from '../contract/entities';
import { chatReadKey } from '../rowKeys';
import { NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A deleted message (base B3) leaves every read path: the page, the preview, the unread counts, the waits and the read mark. Hala
 * (usr_001) is the Admin, Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team. The stamps are older than the call.
 */
const T1 = '2026-09-30T08:01:00.000+03:00';
const T2 = '2026-09-30T08:02:00.000+03:00';
const T3 = '2026-09-30T08:03:00.000+03:00';
const FUTURE = '2027-01-01T08:00:00.000+03:00';
const SECRET = 'Secret plan 7731';

function message(id: string, conversationId: string, body: string, createdAt: string, over: Partial<Message> = {}): Message {
  return { id, conversationId, authorId: 'usr_002', actingForId: 'usr_002', body, mentions: [], createdAt, editedAt: null, ...over };
}

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP).id;
  const projectChat = addProjectConversation(state, 'prj_001', STAMP).id;
  state.messages.msg_001 = message('msg_001', direct, 'First', T1);
  state.messages.msg_002 = message('msg_002', direct, SECRET, T2, { deletedAt: T3 });
  state.messages.msg_003 = message('msg_003', projectChat, 'Sara, please check the footing.', T2, { mentions: ['usr_003'], deletedAt: T3 });
  state.counters.msg = 3;
  return { t, direct, projectChat, state };
}

describe('a deleted message leaves every read path', () => {
  it('leaves a deleted message out of the page, the preview, the unread counts and the waits', async () => {
    const { t, direct, projectChat } = world();
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: direct });
    expect(page.messages.map((v) => v.message.id)).toEqual(['msg_001']);
    const row = (await t.api.call('chats.list', {})).find((r) => r.id === direct)!;
    expect(row).toMatchObject({ preview: 'First', unread: 1, lastAt: T1 });
    const projectRow = (await t.api.call('chats.list', {})).find((r) => r.id === projectChat)!;
    expect(projectRow).toMatchObject({ preview: '', unread: 0 });
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(1);
    const waits = await t.api.call('chats.waiting', {});
    expect(waits.find((w) => w.id === direct)?.body).toBe('First');
    expect(waits.find((w) => w.id === projectChat)).toBeUndefined();
    for (const name of ['chats.messages', 'chats.list', 'chats.waiting'] as const) {
      const answer = await t.api.call(name, name === 'chats.messages' ? { conversationId: direct } : {});
      expect(JSON.stringify(answer), name).not.toContain(SECRET);
    }
  });

  it('gives no waiting row when the only message that names the person is deleted', async () => {
    const { t, projectChat } = world();
    t.as('usr_003');
    expect((await t.api.call('chats.waiting', {})).some((w) => w.id === projectChat)).toBe(false);
    // The same message live names Sara and waits.
    delete t.store.state.messages.msg_003.deletedAt;
    expect((await t.api.call('chats.waiting', {})).some((w) => w.id === projectChat)).toBe(true);
  });

  it('reads the same for the Admin and for the agent of the person, and a deleted message is never the newest', async () => {
    const { t, direct } = world();
    for (const reader of ['usr_002', 'usr_005']) {
      t.as(reader);
      const rows = await t.api.call('chats.list', {});
      expect(JSON.stringify(rows), reader).not.toContain(SECRET);
    }
    t.as('usr_002');
    expect((await t.api.call('chats.list', {})).find((r) => r.id === direct)).toMatchObject({ preview: 'First', previewMine: true });
  });

  it('marks a chat read up to its newest live message', async () => {
    const { t, direct, state } = world();
    // A deleted message stamped later than the call must not move the read mark past the call.
    state.messages.msg_004 = message('msg_004', direct, 'Gone for good', FUTURE, { deletedAt: FUTURE });
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: direct });
    expect(t.store.state.chatReads[chatReadKey(direct, 'usr_003')].lastReadAt).toBe(STAMP);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(0);
  });

  it('reads live messages only in the helpers of the chat state', () => {
    const { state, direct } = world();
    expect(messagesOf(state, direct).map((m) => m.id)).toEqual(['msg_001']);
    expect(unreadIn(state, direct, 'usr_003')).toBe(1);
    expect(messagePage(state, direct, 10)?.map((m) => m.id)).toEqual(['msg_001']);
  });

  it('brings the message back to every read path when the mark is removed (Undo)', async () => {
    const { t, direct } = world();
    delete t.store.state.messages.msg_002.deletedAt;
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: direct });
    expect(page.messages.map((v) => v.message.id)).toEqual(['msg_001', 'msg_002']);
    expect((await t.api.call('chats.list', {})).find((r) => r.id === direct)).toMatchObject({ preview: SECRET, unread: 2 });
  });
});
