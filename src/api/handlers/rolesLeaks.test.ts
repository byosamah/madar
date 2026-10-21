import { beforeEach, describe, expect, it } from 'vitest';
import type { RoleSettings } from '../contract/entities';
import { paymentCalls } from './payments';
import { contentCalls } from './content';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { notificationCalls } from './notifications';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { projectTemplateCalls } from './projectTemplates';
import { reportsCalls } from './reports';
import { rolesCalls } from './roles';
import { trackerCalls } from './tracker';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = {
  ...paymentCalls, ...contentCalls, ...historyCalls, ...insightCalls, ...notificationCalls, ...peopleCalls, ...projectCalls,
  ...projectTemplateCalls, ...reportsCalls, ...rolesCalls, ...trackerCalls,
};

/**
 * The custom roles of the office (owner, 2026-10-18, fbk_014). Cashier holds the payment right, Planner the people right, and
 * Client desk the client right and the template right.
 */
const ROLES: RoleSettings = {
  custom: [
    { id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] },
    { id: 'rol_002', name: 'Planner', nameAr: 'المخطط', rights: ['people.manage'] },
    { id: 'rol_003', name: 'Client desk', nameAr: 'مكتب العملاء', rights: ['clients.manage', 'templates.manageAll'] },
  ],
};

// usr_001 is the Admin, usr_002 leads prj_001, usr_003 is on its team, usr_004 is outside.
// usr_006 is Management and usr_007 is Accounting. usr_011 is a Cashier, usr_012 a Planner, usr_013 a Client desk person.
// usr_015 is an agent of the Planner. usr_018 is an agent of the Admin and usr_019 an agent of Management.
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = structuredClone(ROLES);
  const people = [
    makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' }),
    makeUser('usr_007', { name: 'Noura Accounting', systemRole: 'accounting' }),
    makeUser('usr_011', { name: 'Cashier Person', roleId: 'rol_001' }),
    makeUser('usr_012', { name: 'Planner Person', roleId: 'rol_002' }),
    makeUser('usr_013', { name: 'Client Desk Person', roleId: 'rol_003' }),
    makeUser('usr_015', { name: 'Planner Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_012' }),
    makeUser('usr_018', { name: 'Admin Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_001' }),
    makeUser('usr_019', { name: 'Management Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_006' }),
  ];
  for (const user of people) state.users[user.id] = user;
  state.counters.usr = 19;
  state.counters.rol = 3;
  return t;
}

const NEW = { projectId: 'prj_001', name: 'Concept stage fee', amount: 120000, dueDate: '2026-10-10' };
const PERSON = { name: 'New Member', email: 'new.member@madar.test', discipline: 'MEP' };

/** A small template: an Architect role (default Faisal), two stages, two tasks. */
const draft = (extra: Record<string, unknown> = {}) => ({
  name: 'Villa',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: [], needsReview: true, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 10, durationDays: 5, flexible: false },
  ],
  ...extra,
});

