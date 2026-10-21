import { beforeEach, describe, expect, it } from 'vitest';
import { setNow } from '../../lib/dates';
import { makeUser, NOW, testApi } from '../../test/factories';
import type { Event, RoleSettings } from '../contract/entities';
import { rightsOf } from '../rights';
import { BASIC_ON, DEFAULT_EXTRA } from '../rightsCatalog';
import { historyCalls } from './history';
import { peopleCalls } from './people';
import { rolesCalls } from './roles';

beforeEach(() => setNow(NOW));

const calls = { ...peopleCalls, ...historyCalls, ...rolesCalls };

/**
 * The storage of role rights version 2 (design sections 4 and 8): the `off` list of a built-in role and of a custom role, the caps, the
 * old stored forms, and the Undo of an old role event and of a new one. The Admin is usr_001. usr_011 holds the old custom role rol_001.
 */
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  for (const user of [makeUser('usr_005', { name: 'Noura Member' }), makeUser('usr_011', { name: 'Cashier Person', roleId: 'rol_001' })]) state.users[user.id] = user;
  state.counters.usr = 15;
  state.counters.rol = 1;
  state.settings.roles = { custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] }] };
  t.as('usr_001');
  return t;
}

const roleEvents = (t: ReturnType<typeof world>, verb?: string): Event[] =>
  Object.values(t.store.state.events)
    .filter((event) => event.targetType === 'settings' && (verb === undefined || event.verb === verb))
    .sort((a, b) => a.seq - b.seq);

describe('roles.create with off', () => {
  it('stores the new ids in the order of the catalog, drops the basic ids from the rights, and keeps the off list', async () => {
    const t = world();
    const role = await t.api.call('roles.create', {
      name: 'Site lead', nameAr: 'مسؤول الموقع',
      // A basic id in `rights` is on already: the store keeps only the extras. An old id expands.
      rights: ['report.office', 'task.add.team', 'payment.manage', 'report.office'], off: ['chat.direct', 'task.add.team', 'chat.direct'],
    });
    expect(role.rights).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive', 'report.office']);
    expect(role.off).toEqual(['task.add.team', 'chat.direct']);
    expect(roleEvents(t, 'role.created')).toHaveLength(1);
  });

  it('stores no off for a role made with the old form, so it keeps the meaning of before', async () => {
    const t = world();
    const role = await t.api.call('roles.create', { name: 'Old form', nameAr: 'شكل قديم', rights: ['clients.manage'] });
    expect(role).not.toHaveProperty('off');
    expect(role.rights).toEqual(['clients.change']);
  });

  it('refuses a list over the caps: 120 stored rights and 70 off ids', async () => {
    const t = world();
    const tooMany = Array.from({ length: 121 }, () => 'report.office' as const);
    await expect(t.api.call('roles.create', { name: 'Big', nameAr: 'كبير', rights: tooMany })).rejects.toMatchObject({ code: 'invalid_input' });
    const offTooMany = Array.from({ length: 71 }, () => 'chat.direct' as const);
    await expect(t.api.call('roles.create', { name: 'Big', nameAr: 'كبير', rights: [], off: offTooMany })).rejects.toMatchObject({ code: 'invalid_input' });
    // The caps still allow a full list: 120 ids and 70 ids.
    const full = Array.from({ length: 120 }, () => 'report.office' as const);
    const role = await t.api.call('roles.create', { name: 'Full', nameAr: 'كامل', rights: full, off: Array.from({ length: 70 }, () => 'chat.direct' as const) });
    expect(role.rights).toEqual(['report.office']);
  });

  it('refuses an id that is not a right', async () => {
    const t = world();
    await expect(t.api.call('roles.create', { name: 'Bad', nameAr: 'خطأ', rights: ['nothing.here' as never] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('roles.create', { name: 'Bad', nameAr: 'خطأ', rights: [], off: ['people.manage' as never] })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('roles.update with off', () => {
  it('changes the off list of a built-in role, and the person holds the rest of the basic switches', async () => {
    const t = world();
    const roles = await t.api.call('roles.update', { role: 'member', off: ['task.add.team', 'chat.direct'] });
    expect(roles.off?.member).toEqual(['task.add.team', 'chat.direct']);
    expect(roles.rights?.member).toBeUndefined();
    const person = rightsOf(t.store.state.users.usr_005, t.store.state.settings.roles);
    expect(person).toHaveLength(62);
    expect(person).not.toContain('chat.direct');
    expect(roleEvents(t, 'role.updated')).toMatchObject([{ targetId: 'member', before: { off: [] }, after: { off: ['task.add.team', 'chat.direct'] } }]);
  });

  it('writes no event for the same off list, in another order', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'member', off: ['chat.direct', 'task.add.team'] });
    await t.api.call('roles.update', { role: 'member', off: ['task.add.team', 'chat.direct'] });
    expect(roleEvents(t, 'role.updated')).toHaveLength(1);
  });

  it('keeps the off list of a built-in role when a save names only the rights', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'management', off: ['search.use'] });
    await t.api.call('roles.update', { role: 'management', rights: ['report.office'] });
    expect(t.store.state.settings.roles?.off?.management).toEqual(['search.use']);
    expect(t.store.state.settings.roles?.rights?.management).toEqual(['report.office']);
  });

  it('turns an old custom role into a role with its own full list when a save names off', async () => {
    const t = world();
    // Before: Member switches plus the payment switches. After: the full list of the role, with `off`.
    expect(rightsOf(t.store.state.users.usr_011, t.store.state.settings.roles)).toHaveLength(64 + 4);
    const roles = await t.api.call('roles.update', { role: 'rol_001', off: ['chat.direct'] });
    expect(roles.custom?.[0].off).toEqual(['chat.direct']);
    const person = rightsOf(t.store.state.users.usr_011, t.store.state.settings.roles);
    expect(person).toHaveLength(64 + 4 - 1);
    expect(roleEvents(t, 'role.updated')).toMatchObject([{ targetId: 'rol_001', before: { off: null }, after: { off: ['chat.direct'] } }]);
  });

  it('carries off with rights in one event for a custom role', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'rol_001', rights: ['payment.view'], off: ['chat.direct'] });
    const [event] = roleEvents(t, 'role.updated');
    expect(event.after).toEqual({ rights: ['payment.view'], off: ['chat.direct'] });
    expect(event.before).toEqual({ rights: ['payment.manage'], off: null });
  });
});

