import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
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
    const sent = await t.api.call('chats.send', { conversationId: id, body: 'Can you check this, @[Sara Team](usr_003)?' });
    t.as('usr_003');
    const [view] = await t.api.call('notifications.list', {});
    expect(view).toMatchObject({ target: '', project: null, link: `/inbox/${id}?at=${sent.message.id}` });
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

/** The view of a report notice (owner, 2026-10-07, rules B12, B13, B17 and B18). Hala (usr_001) and Faisal (usr_002) are Admins. */
describe('the notices of requests and bugs in the list and on the bell', () => {
  const MESSAGE = 'The board does not scroll on my phone.';
  async function world() {
    const t = testApi(calls);
    t.store.state.users.usr_002.systemRole = 'admin';
    t.as('usr_003');
    const report = await t.api.call('feedback.send', { kind: 'bug', message: MESSAGE, page: '/projects', screenshots: [] });
    return { t, report };
  }
  const reportNotice = (t: Awaited<ReturnType<typeof world>>['t'], userId: string) => async () => {
    t.as(userId);
    return (await t.api.call('notifications.list', {})).find((view) => view.notification.targetType === 'feedback')!;
  };

  it('shows the Admin the new report with its excerpt, a link to the reports and a place on the bell', async () => {
    const { t, report } = await world();
    const view = await reportNotice(t, 'usr_001')();
    expect(view).toMatchObject({
      target: MESSAGE, link: '/admin/feedback', gone: false, needsAction: true, canApprove: false, project: null, projectCode: null, dueDate: null,
      actor: { id: 'usr_003' },
    });
    expect(view.notification).toMatchObject({ trigger: 'feedback_sent', targetId: report.id, feedback: { kind: 'bug', excerpt: MESSAGE } });
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 1 });
  });

  it('shows the sender the done report with no link, and the bell counts it', async () => {
    const { t, report } = await world();
    t.as('usr_001');
    await t.api.call('feedback.setStatus', { id: report.id, status: 'done' });
    const view = await reportNotice(t, 'usr_003')();
    expect(view).toMatchObject({ target: MESSAGE, link: '', gone: false, needsAction: true, canApprove: false, project: null });
    expect(view.notification).toMatchObject({ trigger: 'feedback_done', feedback: { kind: 'bug', excerpt: MESSAGE } });
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 1 });
  });

  it('hides the new report from a former Admin, and shows it again after a new promotion', async () => {
    const { t } = await world();
    t.store.state.users.usr_002.systemRole = 'member';
    const hidden = await reportNotice(t, 'usr_002')();
    expect(hidden).toMatchObject({ gone: true, target: '', actor: null, link: '', project: null });
    expect('feedback' in hidden.notification).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain(MESSAGE);
    expect(JSON.stringify(hidden)).not.toContain('usr_003');
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 0 });
    t.store.state.users.usr_002.systemRole = 'admin';
    const again = await reportNotice(t, 'usr_002')();
    expect(again).toMatchObject({ gone: false, target: MESSAGE, link: '/admin/feedback', actor: { id: 'usr_003' } });
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 1 });
  });

  it('refuses an email switch for a notice that stays in the app, and changes nothing', async () => {
    const t = testApi(notificationCalls);
    t.as('usr_003');
    const before = structuredClone(t.store.state.users.usr_003.preferences);
    for (const trigger of ['feedback_done', 'feedback_sent'] as const) {
      await expect(t.api.call('notifications.updateSettings', { channel: 'email', trigger, on: true })).rejects.toMatchObject({
        code: 'invalid_input', message: 'This notice stays in the app. It sends no email.', details: { fields: ['trigger'], reason: 'in_app_only' },
      });
    }
    expect(t.store.state.users.usr_003.preferences).toEqual(before);
    // The in-app switch works for everyone.
    expect((await t.api.call('notifications.updateSettings', { trigger: 'feedback_done', on: false })).preferences.notifications.feedback_done).toBe(false);
  });
});