describe('custom roles never leak payments', () => {
  it('shows no amount to a custom role without the payment right, on any read path', async () => {
    const t = world();
    t.as('usr_007');
    const row = await t.api.call('payments.create', { ...NEW, name: 'Zebra milestone', note: 'Zebra note' });
    await t.api.call('payments.update', { id: row.payment.id, patch: { amount: 777777 } });
    await t.api.call('payments.markReceived', { id: row.payment.id });
    await t.api.call('payments.create', { ...NEW, name: 'Zebra milestone', dueDate: '2026-09-01' });

    for (const user of ['usr_012', 'usr_013', 'usr_015']) {
      t.as(user);
      expect(JSON.stringify(await t.api.call('updates.list', { projectId: 'prj_001', filter: 'all' }))).not.toMatch(/payment|Zebra|777777|120000/);
      expect(JSON.stringify(await t.api.call('notifications.list', {}))).not.toMatch(/payment|Zebra/);
      expect(JSON.stringify(await t.api.call('search.query', { text: 'Zebra' }))).not.toMatch(/Zebra/);
      expect(await t.api.call('tracker.list', { projectId: 'prj_001' })).toEqual([]);
      const project = await t.api.call('projects.get', { id: 'prj_001' });
      expect(JSON.stringify(project)).not.toMatch(/payment"|Zebra|777777/);
      expect(project.viewerCan.payments).toBe(false);
      expect((await t.api.call('dashboard.get', {})).money).toBeNull();
      expect(JSON.stringify(await t.api.call('events.list', { limit: 500 }))).not.toMatch(/Zebra|777777/);
      expect(await t.api.call('events.list', { targetType: 'payment' })).toEqual([]);
      await expect(t.api.call('payments.list', { projectId: 'prj_001' })).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('shows the amounts to a custom role with the payment right', async () => {
    const t = world();
    t.as('usr_011');
    await t.api.call('payments.create', NEW);
    expect(await t.api.call('payments.list', { projectId: 'prj_001' })).toHaveLength(1);
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.payments).toBe(true);
    expect((await t.api.call('dashboard.get', {})).money).not.toBeNull();
    expect(await t.api.call('events.list', { targetType: 'payment' })).toHaveLength(1);
  });

  it('gives the screens the rights of the person in the session, so the Dashboard money and the payment reads agree', async () => {
    const t = world();
    t.as('usr_011');
    // The session lists the 112 ids only: the basic switches, plus the switches of the role (role rights version 2).
    const cashier = (await t.api.call('session.get', {})).authority.officeRights ?? [];
    expect(cashier).toEqual(expect.arrayContaining(['payment.view', 'payment.add', 'payment.change', 'payment.receive']));
    expect(cashier).not.toContain('payment.manage');
    expect(cashier).not.toContain('people.invite');
    t.as('usr_012');
    const planner = (await t.api.call('session.get', {})).authority.officeRights ?? [];
    expect(planner).toEqual(expect.arrayContaining(['people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove']));
    expect(planner).not.toContain('payment.view');
  });

  it('takes the payment right from Management when the office settings do not give it', async () => {
    const t = world();
    t.store.state.settings.roles = { ...structuredClone(ROLES), rights: { management: ['people.manage'] } };
    t.as('usr_007');
    await t.api.call('payments.create', NEW);
    t.as('usr_006');
    expect((await t.api.call('dashboard.get', {})).money).toBeNull();
    expect((await t.api.call('projects.get', { id: 'prj_001' })).viewerCan.payments).toBe(false);
    await expect(t.api.call('payments.list', { projectId: 'prj_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('Management without the payment right never sees an amount (fbk_014, security review 2026-10-18)', () => {
  const WITHOUT_PAYMENT: RoleSettings = { rights: { management: ['people.manage', 'report.office'] } };

  /** Every read path for an amount, as one person. Returns the text that a path would show, so a test can search it. */
  async function reads(t: ReturnType<typeof world>, userId: string) {
    t.as(userId);
    const project = await t.api.call('projects.get', { id: 'prj_001' });
    return {
      feed: JSON.stringify(await t.api.call('updates.list', { projectId: 'prj_001', filter: 'all' })),
      notices: JSON.stringify(await t.api.call('notifications.list', {})),
      search: JSON.stringify(await t.api.call('search.query', { text: 'Zebra' })),
      tracker: await t.api.call('tracker.list', { projectId: 'prj_001' }),
      project: JSON.stringify(project),
      viewerPays: project.viewerCan.payments,
      money: (await t.api.call('dashboard.get', {})).money,
      events: JSON.stringify(await t.api.call('events.list', { limit: 500 })),
      paymentEvents: await t.api.call('events.list', { targetType: 'payment' }),
      report: await t.api.call('reports.office', { period: 'year', start: '2026-01-01' }),
    };
  }

  it('shows the amounts to Management while the office gives it the payment right (the control)', async () => {
    const t = world();
    t.as('usr_007');
    await t.api.call('payments.create', { ...NEW, name: 'Zebra milestone', amount: 777777 });
    const seen = await reads(t, 'usr_006');
    expect(seen.viewerPays).toBe(true);
    expect(seen.money).not.toBeNull();
    expect(seen.paymentEvents.length).toBeGreaterThan(0);
    expect(seen.report.money).not.toBeNull();
    expect(await t.api.call('payments.list', { projectId: 'prj_001' })).toHaveLength(1);
  });

  it('shows no amount to Management or to its agent on any read path once the office takes the right away', async () => {
    const t = world();
    t.as('usr_007');
    const row = await t.api.call('payments.create', { ...NEW, name: 'Zebra milestone', note: 'Zebra note' });
    await t.api.call('payments.update', { id: row.payment.id, patch: { amount: 777777 } });
    await t.api.call('payments.markReceived', { id: row.payment.id });
    await t.api.call('payments.create', { ...NEW, name: 'Zebra milestone', dueDate: '2026-09-01' });
    t.store.state.settings.roles = { ...structuredClone(ROLES), ...structuredClone(WITHOUT_PAYMENT) };

    for (const user of ['usr_006', 'usr_019']) {
      const seen = await reads(t, user);
      expect(seen.feed, user).not.toMatch(/payment|Zebra|777777|120000/);
      expect(seen.notices, user).not.toMatch(/payment|Zebra/);
      expect(seen.search, user).not.toMatch(/Zebra/);
      expect(seen.tracker, user).toEqual([]);
      expect(seen.project, user).not.toMatch(/payment"|Zebra|777777/);
      expect(seen.viewerPays, user).toBe(false);
      expect(seen.money, user).toBeNull();
      expect(seen.events, user).not.toMatch(/Zebra|777777/);
      expect(seen.paymentEvents, user).toEqual([]);
      expect(JSON.stringify(seen.report), user).not.toMatch(/Zebra|777777|120000/);
      expect(seen.report.money, user).toBeNull();
      await expect(t.api.call('payments.list', { projectId: 'prj_001' })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(t.api.call('payments.create', NEW)).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('keeps the people right of Management apart from the payment right', async () => {
    const t = world();
    t.store.state.settings.roles = { ...structuredClone(ROLES), rights: { management: ['payment.manage'] } };
    t.as('usr_006');
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { name: 'Renamed' } })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('dashboard.get', {})).money).not.toBeNull();
  });
});

describe('custom roles and the people rights', () => {
  it('lets a custom role with people.manage add a Member and edit a name, but not change a role', async () => {
    const t = world();
    t.as('usr_012');
    const created = await t.api.call('users.create', PERSON);
    expect(created.systemRole).toBe('member');
    expect((await t.api.call('users.update', { id: created.id, patch: { name: 'Renamed Member' } })).name).toBe('Renamed Member');
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'accounting' } })).rejects.toMatchObject({
      code: 'forbidden', details: { reason: 'admin_only' },
    });
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { roleId: 'rol_001' } })).rejects.toMatchObject({
      code: 'forbidden', details: { reason: 'admin_only' },
    });
    await expect(t.api.call('users.create', { ...PERSON, email: 'role.person@madar.test', systemRole: 'accounting' })).rejects.toMatchObject({
      code: 'forbidden', details: { reason: 'admin_only' },
    });
  });

  it('refuses a custom role without people.manage every change to a person', async () => {
    const t = world();
    t.as('usr_013');
    await expect(t.api.call('users.create', PERSON)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { name: 'Renamed' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses Management a role change, and keeps the same role as a plain save', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'accounting' } })).rejects.toMatchObject({
      code: 'forbidden', details: { reason: 'admin_only' },
    });
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { roleId: 'rol_002' } })).rejects.toMatchObject({
      code: 'forbidden', details: { reason: 'admin_only' },
    });
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'member', roleId: null } })).systemRole).toBe('member');
    expect((await t.api.call('users.deactivate', { id: 'usr_004' })).active).toBe(false);
  });

  it('refuses a person with only the people right every role in their own record, and leaves the record as it was', async () => {
    const t = world();
    t.as('usr_012');
    const own = (patch: Record<string, unknown>) => t.api.call('users.update', { id: 'usr_012', patch } as never);
    await expect(own({ roleId: 'rol_001' })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    await expect(own({ roleId: null })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    await expect(own({ systemRole: 'management' })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    await expect(own({ systemRole: 'admin' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.users.usr_012.roleId).toBe('rol_002');
    expect(t.store.state.users.usr_012.systemRole).toBe('member');
    // A plain save of the same values is no change.
    expect((await own({ name: 'Planner Renamed', systemRole: 'member', roleId: 'rol_002' })).name).toBe('Planner Renamed');
  });

  it('refuses Management a role in its own record and in the record of another person', async () => {
    const t = world();
    t.as('usr_006');
    const own = (patch: Record<string, unknown>) => t.api.call('users.update', { id: 'usr_006', patch } as never);
    await expect(own({ systemRole: 'admin' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(own({ systemRole: 'accounting' })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    await expect(own({ roleId: 'rol_001' })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    expect(t.store.state.users.usr_006.systemRole).toBe('management');
    expect(t.store.state.users.usr_006.roleId).toBeUndefined();
  });

  it('never gives a role with more rights than the person holds, in the invitation or in an edit', async () => {
    const t = world();
    t.as('usr_012');
    // The Cashier role holds the payment right, which the Planner lacks.
    await expect(t.api.call('users.create', { ...PERSON, roleId: 'rol_001' })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    await expect(t.api.call('users.create', { ...PERSON, systemRole: 'management' })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    await expect(t.api.call('users.create', { ...PERSON, systemRole: 'admin' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { roleId: 'rol_001' } })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    expect(Object.values(t.store.state.users).some((user) => user.email === PERSON.email)).toBe(false);
    expect(t.store.state.users.usr_003.roleId).toBeUndefined();
    // The invitation of a plain Member goes through.
    expect((await t.api.call('users.create', PERSON)).systemRole).toBe('member');
  });

  it('changes no role through the profile or the preference calls of a person', async () => {
    const t = world();
    t.as('usr_012');
    await t.api.call('me.updateProfile', { name: 'Planner Self', systemRole: 'admin', roleId: 'rol_001' } as never);
    await t.api.call('me.updatePreferences', { language: 'ar', systemRole: 'admin', roleId: 'rol_001' } as never);
    const me = t.store.state.users.usr_012;
    expect(me.name).toBe('Planner Self');
    expect(me.systemRole).toBe('member');
    expect(me.roleId).toBe('rol_002');
  });

  it('lets the Admin give a custom role to a Member, and only to a Member', async () => {
    const t = world();
    t.as('usr_001');
    expect((await t.api.call('users.update', { id: 'usr_003', patch: { roleId: 'rol_002' } })).roleId).toBe('rol_002');
    await expect(t.api.call('users.update', { id: 'usr_006', patch: { roleId: 'rol_001' } })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'role_not_member' },
    });
    await expect(t.api.call('users.update', { id: 'usr_003', patch: { roleId: 'rol_999' } })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'role_missing' },
    });
  });

  it('clears the custom role when the Admin moves a person to another role', async () => {
    const t = world();
    t.as('usr_001');
    expect((await t.api.call('users.update', { id: 'usr_011', patch: { systemRole: 'management' } })).roleId).toBeNull();
  });

  it('lets only the Admin undo a role change, and the Admin undoes it', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'accounting' } });
    const change = (await t.api.call('events.list', { targetId: 'usr_003' })).find((row) => row.event.verb === 'user.updated');
    expect(change).toBeDefined();
    const eventId = change!.event.id;
    // A role change that Management made before this rule. The event names Management as the person who acted, so its undo passes
    // the undo right, and the role rule refuses it.
    t.store.state.events[eventId].actingForId = 'usr_006';
    t.as('usr_006');
    await expect(t.api.call('events.undo', { eventId })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    t.store.state.events[eventId].actingForId = 'usr_001';
    t.as('usr_001');
    await t.api.call('events.undo', { eventId });
    expect(t.store.state.users.usr_003.systemRole).toBe('member');
  });
});

describe('the story Undo of a role change (security review 2026-10-18)', () => {
  it('refuses a person with only the people right the Undo of a story that holds a role change, and changes nothing', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('users.update', { id: 'usr_003', patch: { systemRole: 'accounting' } });
    const change = (await t.api.call('events.list', { targetId: 'usr_003' })).find((row) => row.event.verb === 'user.updated')!.event;
    // A role change that the Planner made before this rule: the event names the Planner, so the Undo right passes and the role rule decides.
    t.store.state.events[change.id].actingForId = 'usr_012';
    t.as('usr_012');
    await expect(t.api.call('events.undoStory', { correlationId: change.correlationId })).rejects.toMatchObject({
      code: 'forbidden', details: { reason: 'admin_only' },
    });
    expect(t.store.state.users.usr_003.systemRole).toBe('accounting');
  });
});

describe('Undo never takes back a role change for an agent (security review 2026-10-18)', () => {
  /**
   * The Admin makes a role that nobody holds (spare), makes a second role, and moves a Member to it. The events come back with the
   * story of each change. Nobody holds the spare role, so only the agent rule can stop the Undo of its creation.
   */
  async function roleChanges(t: ReturnType<typeof world>) {
    t.as('usr_001');
    const spare = await t.api.call('roles.create', { name: 'Spare', nameAr: 'احتياطي', rights: ['report.office'] });
    const held = await t.api.call('roles.create', { name: 'Auditor', nameAr: 'مدقق', rights: ['report.office'] });
    await t.api.call('users.update', { id: 'usr_003', patch: { roleId: held.id } });
    const rows = await t.api.call('events.list', { limit: 100 });
    const made = (id: string) => rows.find((row) => row.event.verb === 'role.created' && row.event.targetId === id)!.event;
    return { spare, held, madeSpare: made(spare.id), moved: rows.find((row) => row.event.verb === 'user.updated')!.event };
  }
  const hasRole = (t: ReturnType<typeof world>, id: string) => t.store.state.settings.roles?.custom?.some((item) => item.id === id);

  it('refuses an agent of the Admin the Undo of the creation of a role, and of the change that moves a person to a role', async () => {
    const t = world();
    const { spare, held, madeSpare, moved } = await roleChanges(t);
    t.as('usr_018');
    await expect(t.api.call('events.undo', { eventId: madeSpare.id })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    await expect(t.api.call('events.undo', { eventId: moved.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(hasRole(t, spare.id)).toBe(true);
    expect(t.store.state.users.usr_003.roleId).toBe(held.id);
    expect(t.store.state.events[madeSpare.id].undoneBy).toBeNull();
  });

  it('refuses an agent of the Admin the Undo of a rights change, also for a built-in role', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('roles.update', { role: 'accounting', rights: ['payment.manage', 'report.office'] });
    const change = (await t.api.call('events.list', { limit: 100 })).find((row) => row.event.verb === 'role.updated')!.event;
    t.as('usr_018');
    await expect(t.api.call('events.undo', { eventId: change.id })).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'admin_only' } });
    expect(t.store.state.settings.roles?.rights?.accounting).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive', 'report.office']);
    t.as('usr_001');
    await t.api.call('events.undo', { eventId: change.id });
    expect(t.store.state.settings.roles?.rights?.accounting).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive']);
  });

  it('refuses an agent of the Admin the Undo of the story of a role change, and leaves the whole story as it was', async () => {
    const t = world();
    const { spare, held, madeSpare, moved } = await roleChanges(t);
    t.as('usr_018');
    for (const event of [madeSpare, moved]) {
      await expect(t.api.call('events.undoStory', { correlationId: event.correlationId })).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect(hasRole(t, spare.id)).toBe(true);
    expect(t.store.state.users.usr_003.roleId).toBe(held.id);
  });

  it('lets the Admin in person undo the same changes, so the refusal is about the agent', async () => {
    const t = world();
    const { spare, held, madeSpare, moved } = await roleChanges(t);
    t.as('usr_001');
    await t.api.call('events.undo', { eventId: moved.id });
    expect(t.store.state.users.usr_003.roleId ?? null).toBeNull();
    await t.api.call('events.undoStory', { correlationId: madeSpare.correlationId });
    expect(hasRole(t, spare.id)).toBe(false);
    expect(hasRole(t, held.id)).toBe(true);
  });
});

describe('custom roles and the office rights of clients and templates', () => {
  it('lets a custom role with the client right change a client, and refuses the others', async () => {
    const t = world();
    t.as('usr_001');
    const client = await t.api.call('clients.create', { name: 'Client A' });
    t.as('usr_013');
    expect((await t.api.call('clients.update', { id: client.id, patch: { contactName: 'Sara' } })).contactName).toBe('Sara');
    t.as('usr_012');
    await expect(t.api.call('clients.update', { id: client.id, patch: { contactName: 'Omar' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_006');
    await expect(t.api.call('clients.update', { id: client.id, patch: { contactName: 'Omar' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets a custom role with the template right change a template of another person', async () => {
    const t = world();
    t.as('usr_001');
    const saved = await t.api.call('projectTemplates.save', draft({ name: 'Villa' }));
    t.as('usr_013');
    expect((await t.api.call('projectTemplates.save', draft({ id: saved.id, name: 'Villa two' }))).name).toBe('Villa two');
    t.as('usr_012');
    await expect(t.api.call('projectTemplates.save', draft({ id: saved.id, name: 'Villa three' }))).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('custom roles and the office report (fbk_016)', () => {
  /** The world, with a Reporter (the report right only) and a Controller (the report right and the payment right). */
  function reportWorld() {
    const t = world();
    const state = t.store.state;
    state.settings.roles = {
      custom: [
        ...(ROLES.custom ?? []),
        { id: 'rol_004', name: 'Reporter', nameAr: 'المراقب', rights: ['report.office'] },
        { id: 'rol_005', name: 'Controller', nameAr: 'المدقق', rights: ['report.office', 'payment.manage'] },
      ],
    };
    state.users.usr_016 = makeUser('usr_016', { name: 'Reporter Person', roleId: 'rol_004' });
    state.users.usr_017 = makeUser('usr_017', { name: 'Controller Person', roleId: 'rol_005' });
    return t;
  }

  it('gives a custom role with the report right only the figures, and no money and no gaps', async () => {
    const t = reportWorld();
    t.as('usr_011');
    await t.api.call('payments.create', { ...NEW, amount: 345678, name: 'Zebra milestone' });
    t.as('usr_016');
    const year = await t.api.call('reports.office', { period: 'year', start: '2026-01-01' });
    const week = await t.api.call('reports.office', { period: 'week', start: '2026-09-28' });
    for (const report of [year, week]) {
      expect(report.money).toBeNull();
      expect(report.gaps).toBeNull();
      expect(JSON.stringify(report)).not.toMatch(/345678|Zebra/);
    }
  });

  it('gives a custom role with the report and the payment rights the money, and still no gaps', async () => {
    const t = reportWorld();
    t.as('usr_011');
    await t.api.call('payments.create', NEW);
    t.as('usr_017');
    const report = await t.api.call('reports.office', { period: 'year', start: '2026-01-01' });
    // The payment is due on 10 October, after today (30 September): due in the year, not past due yet (owner, 2026-10-21).
    expect(report.money).toEqual({ received: 0, dueInPeriod: 120000, pastDueAtEnd: 0 });
    expect(report.gaps).toBeNull();
  });

  it('refuses a custom role with the payment right only, because the report needs the report right', async () => {
    const t = reportWorld();
    t.as('usr_011');
    await expect(t.api.call('reports.office', { period: 'week', start: '2026-09-28' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