describe('the Undo of a role change', () => {
  it('takes back the off list of a built-in role', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'member', off: ['chat.direct'] });
    await t.api.call('events.undo', { eventId: roleEvents(t, 'role.updated')[0].id });
    expect(t.store.state.settings.roles?.off?.member).toEqual([]);
    expect(rightsOf(t.store.state.users.usr_005, t.store.state.settings.roles)).toHaveLength(64);
  });

  it('takes back the first off of an old custom role: the role has no off again', async () => {
    const t = world();
    await t.api.call('roles.update', { role: 'rol_001', rights: ['report.office'], off: ['chat.direct'] });
    await t.api.call('events.undo', { eventId: roleEvents(t, 'role.updated')[0].id });
    const role = t.store.state.settings.roles?.custom?.[0];
    expect(role).not.toHaveProperty('off');
    // The old rights come back as new ids.
    expect(role?.rights).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive']);
    expect(rightsOf(t.store.state.users.usr_011, t.store.state.settings.roles)).toHaveLength(64 + 4);
  });

  it('expands the old ids of an event that an older build wrote', async () => {
    const t = world();
    // An event of the 17-right build: the old and the new value are old ids.
    t.store.state.settings.roles = { rights: { management: ['payment.manage'] }, custom: t.store.state.settings.roles?.custom };
    const first = await t.api.call('roles.update', { role: 'management', rights: ['people.manage', 'report.office'] });
    expect(first.rights?.management).toEqual(['people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove', 'report.office']);
    const event = roleEvents(t, 'role.updated')[0];
    // Write the old form into the event, as the old build did.
    event.before = { rights: ['payment.manage'] };
    event.after = { rights: ['people.manage', 'report.office'] };
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.settings.roles?.rights?.management).toEqual(['payment.view', 'payment.add', 'payment.change', 'payment.receive']);
  });

  it('brings back a deleted old custom role with its old ids, and the person reads them as new switches', async () => {
    const t = world();
    t.store.state.users.usr_011 = { ...t.store.state.users.usr_011, roleId: null };
    await t.api.call('roles.delete', { id: 'rol_001' });
    await t.api.call('events.undo', { eventId: roleEvents(t, 'role.deleted')[0].id });
    const person = rightsOf({ ...t.store.state.users.usr_005, roleId: 'rol_001' }, t.store.state.settings.roles);
    expect(person).toEqual(expect.arrayContaining(['payment.view', 'payment.receive']));
  });
});

describe('the old stored forms', () => {
  it('reads a built-in role stored with people.manage, a custom role with no off, and a Member with extras', () => {
    const roles: RoleSettings = {
      rights: { management: ['people.manage', 'payment.manage'], member: ['project.editCode'] },
      custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] }],
    };
    const management = makeUser('usr_006', { systemRole: 'management' });
    expect(rightsOf(management, roles)).toHaveLength(64 + 9);
    expect(rightsOf(makeUser('usr_008'), roles)).toContain('project.code');
    // The cashier holds the Member switches (with the code) and the four payment switches.
    expect(rightsOf(makeUser('usr_011', { roleId: 'rol_001' }), roles)).toHaveLength(64 + 1 + 4);
  });

  it('parses the settings of an office saved before this release', async () => {
    const t = world();
    const settings = await t.api.call('roles.update', { role: 'accounting', rights: ['payment.manage'] });
    expect(settings.custom?.[0].rights).toEqual(['payment.manage']);
    expect(DEFAULT_EXTRA.accounting).toHaveLength(4);
    expect(BASIC_ON).toHaveLength(64);
  });
});
