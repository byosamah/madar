import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { Feedback } from '../contract/entities';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The five statuses of a report (fbk_067, owner 2026-10-26): new, in_review, in_progress, rejected and done. Hala (usr_001) and Faisal
 * (usr_002) are Admins, Omar (usr_004) is an Admin who left, Sara (usr_003) is a member who sends, and usr_009 is the agent of Hala.
 */
const MESSAGE = 'The board does not scroll on my phone.';
const REASON = 'We already plan this for the next release SECRET-REASON-4471.';

function world() {
  const t = testApi(calls);
  const s = t.store.state;
  s.users.usr_002.systemRole = 'admin';
  s.users.usr_004.systemRole = 'admin';
  s.users.usr_004.active = false;
  s.users.usr_009 = makeUser('usr_009', { name: 'Hala Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' });
  s.counters.usr = 9;
  return t;
}
type T = ReturnType<typeof world>;
type Status = 'new' | 'in_review' | 'in_progress' | 'rejected' | 'done';

const send = async (t: T, userId = 'usr_003', message = MESSAGE) => {
  t.as(userId);
  return t.api.call('feedback.send', { kind: 'bug', message, page: '/projects', screenshots: [] });
};
const mark = async (t: T, userId: string, id: string, status: Status, reason?: string, correlationId?: string) => {
  t.as(userId);
  return t.api.call('feedback.setStatus', { id, status, ...(reason === undefined ? {} : { reason }) }, correlationId ? { correlationId } : {});
};
const answers = (t: T) => Object.values(t.store.state.notifications).filter((n) => n.trigger === 'feedback_done');
const stored = (t: T, id: string) => t.store.state.feedback![id]!;

describe('feedback.setStatus takes each of the five statuses', () => {
  it.each(['in_review', 'in_progress', 'done', 'new'] as const)('sets %s with no reason', async (status) => {
    const t = world();
    const report = await send(t);
    const answer = await mark(t, 'usr_001', report.id, status);
    expect(answer.status).toBe(status);
    expect(stored(t, report.id).status).toBe(status);
    expect(Feedback.safeParse(stored(t, report.id)).success).toBe(true);
  });

  it('sets rejected with a trimmed reason, and keeps the reason on the report', async () => {
    const t = world();
    const report = await send(t);
    const answer = await mark(t, 'usr_001', report.id, 'rejected', `  ${REASON}  `);
    expect(answer).toMatchObject({ status: 'rejected', rejectReason: REASON, doneBy: null, doneAt: null });
    expect(Feedback.safeParse(stored(t, report.id)).success).toBe(true);
  });

  it('writes one history event for each change, with the old and the new status', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'in_review');
    await mark(t, 'usr_001', report.id, 'in_progress');
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    const changes = Object.values(t.store.state.events).filter((e) => e.verb === 'feedback.status_changed').sort((a, b) => a.seq - b.seq);
    expect(changes.map((e) => [(e.before as Record<string, unknown>).status, (e.after as Record<string, unknown>).status])).toEqual([
      ['new', 'in_review'], ['in_review', 'in_progress'], ['in_progress', 'rejected'],
    ]);
    expect((changes[2].after as Record<string, unknown>).rejectReason).toBe(REASON);
  });

  it('clears the reason on the report when it leaves rejected, and the history keeps it', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    const back = await mark(t, 'usr_001', report.id, 'in_review');
    expect(back.rejectReason ?? null).toBeNull();
    const rejection = Object.values(t.store.state.events).find((e) => (e.after as Record<string, unknown>).rejectReason === REASON);
    expect(rejection).toBeDefined();
  });

  it('marks done with the person and the time, and clears them when the status moves on', async () => {
    const t = world();
    const report = await send(t);
    expect(await mark(t, 'usr_002', report.id, 'done')).toMatchObject({ status: 'done', doneBy: 'usr_002' });
    expect(await mark(t, 'usr_002', report.id, 'in_progress')).toMatchObject({ status: 'in_progress', doneBy: null, doneAt: null });
  });
});

