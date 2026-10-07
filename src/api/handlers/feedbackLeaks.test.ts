import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The leak review of requests and bugs (spec 2026-10-07, section 6, rows 1 to 9 and 16): what a person without the Admin right
 * must never learn of a report. Omar (usr_004) sends a bug report with a screenshot, and Hala (usr_001), the Admin, marks it done.
 * Faisal (usr_002) was an Admin when the report came, so he holds its notice, and then lost the role. Sara (usr_003) is a member
 * who never was an Admin. usr_005 is the agent of Sara, and usr_006 the agent of Faisal.
 */
const ADMIN = 'usr_001';
const FORMER = 'usr_002';
const MEMBER = 'usr_003';
const SENDER = 'usr_004';
const PROBES = [MEMBER, FORMER, 'usr_005', 'usr_006'];
const MESSAGE = 'The fee screen shows the wrong total for the Rashid villa.';
const FORBIDDEN = { code: 'forbidden', message: 'You cannot do this.', details: { action: 'admin.manage' } };

async function world() {
  const t = testApi(calls);
  t.store.state.users.usr_002.systemRole = 'admin';
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Faisal Assistant', kind: 'agent', discipline: 'Agent', ownerId: FORMER });
  t.store.state.counters.usr = 6;
  t.as(SENDER);
  const shot = new Blob(['shot'], { type: 'image/png' });
  const report = await t.api.call('feedback.send', { kind: 'bug', message: MESSAGE, page: '/projects', screenshots: [shot] }, { correlationId: 'cor_send' });
  t.as(ADMIN);
  await t.api.call('feedback.setStatus', { id: report.id, status: 'done' }, { correlationId: 'cor_done' });
  t.store.state.users.usr_002.systemRole = 'member';
  return { t, report };
}

type World = Awaited<ReturnType<typeof world>>;
const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
const error = async (run: () => Promise<unknown>) => {
  try {
    await run();
    return null;
  } catch (e) {
    const { code, message, details } = e as { code: string; message: string; details?: Record<string, unknown> };
    return { code, message, details };
  }
};
const counts = (w: World) => ({ events: Object.keys(w.t.store.state.events).length, notices: Object.keys(w.t.store.state.notifications).length });

describe('rows 1 to 3: the report calls refuse a person without the Admin right, the same way for a real and a fake report', () => {
  it('row 1: feedback.list answers forbidden to a member, a former Admin and their agents', async () => {
    const w = await world();
    for (const userId of PROBES) expect(await as(w, userId, () => error(() => w.t.api.call('feedback.list', {}))), userId).toEqual(FORBIDDEN);
    expect(await as(w, MEMBER, () => error(() => w.t.api.call('feedback.list', { status: 'new' })))).toEqual(FORBIDDEN);
  });

  it('row 2: feedback.screenshot answers the same forbidden for a real and a fake report', async () => {
    const w = await world();
    for (const userId of PROBES) {
      const real = await as(w, userId, () => error(() => w.t.api.call('feedback.screenshot', { id: w.report.id, index: 0 })));
      const fake = await as(w, userId, () => error(() => w.t.api.call('feedback.screenshot', { id: 'fbk_999', index: 0 })));
      expect(real, userId).toEqual(FORBIDDEN);
      expect(fake, userId).toEqual(real);
    }
    // Only an Admin hears that a report does not exist.
    expect(await as(w, ADMIN, () => error(() => w.t.api.call('feedback.screenshot', { id: 'fbk_999', index: 0 })))).toMatchObject({ code: 'not_found' });
  });

  it('row 3: feedback.setStatus answers the same forbidden for a real and a fake report, and writes no change and no notice', async () => {
    const w = await world();
    const before = counts(w);
    for (const userId of PROBES) {
      for (const status of ['new', 'done'] as const) {
        const real = await as(w, userId, () => error(() => w.t.api.call('feedback.setStatus', { id: w.report.id, status })));
        const fake = await as(w, userId, () => error(() => w.t.api.call('feedback.setStatus', { id: 'fbk_999', status })));
        expect(real, userId).toEqual(FORBIDDEN);
        expect(fake, userId).toEqual(real);
      }
    }
    expect(counts(w)).toEqual(before);
  });
});

