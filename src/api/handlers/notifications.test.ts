import { beforeEach, describe, expect, it } from 'vitest';
import { notificationCalls } from './notifications';
import { taskCalls } from './tasks';
import { contentCalls } from './content';
import { emailOn, morningSummaryOn, notify } from '../notify';
import { defaultPreferences, TRIGGERS } from '../contract/entities';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

function withNotices() {
  const t = testApi(notificationCalls);
  const s = t.store.state;
  s.tasks.tsk_001 = makeTask();
  notify(s, s.users.usr_002, '2026-09-29T09:00:00.000+03:00', { userIds: ['usr_003'], trigger: 'task_assigned', targetType: 'task', targetId: 'tsk_001' });
  notify(s, s.users.usr_002, STAMP, { userIds: ['usr_003'], trigger: 'stage_changed', targetType: 'project', targetId: 'prj_001' });
  notify(s, s.users.usr_002, STAMP, { userIds: ['usr_004'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' });
  t.as('usr_003');
  return t;
}

describe('notification calls', () => {
  it('lists my notifications, newest first, with links and a badge count', async () => {
    const t = withNotices();
    const list = await t.api.call('notifications.list', {});
    expect(list.map((v) => v.notification.trigger)).toEqual(['stage_changed', 'task_assigned']);
    expect(list[1]).toMatchObject({ target: 'Ground floor plan', projectCode: 'KH-26-001', link: '/projects/prj_001?tab=tasks&task=tsk_001', needsAction: true });
    expect(list[1].actor?.id).toBe('usr_002');
    expect(list[0]).toMatchObject({ link: '/projects/prj_001', needsAction: false });
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 2, badge: 1 });
  });

  it('marks my notifications as read and refuses other people', async () => {
    const t = withNotices();
    const [first] = await t.api.call('notifications.list', {});
    expect(await t.api.call('notifications.markRead', { ids: [first.notification.id] })).toEqual({ unread: 1, badge: 1 });
    await expect(t.api.call('notifications.markRead', { ids: ['ntf_003'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await t.api.call('notifications.markAllRead', {})).toEqual({ unread: 0, badge: 0 });
  });

  it('turns a trigger off', async () => {
    const t = withNotices();
    const user = await t.api.call('notifications.updateSettings', { trigger: 'mention', on: false });
    expect(user.preferences.notifications.mention).toBe(false);
    const s = t.store.state;
    expect(notify(s, s.users.usr_002, STAMP, { userIds: ['usr_003'], trigger: 'mention', targetType: 'task', targetId: 'tsk_001' })).toHaveLength(0);
  });
});

describe('notice links and approval', () => {
  it('opens tasks and posts on the right tab, and offers Approve only while the task waits', async () => {
    const t = testApi({ ...notificationCalls, ...taskCalls, ...contentCalls });
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', needsReview: true });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Ready @[Faisal Leader](usr_002)' });
    t.as('usr_002');
    const views = await t.api.call('notifications.list', {});
    const review = views.find((v) => v.notification.trigger === 'review_requested');
    expect(review?.link).toBe('/projects/prj_001?tab=tasks&task=tsk_001');
    expect(review?.canApprove).toBe(true);
    expect(views.find((v) => v.notification.trigger === 'mention')?.link).toBe(`/projects/prj_001?tab=activity&update=${post.id}`);
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    const after = await t.api.call('notifications.list', {});
    expect(after.find((v) => v.notification.trigger === 'review_requested')?.canApprove).toBe(false);
  });
});

describe('email switches and the morning summary (plan 4.13, A7; spec 2, section 10)', () => {
  it('reads the defaults: email on for assigned tasks, reviews and mentions, and the morning summary on', () => {
    const prefs = defaultPreferences();
    expect(TRIGGERS.filter((trigger) => emailOn(prefs, trigger))).toEqual(['task_assigned', 'mention', 'review_requested']);
    expect(morningSummaryOn(prefs)).toBe(true);
    expect(morningSummaryOn({ ...prefs, morningSummary: false })).toBe(false);
    expect(emailOn({ ...prefs, email: { mention: false, overdue: true } }, 'mention')).toBe(false);
    expect(emailOn({ ...prefs, email: { mention: false, overdue: true } }, 'overdue')).toBe(true);
  });

  it('saves an email switch and the morning summary, apart from the in-app switches', async () => {
    const t = withNotices();
    const user = await t.api.call('notifications.updateSettings', { channel: 'email', trigger: 'overdue', on: true });
    expect(user.preferences.email).toEqual({ overdue: true });
    expect(user.preferences.notifications.overdue).toBe(true);
    const off = await t.api.call('notifications.updateSettings', { channel: 'email', trigger: 'mention', on: false });
    expect(off.preferences.email).toEqual({ overdue: true, mention: false });
    expect(off.preferences.notifications.mention).toBe(true);
    const summary = await t.api.call('notifications.updateSettings', { morningSummary: false });
    expect(summary.preferences.morningSummary).toBe(false);
    expect(morningSummaryOn(t.store.state.users[summary.id].preferences)).toBe(false);
    // The in-app form of today still works.
    expect((await t.api.call('notifications.updateSettings', { trigger: 'mention', on: false })).preferences.notifications.mention).toBe(false);
  });

  it('refuses a change that names no switch, or two', async () => {
    const t = withNotices();
    await expect(t.api.call('notifications.updateSettings', {})).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('notifications.updateSettings', { channel: 'email', trigger: 'mention' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('notifications.updateSettings', { trigger: 'mention', on: true, morningSummary: true })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('lets no agent change the email switches or the morning summary', async () => {
    const t = withNotices();
    t.as('usr_005');
    await expect(t.api.call('notifications.updateSettings', { channel: 'email', trigger: 'mention', on: false })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('notifications.updateSettings', { morningSummary: false })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.users.usr_003.preferences.email).toBeUndefined();
    expect(t.store.state.users.usr_003.preferences.morningSummary).toBeUndefined();
  });
});
