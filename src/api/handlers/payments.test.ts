import { beforeEach, describe, expect, it } from 'vitest';
import { paymentCalls } from './payments';
import { contentCalls } from './content';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { notificationCalls } from './notifications';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { trackerCalls } from './tracker';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...paymentCalls, ...contentCalls, ...historyCalls, ...insightCalls, ...notificationCalls, ...peopleCalls, ...projectCalls, ...trackerCalls };

// usr_001 is the Admin, usr_002 leads prj_001, usr_003 is on its team, usr_004 is outside, usr_005 is the agent of usr_003.
// usr_006 is Management, usr_007 is Accounting, usr_008 is an agent of usr_007, usr_009 is an agent of usr_006, usr_010 is an agent of usr_002 (the leader).
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  const people = [
    makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' }),
    makeUser('usr_007', { name: 'Noura Accounting', systemRole: 'accounting' }),
    makeUser('usr_008', { name: 'Accounts Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_007' }),
    makeUser('usr_009', { name: 'Management Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_006' }),
    makeUser('usr_010', { name: 'Leader Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' }),
  ];
  for (const user of people) state.users[user.id] = user;
  state.counters.usr = 10;
  return t;
}

const NEW = { projectId: 'prj_001', name: 'Concept stage fee', amount: 120000, dueDate: '2026-10-10' };
const ALLOWED = ['usr_001', 'usr_006', 'usr_007', 'usr_008', 'usr_009'];
// A member, the leader of the project, an outsider, the agent of a member and the agent of the leader.
const REFUSED = ['usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_010'];

