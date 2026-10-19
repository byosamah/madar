import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../../lib/dates';
import { makeUser, NOW, testApi } from '../../test/factories';
import type { Event } from '../contract/entities';
import { historyCalls } from './history';
import { peopleCalls } from './people';
import { rolesCalls } from './roles';

beforeEach(() => setNow(NOW));

const calls = { ...peopleCalls, ...historyCalls, ...rolesCalls };

/**
 * The Admin is usr_001. Turki manages people, Noura is a Member with no custom role, and Cashier Person holds the custom role
 * rol_001 (the payment right). The counter of roles starts at 1, so the next new role is rol_002.
 */
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  for (const user of [
    makeUser('usr_005', { name: 'Noura Member' }),
    makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' }),
    makeUser('usr_011', { name: 'Cashier Person', roleId: 'rol_001' }),
  ]) state.users[user.id] = user;
  state.counters.usr = 15;
  state.counters.rol = 1;
  state.settings.roles = { custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] }] };
  t.as('usr_001');
  return t;
}

/** The change events of the roles, newest last. */
function roleEvents(t: ReturnType<typeof world>, verb?: string): Event[] {
  return Object.values(t.store.state.events)
    .filter((event) => event.targetType === 'settings' && (verb === undefined || event.verb === verb))
    .sort((a, b) => a.seq - b.seq);
}

