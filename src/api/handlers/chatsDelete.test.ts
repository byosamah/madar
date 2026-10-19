import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addDirectConversation, addGroupConversation, addProjectConversation, messagePage, messagesOf } from '../chatState';
import type { Message, Notification } from '../contract/entities';
import { NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The author deletes a chat message for everyone, and Undo brings it back (design item 11, base B9). Faisal (usr_002) leads prj_001, Sara
 * (usr_003) is on its team, Omar (usr_004) is outside, usr_005 is the agent of Sara, Hala (usr_001) is the Admin.
 */
const T1 = '2026-09-30T08:10:00.000+03:00';
const SECRET = 'Secret plan 7731';
const OFFER = 'Offer 5528';
const GROUP_SECRET_ID = 'msg_901';
const DIRECT_SECRET_ID = 'msg_902';
const PROJECT_SECRET_ID = 'msg_903';

function message(id: string, conversationId: string, over: Partial<Message>): Message {
  return { id, conversationId, authorId: 'usr_002', actingForId: 'usr_002', body: 'Hello', mentions: [], createdAt: T1, editedAt: null, ...over };
}

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  const direct = addDirectConversation(state, 'usr_002', 'usr_003', STAMP).id;
  const projectChat = addProjectConversation(state, 'prj_001', STAMP).id;
  const group = addGroupConversation(state, 'Secret group', 'usr_001', ['usr_001', 'usr_002', 'usr_003'], STAMP).id;
  state.messages[GROUP_SECRET_ID] = message(GROUP_SECRET_ID, group, { body: `${SECRET} in the group` });
  state.messages[DIRECT_SECRET_ID] = message(DIRECT_SECRET_ID, direct, { body: `${SECRET} in the direct chat` });
  state.messages[PROJECT_SECRET_ID] = message(PROJECT_SECRET_ID, projectChat, { body: `${SECRET} in the project chat` });
  state.counters.msg = 903;
  return { t, state, direct, projectChat, group };
}

const noticesOf = (state: { notifications: Record<string, Notification> }, userId: string) => Object.values(state.notifications).filter((n) => n.userId === userId);
const failureOf = (promise: Promise<unknown>) => promise.then(() => null, (error: { code: string; message: string; details?: { reason?: string } }) => error);