describe('who may use the payment calls', () => {
  it('lets the Admin, Management, Accounting and their agents use every call', async () => {
    for (const user of ALLOWED) {
      const t = world();
      t.as('usr_007');
      const row = await t.api.call('payments.create', NEW);
      t.as(user);
      expect(await t.api.call('payments.list', { projectId: 'prj_001' })).toHaveLength(1);
      const created = await t.api.call('payments.create', { ...NEW, name: 'Second fee' });
      expect(created.payment.createdBy).toBe(user);
      const updated = await t.api.call('payments.update', { id: row.payment.id, patch: { amount: 99000 } });
      expect(updated.payment.amount).toBe(99000);
      expect((await t.api.call('payments.markReceived', { id: row.payment.id })).status).toBe('received');
      expect(await t.api.call('payments.delete', { id: row.payment.id })).toEqual({ deleted: true });
    }
  });

  it('refuses every call to a member, the project leader, an outsider and the agent of a member', async () => {
    for (const user of REFUSED) {
      const t = world();
      t.as('usr_007');
      const row = await t.api.call('payments.create', NEW);
      t.as(user);
      const attempts = [
        t.api.call('payments.list', { projectId: 'prj_001' }),
        t.api.call('payments.create', NEW),
        t.api.call('payments.update', { id: row.payment.id, patch: { amount: 1 } }),
        t.api.call('payments.markReceived', { id: row.payment.id }),
        t.api.call('payments.delete', { id: row.payment.id }),
      ];
      for (const attempt of attempts) await expect(attempt).rejects.toMatchObject({ code: 'forbidden' });
      expect(Object.keys(t.store.state.payments ?? {})).toEqual([row.payment.id]);
      expect(t.store.state.payments?.[row.payment.id].amount).toBe(120000);
    }
  });

  it('refuses an inactive person with the right', async () => {
    const t = world();
    t.store.state.users.usr_007.active = false;
    t.as('usr_007');
    await expect(t.api.call('payments.list', { projectId: 'prj_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('payments.create and payments.update', () => {
  it('saves the milestone, and computes its state from today (30 Sep 2026)', async () => {
    const t = world();
    t.as('usr_007');
    const awaiting = await t.api.call('payments.create', { ...NEW, name: '  Concept stage fee  ', note: 'Invoice 14' });
    expect(awaiting).toMatchObject({
      status: 'awaiting', dueInDays: 10, createdBy: { id: 'usr_007' },
      payment: { id: 'pay_001', projectId: 'prj_001', name: 'Concept stage fee', amount: 120000, dueDate: '2026-10-10', receivedOn: null, note: 'Invoice 14', createdBy: 'usr_007' },
    });
    const overdue = await t.api.call('payments.create', { ...NEW, dueDate: '2026-09-20' });
    expect(overdue).toMatchObject({ status: 'overdue', dueInDays: -10 });
    const received = await t.api.call('payments.create', { ...NEW, dueDate: '2026-09-20', receivedOn: '2026-09-25' });
    expect(received.status).toBe('received');
    // The list is in due date order.
    expect((await t.api.call('payments.list', { projectId: 'prj_001' })).map((r) => r.payment.dueDate)).toEqual(['2026-09-20', '2026-09-20', '2026-10-10']);
  });

  it('refuses a bad name, a bad amount, a received date in the future and an unknown project', async () => {
    const t = world();
    t.as('usr_007');
    await expect(t.api.call('payments.create', { ...NEW, name: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('payments.create', { ...NEW, name: 'x'.repeat(121) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('payments.create', { ...NEW, amount: 0 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('payments.create', { ...NEW, amount: -5 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('payments.create', { ...NEW, note: 'x'.repeat(501) })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('payments.create', { ...NEW, receivedOn: '2026-10-05' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['receivedOn'] } });
    await expect(t.api.call('payments.create', { ...NEW, projectId: 'prj_099' })).rejects.toMatchObject({ code: 'not_found' });
    expect(Object.keys(t.store.state.payments ?? {})).toEqual([]);
  });

  it('edits some fields and clears the received date', async () => {
    const t = world();
    t.as('usr_007');
    const row = await t.api.call('payments.create', { ...NEW, receivedOn: '2026-09-29' });
    const edited = await t.api.call('payments.update', { id: row.payment.id, patch: { name: 'Concept fee', note: 'Paid by transfer', receivedOn: null } });
    expect(edited.payment).toMatchObject({ name: 'Concept fee', note: 'Paid by transfer', receivedOn: null, amount: 120000 });
    expect(edited.status).toBe('awaiting');
    await expect(t.api.call('payments.update', { id: row.payment.id, patch: { receivedOn: '2026-12-01' } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('payments.update', { id: 'pay_099', patch: { name: 'x' } })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('payments.markReceived', () => {
  it('defaults to today, takes a day, and refuses a second time', async () => {
    const t = world();
    t.as('usr_007');
    const a = await t.api.call('payments.create', NEW);
    const b = await t.api.call('payments.create', NEW);
    expect((await t.api.call('payments.markReceived', { id: a.payment.id })).payment.receivedOn).toBe('2026-09-30');
    expect((await t.api.call('payments.markReceived', { id: b.payment.id, receivedOn: '2026-09-28' })).payment.receivedOn).toBe('2026-09-28');
    await expect(t.api.call('payments.markReceived', { id: a.payment.id })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('payments.markReceived', { id: b.payment.id, receivedOn: '2026-10-02' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('undo', () => {
  it('brings back a deleted payment, and undoes a received mark and a create', async () => {
    const t = world();
    t.as('usr_007');
    const row = await t.api.call('payments.create', NEW);
    await t.api.call('payments.markReceived', { id: row.payment.id }, { correlationId: 'story_received' });
    await t.api.call('events.undoStory', { correlationId: 'story_received' });
    expect(t.store.state.payments?.[row.payment.id].receivedOn).toBeNull();
    await t.api.call('payments.delete', { id: row.payment.id }, { correlationId: 'story_delete' });
    expect(t.store.state.payments?.[row.payment.id]).toBeUndefined();
    await t.api.call('events.undoStory', { correlationId: 'story_delete' });
    expect(t.store.state.payments?.[row.payment.id]).toMatchObject({ name: 'Concept stage fee', amount: 120000, projectId: 'prj_001' });
  });

  it('refuses an undo of a payment change to a person without the right', async () => {
    const t = world();
    t.as('usr_007');
    const row = await t.api.call('payments.create', NEW);
    const [event] = await t.api.call('events.list', { targetType: 'payment' });
    expect(event.event.targetId).toBe(row.payment.id);
    // The Admin sees the event. A member does not, and cannot undo it.
    t.as('usr_001');
    expect(await t.api.call('events.list', { targetType: 'payment' })).toHaveLength(1);
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: event.event.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the Accounting person an undo after losing the right', async () => {
    const t = world();
    t.as('usr_007');
    const row = await t.api.call('payments.create', NEW);
    await t.api.call('payments.delete', { id: row.payment.id });
    const [event] = await t.api.call('events.list', { targetType: 'payment', limit: 1 });
    t.store.state.users.usr_007.systemRole = 'member';
    await expect(t.api.call('events.undo', { eventId: event.event.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('payments never leak', () => {
  it('stays out of the feed, the events, the notices, the search, the Tracker and the dashboard for a member', async () => {
    const t = world();
    t.as('usr_003');
    const before = {
      dashboard: await t.api.call('dashboard.get', {}),
      project: (await t.api.call('projects.get', { id: 'prj_001' })).project.updatedAt,
    };
    t.as('usr_007');
    const row = await t.api.call('payments.create', { ...NEW, name: 'Zebra milestone', note: 'Zebra note' });
    await t.api.call('payments.update', { id: row.payment.id, patch: { amount: 777777 } });
    await t.api.call('payments.markReceived', { id: row.payment.id });
    await t.api.call('payments.delete', { id: row.payment.id });
    await t.api.call('payments.create', { ...NEW, name: 'Zebra milestone', dueDate: '2026-09-01' });

    for (const user of ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005']) {
      t.as(user);
      const feed = await t.api.call('updates.list', { projectId: 'prj_001', filter: 'all' });
      expect(JSON.stringify(feed)).not.toMatch(/payment|Zebra|777777|120000/);
      expect(JSON.stringify(await t.api.call('notifications.list', {}))).not.toMatch(/payment|Zebra/);
      expect(JSON.stringify(await t.api.call('search.query', { text: 'Zebra' }))).not.toMatch(/Zebra/);
      expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toEqual([]);
      expect(JSON.stringify(await t.api.call('projects.get', { id: 'prj_001' }))).not.toMatch(/payment"|Zebra|777777/);
    }
    t.as('usr_003');
    expect((await t.api.call('projects.get', { id: 'prj_001' })).project.updatedAt).toBe(before.project);
    expect(await t.api.call('dashboard.get', {})).toEqual(before.dashboard);
    for (const user of ['usr_002', 'usr_003', 'usr_004', 'usr_005']) {
      t.as(user);
      const all = await t.api.call('events.list', { limit: 500 });
      expect(all.filter((e) => e.event.targetType === 'payment')).toEqual([]);
      expect(JSON.stringify(all)).not.toMatch(/Zebra|777777/);
      expect(await t.api.call('events.list', { targetType: 'payment' })).toEqual([]);
      expect(await t.api.call('events.list', { targetId: row.payment.id })).toEqual([]);
    }
  });

  it('shows the payment events to the Admin, Management and Accounting', async () => {
    const t = world();
    t.as('usr_007');
    await t.api.call('payments.create', NEW);
    for (const user of ['usr_001', 'usr_006', 'usr_007']) {
      t.as(user);
      expect(await t.api.call('events.list', { targetType: 'payment' })).toHaveLength(1);
    }
  });

  it('tells a member nothing through the viewer rights, and tells the three roles yes', async () => {
    const t = world();
    for (const [user, expected] of [['usr_001', true], ['usr_006', true], ['usr_007', true], ['usr_002', false], ['usr_003', false], ['usr_004', false], ['usr_005', false]] as const) {
      t.as(user);
      expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.payments).toBe(expected);
    }
  });

  it('removes the payments of a project with the project', async () => {
    const t = world();
    t.as('usr_007');
    await t.api.call('payments.create', NEW);
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    expect(Object.keys(t.store.state.payments ?? {})).toEqual([]);
  });
});
