import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { notificationCalls } from './notifications';
import { projectCalls } from './projects';
import { addProjectConversation } from '../chatState';
import { mentionMarkup } from '../../lib/text';
import { setNow } from '../../lib/dates';
import { makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...notificationCalls, ...projectCalls };

/**
 * A read of a chat or a task thread marks its mention and reply notices read (chat design item 20). Hala (usr_001) is the Admin, Faisal
 * (usr_002) leads prj_001 and tsk_001, Sara (usr_003) is on the team, Omar (usr_004) is outside.
 */
function world() {
  const t = testApi(calls);
  const room = addProjectConversation(t.store.state, 'prj_001', STAMP);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Madar Second', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' });
  t.store.state.tasks.tsk_001 = makeTask();
  return { ...t, room: room.id };
}

const unreadOf = async (t: ReturnType<typeof world>, userId: string) => {
  t.as(userId);
  return (await t.api.call('notifications.count', {})).unread;
};

describe('a read of a chat marks its mention notices read (item 20)', () => {
  it('marks the mention notices of a chat read when the person reads the chat (item 20)', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Sara Team', 'usr_003')} and ${mentionMarkup('Hala Admin', 'usr_001')} check this` });
    t.as('usr_003');
    expect((await t.api.call('notifications.count', {})).unread).toBe(1);
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect((await t.api.call('notifications.count', {})).unread).toBe(0);
    t.as('usr_001');
    expect((await t.api.call('notifications.count', {})).unread).toBe(1);
  });

  it('marks the mention notices of a task thread read when the person reads the thread', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: `${mentionMarkup('Sara Team', 'usr_003')} please look` });
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    await t.api.call('chats.markRead', { conversationId: 'tsk_001' });
    expect((await t.api.call('notifications.count', {})).unread).toBe(0);
  });

  it('marks a reply notice read too', async () => {
    const t = world();
    t.as('usr_003');
    const first = await t.api.call('chats.send', { conversationId: t.room, body: 'The slab is ready.' });
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: 'Thanks, I will check it.', replyToId: first.message.id });
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    const notice = Object.values(t.store.state.notifications).find((n) => n.userId === 'usr_003');
    expect(notice).toMatchObject({ trigger: 'mention', reply: true, targetId: t.room });
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect((await t.api.call('notifications.count', {})).unread).toBe(0);
  });

  it('leaves the notices of another chat and an added_to_group notice unread', async () => {
    const t = world();
    t.as('usr_002');
    const direct = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: direct.id, body: `${mentionMarkup('Sara Team', 'usr_003')} a private word` });
    const group = await t.api.call('chats.createGroup', { name: 'Facade review', memberIds: ['usr_001', 'usr_004'] });
    // Only an added person gets the added_to_group notice (chats.updateGroup).
    await t.api.call('chats.updateGroup', { conversationId: group.id, add: ['usr_003'] });
    expect(await unreadOf(t, 'usr_003')).toBe(2);
    await t.api.call('chats.markRead', { conversationId: group.id });
    expect((await t.api.call('notifications.count', {})).unread).toBe(2);
  });

  it('marks them read when the person archives the chat, and changes none when the chat moves back', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Sara Team', 'usr_003')} first` });
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    await t.api.call('chats.archive', { conversationId: t.room, archived: true });
    expect((await t.api.call('notifications.count', {})).unread).toBe(0);
    setNow(new Date(NOW.getTime() + 60_000));
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Sara Team', 'usr_003')} second` });
    expect(await unreadOf(t, 'usr_003')).toBe(1);
    await t.api.call('chats.archive', { conversationId: t.room, archived: false });
    expect((await t.api.call('notifications.count', {})).unread).toBe(1);
  });

  it('leaves the notices of other people unread', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('chats.send', { conversationId: t.room, body: `${mentionMarkup('Hala Admin', 'usr_001')} only you` });
    t.as('usr_003');
    await t.api.call('chats.markRead', { conversationId: t.room });
    expect(await unreadOf(t, 'usr_001')).toBe(1);
  });
});
