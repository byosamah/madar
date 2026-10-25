import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { peopleCalls } from './people';
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

/**
 * The guard of the Inbox line (fbk_056). The screen sums `unread` over the rows that the chosen kind hides, and shows it as the part of
 * the red badge that sits in the other chats. So the badge and the sum of the rows must be the same number, whoever looks.
 */
describe('the badge equals the sum of the unread of the rows (fbk_056)', () => {
  const reaches = ['mixed', 'mine', 'all'] as const;

  async function talkInEveryKind() {
    const t = testApi({ ...chatCalls, ...contentCalls, ...peopleCalls });
    addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_001' });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003' });
    // Hala (Admin), Faisal (leads prj_001) and Sara (team) write in a project chat, a direct chat, a group and two task threads.
    t.as('usr_002');
    const room = (await t.api.call('chats.list', {})).find((row) => row.kind === 'project')!;
    await t.api.call('chats.send', { conversationId: room.id, body: 'Plain project message.' });
    await t.api.call('chats.send', { conversationId: room.id, body: 'Another plain project message.' });
    const toHala = await t.api.call('chats.openDirect', { userId: 'usr_001' });
    await t.api.call('chats.send', { conversationId: toHala.id, body: 'Direct to Hala.' });
    const toSara = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: toSara.id, body: 'Direct to Sara.' });
    const group = await t.api.call('chats.createGroup', { name: 'Site crew', memberIds: ['usr_001', 'usr_003'] });
    await t.api.call('chats.send', { conversationId: group.id, body: 'Group message.' });
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please check the plan.' });
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_002', body: 'Please check the doors.' });
    return t;
  }

  const sumOfRows = async (t: Awaited<ReturnType<typeof talkInEveryKind>>) =>
    (await t.api.call('chats.list', {})).reduce((sum, row) => sum + row.unread, 0);

  it('holds for a Member', async () => {
    const t = await talkInEveryKind();
    t.as('usr_003');
    const rows = await t.api.call('chats.list', {});
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(['project', 'direct', 'group', 'task']));
    const sum = await sumOfRows(t);
    expect(sum).toBeGreaterThan(0);
    expect((await t.api.call('chats.unreadCount', {})).unread).toBe(sum);
  });

  for (const adminReach of reaches) {
    it(`holds for an Admin with the reach ${adminReach}`, async () => {
      const t = await talkInEveryKind();
      t.as('usr_001');
      await t.api.call('me.updatePreferences', { adminReach });
      const sum = await sumOfRows(t);
      expect(sum).toBeGreaterThan(0);
      expect((await t.api.call('chats.unreadCount', {})).unread).toBe(sum);
    });
  }
});