describe('roles.create', () => {
  it('makes a custom role with its names, and its rights in the order of the rights list', async () => {
    const t = world();
    const role = await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: ['clients.manage', 'people.manage'] });
    expect(role).toEqual({ id: 'rol_002', name: 'Site lead', nameAr: 'مسؤول الموقع', rights: ['people.manage', 'clients.manage'] });
    expect(t.store.state.settings.roles?.custom?.map((item) => item.id)).toEqual(['rol_001', 'rol_002']);
    expect(roleEvents(t, 'role.created')).toMatchObject([{ projectId: null, targetType: 'settings', targetId: 'rol_002', before: null }]);
  });

  it('refuses a name that another custom role has, in English or in Arabic, with no change', async () => {
    const t = world();
    await expect(t.api.call('roles.create', { name: 'cashier', nameAr: 'دور جديد', rights: [] }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_name_taken', fields: ['name'] } });
    await expect(t.api.call('roles.create', { name: 'Other', nameAr: 'أمين الصندوق', rights: [] }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_name_taken', fields: ['nameAr'] } });
    expect(t.store.state.settings.roles?.custom).toHaveLength(1);
    expect(roleEvents(t, 'role.created')).toEqual([]);
  });

  it('refuses the twenty-first custom role', async () => {
    const t = world();
    t.store.state.settings.roles = {
      custom: Array.from({ length: 20 }, (_, index) => ({ id: `rol_${String(index + 1).padStart(3, '0')}`, name: `Role ${index}`, nameAr: `دور ${index}`, rights: [] })),
    };
    await expect(t.api.call('roles.create', { name: 'Extra', nameAr: 'إضافي', rights: [] }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_limit' } });
  });

  it('lets only the Admin make a role: Management and a Member get forbidden', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول', rights: [] })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_005');
    await expect(t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول', rights: [] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.settings.roles?.custom).toHaveLength(1);
  });
});

describe('roles.update', () => {
  it('changes the rights of a built-in role, and records the old and the new rights in one event', async () => {
    const t = world();
    const roles = await t.api.call('roles.update', { role: 'management', rights: ['payment.manage'] });
    expect(roles.rights?.management).toEqual(['payment.manage']);
    expect(roleEvents(t, 'role.updated')).toMatchObject([
      { targetId: 'management', before: { rights: ['people.manage', 'payment.manage', 'report.office'] }, after: { rights: ['payment.manage'] } },
    ]);
  });

  it('writes no event when the rights of a built-in role stay the same', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'management', rights: ['people.manage', 'payment.manage', 'report.office'] });
    expect(roleEvents(t, 'role.updated')).toEqual([]);
  });

  it('refuses a name for a built-in role', async () => {
    const t = world();
    await expect(t.api.call('roles.update', { role: 'accounting', name: 'Cash desk' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'built_in_name' } });
  });

  it('renames a custom role, and refuses a name that another custom role has', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: [] });
    const renamed = await t.api.call('roles.update', { role: 'rol_001', name: 'Cash desk' });
    expect(renamed.custom?.[0]).toMatchObject({ id: 'rol_001', name: 'Cash desk', nameAr: 'أمين الصندوق' });
    await expect(t.api.call('roles.update', { role: 'rol_002', name: 'cash DESK' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_name_taken' } });
  });

  it('refuses a role that does not exist', async () => {
    const t = world();
    await expect(t.api.call('roles.update', { role: 'rol_099', name: 'Ghost', nameAr: 'شبح' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_missing' } });
  });

  it('lets only the Admin change the rights of a role', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('roles.update', { role: 'member', rights: ['people.manage'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.settings.roles?.rights).toBeUndefined();
  });
});

describe('roles.delete', () => {
  it('deletes a custom role that no person holds, and writes one event', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: [] });
    expect(await t.api.call('roles.delete', { id: 'rol_002' })).toEqual({});
    expect(t.store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']);
    expect(roleEvents(t, 'role.deleted')).toMatchObject([{ targetId: 'rol_002', after: null }]);
  });

  it('refuses a role that people hold, and gives the count of those people', async () => {
    const t = world();
    await expect(t.api.call('roles.delete', { id: 'rol_001' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_in_use', count: 1 } });
    expect(t.store.state.settings.roles?.custom).toHaveLength(1);
  });

  it('moves the people of the role to the role that the Admin names, and one Undo of the story brings the role and the people back (ADM-14)', async () => {
    const t = world();
    const holder = Object.values(t.store.state.users).find((user) => user.roleId === 'rol_001')!;
    await t.api.call('roles.delete', { id: 'rol_001', moveTo: 'member' }, { correlationId: 'cor_move' });
    expect(t.store.state.settings.roles?.custom ?? []).toEqual([]);
    expect(t.store.state.users[holder.id]).toMatchObject({ systemRole: 'member', roleId: null });
    await t.api.call('events.undoStory', { correlationId: 'cor_move' });
    expect(t.store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']);
    expect(t.store.state.users[holder.id].roleId).toBe('rol_001');
  });

  it('moves the people to another custom role, and refuses a role that is gone or the role itself', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: [] });
    const holder = Object.values(t.store.state.users).find((user) => user.roleId === 'rol_001')!;
    await expect(t.api.call('roles.delete', { id: 'rol_001', moveTo: 'rol_001' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_missing' } });
    await expect(t.api.call('roles.delete', { id: 'rol_001', moveTo: 'rol_009' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_missing' } });
    await t.api.call('roles.delete', { id: 'rol_001', moveTo: 'rol_002' });
    expect(t.store.state.users[holder.id]).toMatchObject({ systemRole: 'member', roleId: 'rol_002' });
  });

  it('moves the people to a built-in role such as Accounting', async () => {
    const t = world();
    const holder = Object.values(t.store.state.users).find((user) => user.roleId === 'rol_001')!;
    await t.api.call('roles.delete', { id: 'rol_001', moveTo: 'accounting' });
    expect(t.store.state.users[holder.id]).toMatchObject({ systemRole: 'accounting', roleId: null });
  });

  it('deletes a role that a removed person once held, because no list shows that person to move', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: [] });
    await t.api.call('users.update', { id: 'usr_005', patch: { roleId: 'rol_002' } });
    await t.api.call('users.deactivate', { id: 'usr_005' });
    await t.api.call('users.remove', { id: 'usr_005' });
    expect(await t.api.call('roles.delete', { id: 'rol_002' })).toEqual({});
    expect(t.store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']);
  });

  it('still refuses a role that a turned-off person holds, because the Admin can still move that person', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: [] });
    await t.api.call('users.update', { id: 'usr_005', patch: { roleId: 'rol_002' } });
    await t.api.call('users.deactivate', { id: 'usr_005' });
    await expect(t.api.call('roles.delete', { id: 'rol_002' }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'role_in_use', count: 1 } });
    expect(t.store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001', 'rol_002']);
  });
});

describe('the Undo of a role change', () => {
  function eventOf(t: ReturnType<typeof world>, verb: string): Event {
    const event = roleEvents(t, verb).at(-1);
    if (!event) throw new Error(`no ${verb} event`);
    return event;
  }

  it('takes back a new role', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: [] });
    await t.api.call('events.undo', { eventId: eventOf(t, 'role.created').id });
    expect(t.store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']);
    expect(eventOf(t, 'role.created').undoneBy).not.toBeNull();
  });

  it('brings back a deleted role, as it was', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: ['clients.manage'] });
    const before = structuredClone(t.store.state.settings.roles?.custom?.[1]);
    await t.api.call('roles.delete', { id: 'rol_002' });
    await t.api.call('events.undo', { eventId: eventOf(t, 'role.deleted').id });
    expect(t.store.state.settings.roles?.custom?.[1]).toEqual(before);
  });

  it('takes back a new role that a removed person once held', async () => {
    const t = world();
    await t.api.call('roles.create', { name: 'Site lead', nameAr: 'مسؤول الموقع', rights: [] });
    await t.api.call('users.update', { id: 'usr_005', patch: { roleId: 'rol_002' } });
    await t.api.call('users.deactivate', { id: 'usr_005' });
    await t.api.call('users.remove', { id: 'usr_005' });
    await t.api.call('events.undo', { eventId: eventOf(t, 'role.created').id });
    expect(t.store.state.settings.roles?.custom?.map((role) => role.id)).toEqual(['rol_001']);
    expect(eventOf(t, 'role.created').undoneBy).not.toBeNull();
  });

  it('takes back a changed built-in right to the rights it had', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'management', rights: ['payment.manage'] });
    await t.api.call('events.undo', { eventId: eventOf(t, 'role.updated').id });
    expect(t.store.state.settings.roles?.rights?.management).toEqual(['people.manage', 'payment.manage', 'report.office']);
  });

  it('takes back a rename of a custom role', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'rol_001', name: 'Cash desk' });
    await t.api.call('events.undo', { eventId: eventOf(t, 'role.updated').id });
    expect(t.store.state.settings.roles?.custom?.[0].name).toBe('Cashier');
  });

  it('refuses an Undo of a change while a later change of the same role stands', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'management', rights: ['payment.manage'] });
    const first = eventOf(t, 'role.updated');
    await t.api.call('roles.update', { role: 'management', rights: ['report.office'] });
    await expect(t.api.call('events.undo', { eventId: first.id })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('gives an Undo of a role change to the Admin only', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'management', rights: ['payment.manage'] });
    t.as('usr_006');
    await expect(t.api.call('events.undo', { eventId: eventOf(t, 'role.updated').id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
