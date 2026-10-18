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
import { trackerCalls } from './tracker';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = {
  ...paymentCalls, ...contentCalls, ...historyCalls, ...insightCalls, ...notificationCalls, ...peopleCalls, ...projectCalls,
  ...projectTemplateCalls, ...trackerCalls,
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
// usr_015 is an agent of the Planner.
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
  ];
  for (const user of people) state.users[user.id] = user;
  state.counters.usr = 15;
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
    expect((await t.api.call('session.get', {})).authority.officeRights).toEqual(['payment.manage']);
    t.as('usr_012');
    expect((await t.api.call('session.get', {})).authority.officeRights).toEqual(['people.manage']);
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
