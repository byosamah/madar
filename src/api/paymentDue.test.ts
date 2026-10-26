import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from './calls';
import { ACTION_TRIGGERS } from './handlers/notifications';
import { COPY_TRIGGERS } from './adminCopies';
import { IN_APP_ONLY_TRIGGERS, TRIGGERS, defaultPreferences, isEmailTrigger, Notification, type Payment } from './contract/entities';
import { emailOn, runScheduledTriggers, visibleTriggers } from './notify';
import { withRights } from './rights';
import type { State } from './store';
import { setNow } from '../lib/dates';
import { makeProject, makeUser, makeWorld, NOW, STAMP, testApi } from '../test/factories';

/**
 * The due notice of a payment (the Daftra link, owner 2026-10-26). NOW is 2026-09-30 in Riyadh. prj_001 is open (leader usr_002, team
 * usr_003). usr_001 is the Admin, usr_004 a Member on no team, usr_005 the agent of usr_003.
 *   usr_006 Accounting     usr_007 Management        usr_008 Accounting, turned off     usr_009 the agent of usr_006
 *   usr_010 a Member whose custom role holds only "See payments" (no Daftra switch)
 *   usr_011 a Member whose custom role holds the two switches
 */
const DAY = '2026-09-30';

function world(): State {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Noura Accounting', systemRole: 'accounting' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Turki Management', systemRole: 'management' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Gone Accounting', systemRole: 'accounting', active: false });
  state.users.usr_009 = makeUser('usr_009', { name: 'Accounting Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_006', systemRole: 'accounting' });
  state.users.usr_010 = makeUser('usr_010', { name: 'View Only', systemRole: 'accounting' });
  state.users.usr_011 = makeUser('usr_011', { name: 'Custom Cashier', roleId: 'rol_001' });
  state.settings.roles = {
    custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.view', 'payment.daftraLink'], off: [] }],
  };
  state.counters.usr = 11;
  state.payments = { pay_001: payment() };
  return state;
}

function payment(extra: Partial<Payment> = {}): Payment {
  return {
    id: 'pay_001', projectId: 'prj_001', name: 'Payment 2', amount: 12500, dueDate: DAY, receivedOn: null, note: '', createdBy: 'usr_001', createdAt: STAMP, ...extra,
  };
}

const due = (state: State) => Object.values(state.notifications).filter((n) => n.trigger === 'payment_due');
const people = (state: State) => due(state).map((n) => n.userId).sort();

let state: State;
beforeEach(() => {
  setNow(NOW);
  state = world();
  // usr_010 holds "See payments" and not the Daftra link: a stored list for the built-in role cannot do that for one person, so the
  // test gives that person a custom role.
  state.users.usr_010.systemRole = 'member';
  state.users.usr_010.roleId = 'rol_002';
  state.settings.roles!.custom!.push({ id: 'rol_002', name: 'Viewer', nameAr: 'مطلع', rights: ['payment.view'], off: [] });
});

describe('the trigger payment_due', () => {
  it('is in the list, stays in the app with no email, counts on the bell, and makes no copy for the Admin', () => {
    expect(TRIGGERS).toContain('payment_due');
    expect([...IN_APP_ONLY_TRIGGERS]).toContain('payment_due');
    expect(isEmailTrigger('payment_due')).toBe(false);
    expect(emailOn({ ...defaultPreferences(), email: { payment_due: true } }, 'payment_due')).toBe(false);
    expect(ACTION_TRIGGERS.has('payment_due')).toBe(true);
    expect(COPY_TRIGGERS.has('payment_due')).toBe(false);
  });
});

describe('who gets the notice on the due day', () => {
  it('tells Accounting and a custom role that holds the two switches, with the full notice', () => {
    expect(runScheduledTriggers(state, NOW)).toBe(2);
    expect(people(state)).toEqual(['usr_006', 'usr_011']);
    const mine = due(state).find((n) => n.userId === 'usr_006')!;
    expect(mine).toMatchObject({
      trigger: 'payment_due', actorId: null, targetType: 'project', targetId: 'prj_001', read: false, dueDate: DAY,
      payment: { id: 'pay_001', name: 'Payment 2' }, dedupeKey: `payment_due:pay_001:${DAY}:usr_006`,
    });
    expect(Notification.safeParse(mine).success).toBe(true);
  });

  it('tells nobody twice: a second run, and a run with the lookup of the used keys, make none', () => {
    expect(runScheduledTriggers(state, NOW)).toBe(2);
    expect(runScheduledTriggers(state, NOW)).toBe(0);
    const other = world();
    expect(runScheduledTriggers(other, NOW, { dedupeUsed: () => true })).toBe(0);
  });

  it('tells nobody when no person holds the two switches (the Admin gets no copy)', () => {
    state.settings.roles = { rights: { accounting: [] } };
    state.users.usr_011.roleId = undefined;
    expect(runScheduledTriggers(state, NOW)).toBe(0);
    expect(due(state)).toEqual([]);
  });

  it('keeps the person out who turned the switch off', () => {
    state.users.usr_006.preferences.notifications.payment_due = false;
    runScheduledTriggers(state, NOW);
    expect(people(state)).toEqual(['usr_011']);
  });
});

