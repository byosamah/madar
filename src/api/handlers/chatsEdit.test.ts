import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { addDirectConversation, addGroupConversation, addProjectConversation } from '../chatState';
import type { Message, Notification } from '../contract/entities';
import { NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The author edits a chat message (design item 11, base B8). Faisal (usr_002) leads prj_001, Sara (usr_003) is on its team, Omar
 * (usr_004) is outside, usr_005 is the agent of Sara, Hala (usr_001) is the Admin. The secrets sit in chats that Omar may not open.
 */
const T1 = '2026-09-30T08:10:00.000+03:00';
const SECRET = 'Secret 7731';
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

describe('chats.editMessage', () => {
  it('edits an own message, marks it edited, and tells only the person it names for the first time', async () => {
    const { t, state, projectChat } = world();
    t.as('usr_002');
    const { message: sent } = await t.api.call('chats.send', { conversationId: projectChat, body: 'Check the wall' });
    const edited = await t.api.call('chats.editMessage', { id: sent.id, body: '@[Sara Team](usr_003) check the wall' });
    expect(edited.message).toMatchObject({ body: '@[Sara Team](usr_003) check the wall', mentions: ['usr_003'], editedAt: expect.any(String) });
    expect(edited.mine).toBe(true);
    expect(noticesOf(state, 'usr_003')).toEqual([expect.objectContaining({ trigger: 'mention', targetType: 'chat', targetId: projectChat, messageId: sent.id })]);
    await t.api.call('chats.editMessage', { id: sent.id, body: '@[Sara Team](usr_003) check the east wall' });
    expect(noticesOf(state, 'usr_003')).toHaveLength(1);
    // The sender gets no notice for the own edit.
    expect(noticesOf(state, 'usr_002')).toEqual([]);
  });

  it('takes the notice from a person whose name the edit removes, and keeps the notices of the others', async () => {
    const { t, state, projectChat } = world();
    t.as('usr_002');
    const { message: sent } = await t.api.call('chats.send', { conversationId: projectChat, body: '@[Sara Team](usr_003) check the wall' });
    t.as('usr_001');
    await t.api.call('chats.send', { conversationId: projectChat, body: '@[Sara Team](usr_003) another message' });
    expect(noticesOf(state, 'usr_003')).toHaveLength(2);
    t.as('usr_002');
    const edited = await t.api.call('chats.editMessage', { id: sent.id, body: 'Check the wall' });
    expect(edited.message.mentions).toEqual([]);
    const left = noticesOf(state, 'usr_003');
    expect(left).toHaveLength(1);
    expect(left[0].messageId).not.toBe(sent.id);
  });

  it('keeps the reply author named after an edit, with no second notice', async () => {
    const { t, state, direct } = world();
    t.as('usr_003');
    const { message: reply } = await t.api.call('chats.send', { conversationId: direct, body: 'Approved.', replyToId: 'msg_902' });
    expect(reply.mentions).toEqual(['usr_002']);
    expect(noticesOf(state, 'usr_002')).toEqual([expect.objectContaining({ messageId: reply.id, reply: true })]);
    const edited = await t.api.call('chats.editMessage', { id: reply.id, body: 'Approved. Please book the lab.' });
    expect(edited.message).toMatchObject({ mentions: ['usr_002'], replyToId: 'msg_902' });
    expect(edited.replyTo).toMatchObject({ id: 'msg_902', deleted: false });
    expect(noticesOf(state, 'usr_002')).toHaveLength(1);
  });

  it('changes nothing for the same body', async () => {
    const { t, direct } = world();
    t.as('usr_002');
    const { message: sent } = await t.api.call('chats.send', { conversationId: direct, body: 'Same words' });
    const again = await t.api.call('chats.editMessage', { id: sent.id, body: '  Same words  ' });
    expect(again.message.editedAt).toBeNull();
    expect(t.store.state.messages[sent.id].editedAt).toBeNull();
  });

  it('lets a person edit a message of their agent, and in a closed chat', async () => {
    const { t, state, direct } = world();
    t.as('usr_005');
    const { message: sent } = await t.api.call('chats.send', { conversationId: direct, body: 'Checked.' });
    expect(sent).toMatchObject({ authorId: 'usr_005', actingForId: 'usr_003' });
    t.as('usr_003');
    const edited = await t.api.call('chats.editMessage', { id: sent.id, body: 'Checked twice.' });
    expect(edited.message).toMatchObject({ body: 'Checked twice.', editedAt: expect.any(String) });
    // The other person leaves: the chat is closed for new messages, and the author still edits.
    state.users.usr_002.active = false;
    const closed = await t.api.call('chats.editMessage', { id: sent.id, body: 'Checked three times.' });
    expect(closed.message.body).toBe('Checked three times.');
    expect(await failureOf(t.api.call('chats.send', { conversationId: direct, body: 'New' }))).toMatchObject({ code: 'forbidden' });
  });

  it('refuses the message of another person with not_author', async () => {
    const { t, direct } = world();
    t.as('usr_002');
    const { message: sent } = await t.api.call('chats.send', { conversationId: direct, body: 'Faisal wrote this' });
    t.as('usr_003');
    const error = await failureOf(t.api.call('chats.editMessage', { id: sent.id, body: 'Sara changes it' }));
    expect(error).toMatchObject({ code: 'forbidden', details: { reason: 'not_author', messageId: sent.id } });
    expect(t.store.state.messages[sent.id].body).toBe('Faisal wrote this');
    // The Admin who reads the project chat is no author either.
    t.as('usr_001');
    expect(await failureOf(t.api.call('chats.editMessage', { id: PROJECT_SECRET_ID, body: 'Hala changes it' }))).toMatchObject({ code: 'forbidden', details: { reason: 'not_author' } });
  });

  it('answers not_found for a message of a chat the person may not open, with no text of it', async () => {
    const { t } = world();
    t.as('usr_004');
    for (const id of [GROUP_SECRET_ID, DIRECT_SECRET_ID, PROJECT_SECRET_ID, 'msg_999']) {
      const error = await failureOf(t.api.call('chats.editMessage', { id, body: 'x' }));
      expect(error, id).toMatchObject({ code: 'not_found' });
      expect(JSON.stringify(error), id).not.toContain(SECRET);
    }
    // The answer for a hidden message equals the answer for an id that was never made, apart from the id.
    const hidden = await failureOf(t.api.call('chats.editMessage', { id: DIRECT_SECRET_ID, body: 'x' }));
    const never = await failureOf(t.api.call('chats.editMessage', { id: 'msg_998', body: 'x' }));
    expect(JSON.stringify(hidden).replace(DIRECT_SECRET_ID, 'ID')).toBe(JSON.stringify(never).replace('msg_998', 'ID'));
    expect(t.store.state.messages[DIRECT_SECRET_ID].body).toContain(SECRET);
  });

  it('answers not_found for a deleted message', async () => {
    const { t, state } = world();
    state.messages[DIRECT_SECRET_ID].deletedAt = STAMP;
    t.as('usr_002');
    expect(await failureOf(t.api.call('chats.editMessage', { id: DIRECT_SECRET_ID, body: 'Back again' }))).toMatchObject({ code: 'not_found' });
    expect(state.messages[DIRECT_SECRET_ID].editedAt).toBeNull();
  });
});