describe('rejected needs a reason', () => {
  it.each([
    ['no reason', undefined],
    ['an empty reason', ''],
    ['spaces only', '    '],
    ['invisible characters only', '​​‍⁠'],
    ['501 characters', 'x'.repeat(501)],
  ])('refuses %s, and changes nothing', async (_name, reason) => {
    const t = world();
    const report = await send(t);
    const events = Object.keys(t.store.state.events).length;
    const notices = Object.keys(t.store.state.notifications).length;
    await expect(mark(t, 'usr_001', report.id, 'rejected', reason)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(stored(t, report.id).status).toBe('new');
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
    expect(Object.keys(t.store.state.notifications)).toHaveLength(notices);
  });

  it('takes a reason of exactly 500 characters and one of one character', async () => {
    const t = world();
    const a = await send(t);
    const b = await send(t, 'usr_003', 'Second');
    expect((await mark(t, 'usr_001', a.id, 'rejected', 'x'.repeat(500))).rejectReason).toHaveLength(500);
    expect((await mark(t, 'usr_001', b.id, 'rejected', 'x')).rejectReason).toBe('x');
  });

  it('refuses a reason with any other status', async () => {
    const t = world();
    const report = await send(t);
    for (const status of ['new', 'in_review', 'in_progress', 'done'] as const) {
      await expect(mark(t, 'usr_001', report.id, status, 'A reason')).rejects.toMatchObject({ code: 'invalid_input' });
    }
    expect(stored(t, report.id).status).toBe('new');
  });

  it('refuses an unknown status', async () => {
    const t = world();
    const report = await send(t);
    await expect(mark(t, 'usr_001', report.id, 'closed' as Status)).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('the notices of the five statuses', () => {
  it('sends no notice for in_review and in_progress', async () => {
    const t = world();
    const report = await send(t);
    const before = Object.keys(t.store.state.notifications).length;
    await mark(t, 'usr_001', report.id, 'in_review');
    await mark(t, 'usr_001', report.id, 'in_progress');
    await mark(t, 'usr_001', report.id, 'new');
    expect(Object.keys(t.store.state.notifications)).toHaveLength(before);
  });

  it('gives the sender exactly one notice with the reason when a report is rejected', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    expect(answers(t)).toEqual([
      expect.objectContaining({
        userId: 'usr_003', actorId: 'usr_001', targetType: 'feedback', targetId: report.id, dedupeKey: null, read: false,
        feedback: { kind: 'bug', excerpt: MESSAGE, reason: REASON },
      }),
    ]);
  });

  it('gives the done notice no reason, as before', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'done');
    const [done] = answers(t);
    expect(done.feedback).toEqual({ kind: 'bug', excerpt: MESSAGE });
  });

  it('sends the done notice when a rejected report moves to done, and the rejected notice when a done report is rejected', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    await mark(t, 'usr_001', report.id, 'done');
    await mark(t, 'usr_001', report.id, 'rejected', 'Another reason');
    expect(answers(t).map((n) => n.feedback?.reason ?? null)).toEqual([REASON, null, 'Another reason']);
  });

  it('sends the done notice when a report moves to done from in_review or in_progress', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'in_review');
    await mark(t, 'usr_001', report.id, 'done');
    await mark(t, 'usr_001', report.id, 'in_progress');
    await mark(t, 'usr_001', report.id, 'done');
    expect(answers(t)).toHaveLength(2);
  });

  it('adds no second notice for rejected on a report that is already rejected', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    await mark(t, 'usr_002', report.id, 'rejected', 'A new reason');
    expect(answers(t)).toHaveLength(1);
    expect(stored(t, report.id).rejectReason).toBe('A new reason');
  });

  it('follows the same rules as the done notice: no notice to the Admin who sent it, to their agent, to a sender who left or whose switch is off', async () => {
    const t = world();
    const own = await send(t, 'usr_001', 'Own report');
    await mark(t, 'usr_001', own.id, 'rejected', REASON);
    const agentRun = await send(t, 'usr_009', 'Agent report');
    await mark(t, 'usr_001', agentRun.id, 'rejected', REASON);
    expect(answers(t)).toEqual([]);
    const left = await send(t, 'usr_003', 'Left');
    t.store.state.users.usr_003.active = false;
    await mark(t, 'usr_001', left.id, 'rejected', REASON);
    t.store.state.users.usr_003.active = true;
    expect(answers(t)).toEqual([]);
    const off = await send(t, 'usr_003', 'Off');
    t.store.state.users.usr_003.preferences.notifications.feedback_done = false;
    await mark(t, 'usr_001', off.id, 'rejected', REASON);
    expect(answers(t)).toEqual([]);
  });

  it('sends the rejection of a report that an agent sent to the person of the agent', async () => {
    const t = world();
    const report = await send(t, 'usr_009');
    await mark(t, 'usr_002', report.id, 'rejected', REASON);
    expect(answers(t)).toEqual([expect.objectContaining({ userId: 'usr_001', actorId: 'usr_002' })]);
  });

  it('never sends the email: the rejected notice stays in the app', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    const [notice] = answers(t);
    expect(notice.trigger).toBe('feedback_done');
  });
});

