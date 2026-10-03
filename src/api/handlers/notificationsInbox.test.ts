import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { notificationCalls } from './notifications';
import { notify } from '../notify';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const stamp = (minute: number) => `2026-09-30T08:${String(minute).padStart(2, '0')}:00.000+03:00`;

describe('the bell and the notifications list (audit 2026-10-03)', () => {
  it('leaves a notice of a deleted item out of the badge (SHL-12)', async () => {
    const t = testApi(notificationCalls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask();
    notify(s, s.users.usr_002, stamp(0), { userIds: ['usr_003'], trigger: 'task_assigned', targetType: 'task', targetId: 'tsk_001' });
    t.as('usr_003');
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 1 });
    delete s.tasks.tsk_001;
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 0 });
  });

  it('lists every unread notice, also past the limit, then the newest read ones (SHL-13)', async () => {
    const t = testApi(notificationCalls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask();
    notify(s, s.users.usr_002, stamp(0), { userIds: ['usr_003'], trigger: 'review_requested', targetType: 'task', targetId: 'tsk_001' });
    const [old] = Object.values(s.notifications);
    for (let minute = 1; minute <= 5; minute += 1) {
      notify(s, s.users.usr_002, stamp(minute), { userIds: ['usr_003'], trigger: 'stage_changed', targetType: 'project', targetId: 'prj_001' });
    }
    for (const n of Object.values(s.notifications)) if (n.id !== old.id) n.read = true;
    t.as('usr_003');
    const list = await t.api.call('notifications.list', { limit: 3 });
    expect(list).toHaveLength(3);
    expect(list.map((v) => v.notification.id)).toContain(old.id);
    // The old unread one keeps its place by time, after the newer read ones.
    expect(list.at(-1)?.notification.id).toBe(old.id);
  });

  it('gives a mention in a direct chat no target name, so the sentence does not name the sender twice (SHL-14)', async () => {
    const t = testApi({ ...notificationCalls, ...chatCalls });
    t.as('usr_002');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await t.api.call('chats.send', { conversationId: id, body: 'Can you check this, @[Sara Team](usr_003)?' });
    t.as('usr_003');
    const [view] = await t.api.call('notifications.list', {});
    expect(view).toMatchObject({ target: '', project: null, link: `/inbox/${id}` });
    expect(view.notification).toMatchObject({ trigger: 'mention', targetType: 'chat' });
  });

  it('marks my notices unread again, for the Undo of Mark all read, and refuses other people (SHL-16)', async () => {
    const t = testApi(notificationCalls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask();
    notify(s, s.users.usr_002, stamp(0), { userIds: ['usr_003', 'usr_004'], trigger: 'task_assigned', targetType: 'task', targetId: 'tsk_001' });
    const [mine, theirs] = Object.values(s.notifications);
    t.as('usr_003');
    await t.api.call('notifications.markAllRead', {});
    expect(await t.api.call('notifications.markUnread', { ids: [mine.id] })).toEqual({ unread: 1, badge: 1 });
    expect(s.notifications[mine.id].read).toBe(false);
    await expect(t.api.call('notifications.markUnread', { ids: [theirs.id] })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