describe('leaks: who gets no notice', () => {
  it('tells no Admin, no Management (no Daftra switch by default), no Member without "See payments", no agent and no turned-off person', () => {
    runScheduledTriggers(state, NOW);
    const got = people(state);
    for (const userId of ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_005', 'usr_007', 'usr_008', 'usr_009', 'usr_010']) expect(got, userId).not.toContain(userId);
  });

  it('tells the Admin nothing even when Management is given the switch and the Admin is the only other holder', () => {
    state.settings.roles = { rights: { management: ['payment.view', 'payment.daftraLink'] }, custom: state.settings.roles!.custom };
    runScheduledTriggers(state, NOW);
    expect(people(state)).toEqual(['usr_006', 'usr_007', 'usr_011']);
    expect(people(state)).not.toContain('usr_001');
  });

  it('tells no one who may not view the project (a hidden project that the person was not chosen for)', () => {
    state.projects.prj_001.access = { hidden: true, viewerIds: ['usr_011'] };
    runScheduledTriggers(state, NOW);
    expect(people(state)).toEqual(['usr_011']);
  });

  it('tells a person of the notice nothing about the payment when the person left the notice list: no field of another person leaks', () => {
    runScheduledTriggers(state, NOW);
    for (const n of due(state)) expect(JSON.stringify(n)).not.toMatch(/daftra/i);
  });
});

describe('which payments give a notice', () => {
  it('sends only on the due day: not the day before, not the day after (a payment that is already past due on the release day gets none)', () => {
    state.payments!.pay_001.dueDate = '2026-10-01';
    expect(runScheduledTriggers(state, NOW)).toBe(0);
    state.payments!.pay_001.dueDate = '2026-09-29';
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });

  it('uses the office day near midnight', () => {
    // 23:30 UTC on 2026-09-29 is 02:30 on 2026-09-30 in Riyadh.
    expect(runScheduledTriggers(state, new Date('2026-09-29T23:30:00Z'))).toBe(2);
    expect(runScheduledTriggers(state, new Date('2026-09-29T20:59:00Z'))).toBe(0);
  });

  it('skips a payment that is received, and a payment that has a Daftra link', () => {
    state.payments!.pay_001.receivedOn = DAY;
    expect(runScheduledTriggers(state, NOW)).toBe(0);
    state.payments!.pay_001 = payment({ daftra: { invoiceId: '1', invoiceNo: '000001', total: 12500, issuedOn: DAY, linkedBy: 'usr_006', linkedAt: STAMP } });
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });

  it('skips a payment of an internal project', () => {
    state.projects.prj_001 = makeProject({ kind: 'internal' });
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });

  it('skips a payment whose project is gone', () => {
    state.payments!.pay_001.projectId = 'prj_099';
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });

  it('tells again when the due day moves to a new day, and one notice for each payment', () => {
    runScheduledTriggers(state, NOW);
    expect(due(state)).toHaveLength(2);
    state.payments!.pay_001.dueDate = '2026-10-02';
    expect(runScheduledTriggers(state, new Date('2026-10-02T06:00:00Z'))).toBe(2);
    state.payments!.pay_002 = payment({ id: 'pay_002', name: 'Payment 3', dueDate: '2026-10-02' });
    expect(runScheduledTriggers(state, new Date('2026-10-02T06:00:00Z'))).toBe(2);
    expect(due(state)).toHaveLength(6);
  });

  it('works for an old state that has no payments list', () => {
    delete state.payments;
    expect(runScheduledTriggers(state, NOW)).toBe(0);
  });
});

describe('Settings shows the switch only to a person who gets the notice', () => {
  it('shows it to Accounting and to the custom role, and hides it from the Admin, Management and a Member', () => {
    const shown = (userId: string) => visibleTriggers(withRights(state, state.users[userId])).includes('payment_due');
    expect(shown('usr_006')).toBe(true);
    expect(shown('usr_011')).toBe(true);
    for (const userId of ['usr_001', 'usr_007', 'usr_004', 'usr_010']) expect(shown(userId), userId).toBe(false);
  });
});

describe('the notice in the list of the bell', () => {
  function bell() {
    const t = testApi(calls, state);
    runScheduledTriggers(t.store.state, NOW);
    return t;
  }

  it('opens the money panel of the payment, names the project, and counts on the badge', async () => {
    const t = bell();
    t.as('usr_006');
    const [view] = (await t.api.call('notifications.list', {})).filter((v) => v.notification.trigger === 'payment_due');
    expect(view).toMatchObject({
      link: '/projects/prj_001?payment=pay_001', gone: false, needsAction: true, dueDate: DAY, target: 'Test Tower',
      notification: { payment: { id: 'pay_001', name: 'Payment 2' } },
    });
    expect(await t.api.call('notifications.count', {})).toEqual({ unread: 1, badge: 1 });
  });

  it('reads as gone, with no payment, no day, no link and no project, once the person loses "See payments"', async () => {
    const t = bell();
    t.store.state.settings.roles = { rights: { accounting: ['payment.daftraLink'] } };
    t.as('usr_006');
    const [view] = (await t.api.call('notifications.list', {})).filter((v) => v.notification.trigger === 'payment_due');
    expect(view.gone).toBe(true);
    expect(view.link).toBe('/notifications');
    expect(view.target).toBe('');
    expect(view.project).toBeNull();
    expect(view.dueDate).toBeNull();
    expect(view.notification.payment).toBeUndefined();
    expect(view.notification.targetId).toBe('hidden');
    expect(JSON.stringify(view)).not.toContain('Payment 2');
    expect(JSON.stringify(view)).not.toContain('pay_001');
    expect((await t.api.call('notifications.count', {})).badge).toBe(0);
  });

  it('reads as gone when the person may no longer view the project', async () => {
    const t = bell();
    t.store.state.projects.prj_001.access = { hidden: true, viewerIds: [] };
    t.as('usr_006');
    const [view] = (await t.api.call('notifications.list', {})).filter((v) => v.notification.trigger === 'payment_due');
    expect(view.gone).toBe(true);
    expect(JSON.stringify(view)).not.toContain('Payment 2');
  });
});
