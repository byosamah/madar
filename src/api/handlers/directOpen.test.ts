import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { chatReadKey } from '../store';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A direct chat with no message shows only for the person who opened it (chat design 2026-10-19, item 18). Today "New message", then
 * a person, made an empty chat that showed at once in the Inbox of the other person. Hala (usr_001) is the Admin, Faisal (usr_002)
 * leads prj_001, Sara (usr_003) is on its team, usr_005 is the agent of Sara.
 */
const rowOf = async (t: ReturnType<typeof testApi<typeof chatCalls>>, id: string) => (await t.api.call('chats.list', {})).find((row) => row.id === id);

describe('an empty direct chat', () => {
  it('shows a direct chat with no message only to the person who opened it', async () => {
    const t = testApi(chatCalls);
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    expect(await rowOf(t, id)).toBeDefined();
    t.as('usr_002');
    expect(await rowOf(t, id)).toBeUndefined();
    expect((await t.api.call('chats.openDirect', { userId: 'usr_003' })).id).toBe(id);
    expect(await rowOf(t, id)).toBeDefined();
  });

  it('shows it to both people after the first message', async () => {
    const t = testApi(chatCalls);
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    await t.api.call('chats.send', { conversationId: id, body: 'Do you have a minute?' });
    t.as('usr_002');
    expect(await rowOf(t, id)).toMatchObject({ unread: 1, preview: 'Do you have a minute?' });
  });

  it('writes no read mark when an agent opens it, and shows it to nobody until the first message', async () => {
    const t = testApi(chatCalls);
    t.as('usr_005');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    expect(t.store.state.chatReads[chatReadKey(id, 'usr_003')]).toBeUndefined();
    expect(await rowOf(t, id)).toBeUndefined();
    t.as('usr_003');
    expect(await rowOf(t, id)).toBeUndefined();
    t.as('usr_005');
    await t.api.call('chats.send', { conversationId: id, body: 'The plan is ready.' });
    t.as('usr_002');
    expect(await rowOf(t, id)).toMatchObject({ unread: 1 });
    t.as('usr_003');
    expect(await rowOf(t, id)).toBeDefined();
  });

  it('changes no read mark when the chat has messages', async () => {
    const t = testApi(chatCalls);
    t.as('usr_002');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: id, body: 'Please check the footing.' });
    t.as('usr_003');
    await t.api.call('chats.openDirect', { userId: 'usr_002' });
    expect(t.store.state.chatReads[chatReadKey(id, 'usr_003')]).toBeUndefined();
    expect(await rowOf(t, id)).toMatchObject({ unread: 1 });
  });

  it('keeps the read mark of a person who opens the chat twice', async () => {
    const t = testApi(chatCalls);
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    const first = t.store.state.chatReads[chatReadKey(id, 'usr_003')];
    await t.api.call('chats.openDirect', { userId: 'usr_002' });
    expect(t.store.state.chatReads[chatReadKey(id, 'usr_003')]).toEqual(first);
  });

  it('shows an empty chat to nobody else, the Admin included', async () => {
    const t = testApi(chatCalls);
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    t.as('usr_001');
    expect(await rowOf(t, id)).toBeUndefined();
    t.as('usr_004');
    expect(await rowOf(t, id)).toBeUndefined();
  });
});
