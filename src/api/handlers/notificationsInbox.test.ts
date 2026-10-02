import { beforeEach, describe, expect, it } from 'vitest';
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
});