describe('chats.deleteMessage', () => {
  it('deletes an own message for everyone, with its notices, and leaves no text on any read path', async () => {
    const { t, state, direct } = world();
    t.as('usr_002');
    const { message: sent } = await t.api.call('chats.send', { conversationId: direct, body: `@[Sara Team](usr_003) ${OFFER}` });
    expect(noticesOf(state, 'usr_003')).toHaveLength(1);
    t.as('usr_003');
    const unreadBefore = (await t.api.call('chats.unreadCount', {})).unread;
    expect((await t.api.call('notifications.count', {})).unread).toBe(1);
    t.as('usr_002');
    expect(await t.api.call('chats.deleteMessage', { id: sent.id })).toEqual({ deleted: true });
    expect(noticesOf(state, 'usr_003')).toEqual([]);
    expect(state.messages[sent.id].deletedAt).toEqual(expect.any(String));
    t.as('usr_003');
    for (const [name, input] of [['chats.messages', { conversationId: direct }], ['chats.list', {}], ['chats.waiting', {}], ['notifications.list', {}]] as const) {
      expect(JSON.stringify(await t.api.call(name, input)), name).not.toContain(OFFER);
    }
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(unreadBefore - 1);
    expect((await t.api.call('notifications.count', {})).unread).toBe(0);
  });

  it('shows a reply to a deleted message as deleted, with no text of the old message', async () => {
    const { t, direct } = world();
    t.as('usr_003');
    const { message: reply } = await t.api.call('chats.send', { conversationId: direct, body: 'Approved.', replyToId: DIRECT_SECRET_ID });
    t.as('usr_002');
    await t.api.call('chats.deleteMessage', { id: DIRECT_SECRET_ID });
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: direct });
    const shown = page.messages.find((view) => view.message.id === reply.id)!;
    expect(shown.replyTo).toMatchObject({ id: DIRECT_SECRET_ID, deleted: true, firstLine: '' });
    expect(JSON.stringify(page)).not.toContain(SECRET);
  });

  it('brings the message back with Undo, and its notices come back read', async () => {
    const { t, state, direct } = world();
    t.as('usr_002');
    const { message: sent } = await t.api.call('chats.send', { conversationId: direct, body: '@[Sara Team](usr_003) look at this' });
    await t.api.call('chats.deleteMessage', { id: sent.id });
    expect(await t.api.call('chats.deleteMessage', { id: sent.id, deleted: false })).toEqual({ deleted: false });
    expect('deletedAt' in state.messages[sent.id]).toBe(false);
    expect(messagesOf(state, direct).map((m) => m.id)).toContain(sent.id);
    expect(noticesOf(state, 'usr_003')).toEqual([expect.objectContaining({ trigger: 'mention', messageId: sent.id, read: true })]);
    t.as('usr_003');
    expect((await t.api.call('notifications.count', {})).unread).toBe(0);
  });

  it('brings back the reply notice of a reply author who was not named in the text', async () => {
    const { t, state, direct } = world();
    t.as('usr_003');
    const { message: reply } = await t.api.call('chats.send', { conversationId: direct, body: 'Approved.', replyToId: DIRECT_SECRET_ID });
    expect(noticesOf(state, 'usr_002')).toEqual([expect.objectContaining({ messageId: reply.id, reply: true })]);
    await t.api.call('chats.deleteMessage', { id: reply.id });
    expect(noticesOf(state, 'usr_002')).toEqual([]);
    await t.api.call('chats.deleteMessage', { id: reply.id, deleted: false });
    expect(noticesOf(state, 'usr_002')).toEqual([expect.objectContaining({ messageId: reply.id, reply: true, read: true })]);
  });

  it('changes nothing for the same value', async () => {
    const { t, state, direct } = world();
    t.as('usr_002');
    const { message: sent } = await t.api.call('chats.send', { conversationId: direct, body: 'Once' });
    await t.api.call('chats.deleteMessage', { id: sent.id });
    const first = state.messages[sent.id].deletedAt;
    setNow(new Date(NOW.getTime() + 3_600_000));
    expect(await t.api.call('chats.deleteMessage', { id: sent.id })).toEqual({ deleted: true });
    expect(state.messages[sent.id].deletedAt).toBe(first);
    // A restore of a live message changes nothing either, and writes no notice.
    const live = structuredClone(state.messages[DIRECT_SECRET_ID]);
    const noticesBefore = Object.keys(state.notifications).length;
    expect(await t.api.call('chats.deleteMessage', { id: DIRECT_SECRET_ID, deleted: false })).toEqual({ deleted: false });
    expect(state.messages[DIRECT_SECRET_ID]).toEqual(live);
    expect(Object.keys(state.notifications)).toHaveLength(noticesBefore);
  });

  it('keeps the files of a deleted message', async () => {
    const { t, state, direct } = world();
    state.files.fil_001 = {
      id: 'fil_001', projectId: null, stageId: null, taskId: null, conversationId: direct, name: 'Photo.jpg',
      versions: [{ letter: 'A', blobKey: 'blob_1', mimeType: 'image/jpeg', size: 9, uploadedBy: 'usr_002', uploadedAt: T1 }],
    };
    state.messages.msg_910 = message('msg_910', direct, { body: 'The photo', fileIds: ['fil_001'] });
    state.counters.msg = 910;
    t.as('usr_002');
    await t.api.call('chats.deleteMessage', { id: 'msg_910' });
    expect(state.files.fil_001).toBeDefined();
    expect(state.messages.msg_910.fileIds).toEqual(['fil_001']);
  });

  it('works in a closed chat, and for a message of the agent of the person', async () => {
    const { t, state, direct } = world();
    t.as('usr_005');
    const { message: sent } = await t.api.call('chats.send', { conversationId: direct, body: 'Checked.' });
    state.users.usr_002.active = false;
    t.as('usr_003');
    expect(await t.api.call('chats.deleteMessage', { id: sent.id })).toEqual({ deleted: true });
  });

  it('refuses the message of another person with not_author, and answers not_found to an outsider', async () => {
    const { t } = world();
    t.as('usr_003');
    expect(await failureOf(t.api.call('chats.deleteMessage', { id: DIRECT_SECRET_ID }))).toMatchObject({ code: 'forbidden', details: { reason: 'not_author', messageId: DIRECT_SECRET_ID } });
    t.as('usr_001');
    expect(await failureOf(t.api.call('chats.deleteMessage', { id: PROJECT_SECRET_ID }))).toMatchObject({ code: 'forbidden', details: { reason: 'not_author' } });
    t.as('usr_004');
    for (const id of [GROUP_SECRET_ID, DIRECT_SECRET_ID, PROJECT_SECRET_ID, 'msg_999']) {
      const error = await failureOf(t.api.call('chats.deleteMessage', { id }));
      expect(error, id).toMatchObject({ code: 'not_found' });
      expect(JSON.stringify(error), id).not.toContain(SECRET);
      expect(await failureOf(t.api.call('chats.deleteMessage', { id, deleted: false })), id).toMatchObject({ code: 'not_found' });
    }
    expect(Object.values(t.store.state.messages).filter((m) => m.deletedAt !== undefined)).toEqual([]);
  });

  it('pages before a message that was deleted, so Earlier messages still works', async () => {
    const { t, state, direct } = world();
    for (const [id, minute] of [['msg_911', '11'], ['msg_912', '12'], ['msg_913', '13'], ['msg_914', '14']] as const) {
      state.messages[id] = message(id, direct, { body: `Line ${id}`, createdAt: `2026-09-30T08:${minute}:00.000+03:00` });
    }
    state.counters.msg = 914;
    state.messages.msg_913.deletedAt = '2026-09-30T08:20:00.000+03:00';
    // A page before the deleted message holds the live messages that came before it, and not the deleted one.
    expect(messagePage(state, direct, 10, 'msg_913')?.map((m) => m.id)).toEqual([DIRECT_SECRET_ID, 'msg_911', 'msg_912']);
    t.as('usr_003');
    const page = await t.api.call('chats.messages', { conversationId: direct, before: 'msg_913' });
    expect(page.messages.map((view) => view.message.id)).toEqual([DIRECT_SECRET_ID, 'msg_911', 'msg_912']);
    // An id of another chat, or an id that never was, is still refused with one answer.
    const other = await failureOf(t.api.call('chats.messages', { conversationId: direct, before: GROUP_SECRET_ID }));
    const never = await failureOf(t.api.call('chats.messages', { conversationId: direct, before: 'msg_998' }));
    expect(other).toMatchObject({ code: 'invalid_input' });
    expect(JSON.stringify(other)).toBe(JSON.stringify(never));
  });
});