describe('the sentence of a rejected notice', () => {
  it('names the reason in the bell of the sender, and the Inbox counts it', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    t.as('usr_003');
    const list = await t.api.call('notifications.list', {});
    const view = list.find((one) => one.notification.trigger === 'feedback_done')!;
    expect(view).toMatchObject({ gone: false, target: MESSAGE, link: '', needsAction: true });
    expect(view.notification.feedback?.reason).toBe(REASON);
    expect((await t.api.call('notifications.count', {})).badge).toBeGreaterThan(0);
  });
});

describe('the list filter', () => {
  async function filled() {
    const t = world();
    const ids: Record<Status, string> = { new: '', in_review: '', in_progress: '', rejected: '', done: '' };
    for (const status of ['new', 'in_review', 'in_progress', 'rejected', 'done'] as const) {
      const report = await send(t, 'usr_003', `Report ${status}`);
      ids[status] = report.id;
      if (status !== 'new') await mark(t, 'usr_001', report.id, status, status === 'rejected' ? REASON : undefined);
    }
    t.as('usr_001');
    return { t, ids };
  }

  it.each(['new', 'in_review', 'in_progress', 'rejected', 'done'] as const)('gives only the reports with status %s', async (status) => {
    const { t, ids } = await filled();
    const rows = await t.api.call('feedback.list', { status });
    expect(rows.map((row) => row.item.id)).toEqual([ids[status]]);
  });

  it('gives new, in_review and in_progress for open, and "new" still means only new', async () => {
    const { t, ids } = await filled();
    const open = await t.api.call('feedback.list', { status: 'open' });
    expect(open.map((row) => row.item.id).sort()).toEqual([ids.new, ids.in_review, ids.in_progress].sort());
    expect((await t.api.call('feedback.list', { status: 'new' })).map((row) => row.item.id)).toEqual([ids.new]);
  });

  it('puts the open reports first, then the done ones, then the rejected ones, newest first in each group', async () => {
    const { t, ids } = await filled();
    const rows = await t.api.call('feedback.list', {});
    expect(rows.map((row) => row.item.status)).toEqual(['in_progress', 'in_review', 'new', 'done', 'rejected']);
    expect(rows.map((row) => row.item.id)).toEqual([ids.in_progress, ids.in_review, ids.new, ids.done, ids.rejected]);
  });

  it('refuses a status that does not exist', async () => {
    const { t } = await filled();
    await expect(t.api.call('feedback.list', { status: 'closed' as never })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('old reports read as before', () => {
  it('loads a stored report with only new or done and no reason field', () => {
    const base = { id: 'fbk_001', kind: 'bug', message: 'Old', page: '', screenshots: [], createdBy: 'usr_003', createdAt: '2026-10-01T08:00:00.000+03:00' };
    expect(Feedback.safeParse({ ...base, status: 'new', doneBy: null, doneAt: null }).success).toBe(true);
    expect(Feedback.safeParse({ ...base, status: 'done', doneBy: 'usr_001', doneAt: '2026-10-02T08:00:00.000+03:00' }).success).toBe(true);
    expect(Feedback.safeParse({ ...base, status: 'closed', doneBy: null, doneAt: null }).success).toBe(false);
  });

  it('moves an old report with no reason field to rejected and back, and an Undo restores it', async () => {
    const t = world();
    const report = await send(t);
    delete (stored(t, report.id) as { rejectReason?: unknown }).rejectReason;
    await mark(t, 'usr_001', report.id, 'rejected', REASON, 'cor_reject');
    expect(stored(t, report.id)).toMatchObject({ status: 'rejected', rejectReason: REASON });
    await t.api.call('events.undoStory', { correlationId: 'cor_reject' });
    expect(stored(t, report.id).status).toBe('new');
    expect(stored(t, report.id).rejectReason ?? null).toBeNull();
    expect(answers(t)).toEqual([]);
  });
});

describe('an Undo of a status change', () => {
  it('takes back the rejected notice with its story, and the report is open again', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON, 'cor_r');
    expect(answers(t)).toHaveLength(1);
    await t.api.call('events.undoStory', { correlationId: 'cor_r' });
    expect(answers(t)).toEqual([]);
    expect(stored(t, report.id)).toMatchObject({ status: 'new' });
    expect(stored(t, report.id).rejectReason ?? null).toBeNull();
  });

  it('keeps the done notice of a move to done from in_review while that move stands in its story', async () => {
    const t = world();
    const first = await send(t, 'usr_003', 'First');
    const second = await send(t, 'usr_003', 'Second');
    await mark(t, 'usr_001', first.id, 'in_review', undefined, 'cor_s');
    await mark(t, 'usr_001', first.id, 'done', undefined, 'cor_s');
    await mark(t, 'usr_001', second.id, 'done', undefined, 'cor_s');
    expect(answers(t)).toHaveLength(2);
    const change = Object.values(t.store.state.events).find((e) => e.correlationId === 'cor_s' && e.targetId === second.id)!;
    t.as('usr_001');
    await t.api.call('events.undo', { eventId: change.id });
    expect(answers(t).map((n) => n.targetId)).toEqual([first.id]);
  });

  it('counts the done and the rejected notices of one story apart', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'done', undefined, 'cor_m');
    await mark(t, 'usr_001', report.id, 'rejected', REASON, 'cor_m');
    expect(answers(t)).toHaveLength(2);
    const last = Object.values(t.store.state.events).filter((e) => e.correlationId === 'cor_m').sort((a, b) => b.seq - a.seq)[0];
    expect(last.after).toMatchObject({ status: 'rejected' });
    await t.api.call('events.undo', { eventId: last.id });
    expect(stored(t, report.id).status).toBe('done');
    expect(answers(t).map((n) => n.feedback?.reason ?? null)).toEqual([null]);
  });
});

/** The leak rows of fbk_067: the reason reaches the sender's notice and the people with feedback.manage, and nobody else. */
describe('the reason never reaches another person', () => {
  // usr_005 is the agent of the sender, so it reads the notices of the sender and is no probe here.
  const OTHERS = ['usr_002', 'usr_004', 'usr_009'];

  it('is in no notice list of another person, also an Admin who picked "Everything"', async () => {
    const t = world();
    t.store.state.users.usr_002.preferences.adminReach = 'all';
    t.store.state.users.usr_001.preferences.adminReach = 'all';
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    for (const userId of OTHERS) {
      t.as(userId);
      const text = JSON.stringify(await t.api.call('notifications.list', {}));
      expect(text, userId).not.toContain('SECRET-REASON-4471');
    }
    const holders = Object.values(t.store.state.notifications).filter((n) => JSON.stringify(n).includes('SECRET-REASON-4471'));
    expect(holders.map((n) => n.userId)).toEqual(['usr_003']);
  });

  it('is in no history list of a person without the report right', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    for (const userId of ['usr_003', 'usr_004', 'usr_005']) {
      t.as(userId);
      const text = JSON.stringify(await t.api.call('events.list', { limit: 500 }).catch(() => []));
      expect(text, userId).not.toContain('SECRET-REASON-4471');
    }
  });

  it('is in no error text: a member who tries to set the status gets the plain refusal', async () => {
    const t = world();
    const report = await send(t);
    for (const userId of ['usr_003', 'usr_004', 'usr_005']) {
      const error = await mark(t, userId, report.id, 'rejected', REASON).catch((e: unknown) => e as { code: string; message: string; details?: unknown });
      expect(error, userId).toMatchObject({ code: 'forbidden', message: 'You cannot do this.' });
      expect(JSON.stringify(error)).not.toContain('SECRET-REASON-4471');
      const fake = await mark(t, userId, 'fbk_999', 'rejected', REASON).catch((e: unknown) => e);
      expect(fake).toMatchObject({ code: 'forbidden' });
    }
    expect(stored(t, report.id).status).toBe('new');
  });

  it('is not in feedback.list for a person without the report right', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    for (const userId of ['usr_003', 'usr_004', 'usr_005']) {
      t.as(userId);
      for (const status of [undefined, 'rejected', 'open'] as const) {
        await expect(t.api.call('feedback.list', status ? { status } : {}), `${userId} ${status}`).rejects.toMatchObject({ code: 'forbidden', message: 'You cannot do this.' });
      }
    }
  });

  it('lets a former Admin read the sender notice as hidden, and reads the notice of the sender as the sender alone', async () => {
    const t = world();
    const report = await send(t);
    await mark(t, 'usr_001', report.id, 'rejected', REASON);
    t.store.state.users.usr_004.active = true;
    t.as('usr_004');
    expect(JSON.stringify(await t.api.call('notifications.list', {}))).not.toContain('SECRET-REASON-4471');
    t.as('usr_003');
    expect(JSON.stringify(await t.api.call('notifications.list', {}))).toContain('SECRET-REASON-4471');
  });
});