describe('rows 4 to 6: the History of a report', () => {
  it('row 4: events.list gives nothing of a report, by its target type or by its id', async () => {
    const w = await world();
    for (const userId of PROBES) {
      expect(await as(w, userId, () => w.t.api.call('events.list', { targetType: 'feedback' })), userId).toEqual([]);
      expect(await as(w, userId, () => w.t.api.call('events.list', { targetId: w.report.id })), userId).toEqual([]);
      expect(JSON.stringify(await as(w, userId, () => w.t.api.call('events.list', { limit: 500 }))), userId).not.toContain(MESSAGE);
    }
  });

  it('row 5: events.undo of a report change answers forbidden with no report data', async () => {
    const w = await world();
    const changes = Object.values(w.t.store.state.events).filter((e) => e.targetType === 'feedback');
    expect(changes).toHaveLength(2);
    for (const userId of [...PROBES, SENDER]) {
      for (const change of changes) {
        const answer = await as(w, userId, () => error(() => w.t.api.call('events.undo', { eventId: change.id })));
        expect(answer, userId).toMatchObject({ code: 'forbidden' });
        expect(JSON.stringify(answer)).not.toContain(MESSAGE);
        expect(JSON.stringify(answer)).not.toContain(w.report.id);
      }
    }
    expect(w.t.store.state.feedback?.[w.report.id]?.status).toBe('done');
  });

  it('row 6: events.undoStory of the send answers forbidden, not not_found, with no report data', async () => {
    const w = await world();
    for (const userId of [...PROBES, SENDER]) {
      const answer = await as(w, userId, () => error(() => w.t.api.call('events.undoStory', { correlationId: 'cor_send' })));
      expect(answer, userId).toMatchObject({ code: 'forbidden' });
      expect(JSON.stringify(answer)).not.toContain(MESSAGE);
    }
    expect(w.t.store.state.feedback?.[w.report.id]).toBeDefined();
  });
});

describe('rows 7 to 9: the notices of a report', () => {
  it('row 7: a former Admin sees the new-report notice as gone, with no words, no sender and no place on the bell', async () => {
    const w = await world();
    for (const userId of [FORMER, 'usr_006']) {
      const list = await as(w, userId, () => w.t.api.call('notifications.list', {}));
      const rows = list.filter((view) => view.notification.trigger === 'feedback_sent');
      expect(rows, userId).toHaveLength(1);
      for (const view of rows) {
        expect(view).toMatchObject({ gone: true, target: '', actor: null, link: '', project: null, canApprove: false });
        expect('feedback' in view.notification).toBe(false);
        expect(view.notification.actorId).toBeNull();
      }
      const json = JSON.stringify(list);
      expect(json).not.toContain(MESSAGE.slice(0, 20));
      expect(json).not.toContain(SENDER);
      expect(await as(w, userId, () => w.t.api.call('notifications.count', {})), userId).toEqual({ unread: 1, badge: 0 });
    }
  });

  it('row 8: a member who never was an Admin has no new-report notice', async () => {
    const w = await world();
    for (const userId of [MEMBER, 'usr_005']) {
      const list = await as(w, userId, () => w.t.api.call('notifications.list', {}));
      expect(list.filter((view) => view.notification.targetType === 'feedback'), userId).toEqual([]);
      expect(JSON.stringify(list)).not.toContain(MESSAGE.slice(0, 20));
    }
  });

  it('row 9: notifications.markRead of the notice of an Admin answers forbidden with no content', async () => {
    const w = await world();
    const notice = Object.values(w.t.store.state.notifications).find((n) => n.userId === ADMIN && n.trigger === 'feedback_sent')!;
    expect(notice).toBeDefined();
    for (const userId of PROBES) {
      const answer = await as(w, userId, () => error(() => w.t.api.call('notifications.markRead', { ids: [notice.id] })));
      expect(answer, userId).toEqual({ code: 'forbidden', message: 'This notification belongs to someone else.', details: {} });
    }
    expect(w.t.store.state.notifications[notice.id].read).toBe(false);
  });
});

describe('row 16: an Undo of a send never changes the list or the count of a former Admin', () => {
  it('keeps the hidden notice of the former Admin, and takes back the notice of an Admin', async () => {
    // Only an Admin may take back a send, so Hala sends. Faisal and Omar are Admins too, and Faisal then loses the role.
    const t = testApi(calls);
    t.store.state.users.usr_002.systemRole = 'admin';
    t.store.state.users.usr_004.systemRole = 'admin';
    t.as(ADMIN);
    await t.api.call('feedback.send', { kind: 'feature', message: MESSAGE, page: '/projects', screenshots: [] }, { correlationId: 'cor_admin' });
    const held = Object.values(t.store.state.notifications).filter((n) => n.trigger === 'feedback_sent');
    expect(held.map((n) => n.userId).sort()).toEqual([FORMER, 'usr_004']);
    t.store.state.users.usr_002.systemRole = 'member';
    t.as(FORMER);
    const list = await t.api.call('notifications.list', {});
    const count = await t.api.call('notifications.count', {});
    t.as(ADMIN);
    await t.api.call('events.undoStory', { correlationId: 'cor_admin' });
    const left = Object.values(t.store.state.notifications).filter((n) => n.trigger === 'feedback_sent');
    expect(left.map((n) => n.userId)).toEqual([FORMER]);
    t.as(FORMER);
    expect(await t.api.call('notifications.list', {})).toEqual(list);
    expect(await t.api.call('notifications.count', {})).toEqual(count);
  });
});
