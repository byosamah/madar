import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { addProjectConversation } from '../chatState';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

describe('the Inbox chats after the audit of 2026-10-03', () => {
  it('closes a direct chat when the other person left the office (SHL-15)', async () => {
    const t = testApi(chatCalls);
    const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    await t.api.call('chats.send', { conversationId: id, body: 'Do you have a minute?' });
    expect((await t.api.call('chats.messages', { conversationId: id })).chat.personLeft).toBe(false);
    t.store.state.users.usr_002.active = false;
    expect((await t.api.call('chats.messages', { conversationId: id })).chat.personLeft).toBe(true);
    const rows = await t.api.call('chats.list', {});
    expect(rows.find((row) => row.id === id)?.personLeft).toBe(true);
    expect(rows.find((row) => row.id === room.id)?.personLeft).toBe(false);
    await expect(t.api.call('chats.send', { conversationId: id, body: 'Hello?' }))
      .rejects.toMatchObject({ code: 'forbidden', details: { reason: 'person_left' } });
  });

  it('counts new comments in a task thread as unread until the person reads the thread (SHL-5)', async () => {
    const t = testApi({ ...chatCalls, ...contentCalls });
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003' });
    const row = async () => (await t.api.call('chats.list', {})).find((r) => r.id === 'tsk_001');
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Started the plan.' });
    // My own comment never counts.
    expect((await row())?.unread).toBe(0);
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please fix the door schedule.' });
    t.as('usr_003');
    expect((await row())?.unread).toBe(1);
    expect(await t.api.call('chats.unreadCount', {})).toEqual({ unread: 1 });
    expect(await t.api.call('chats.markRead', { conversationId: 'tsk_001' })).toEqual({ unread: 0 });
    expect((await row())?.unread).toBe(0);
  });
});

