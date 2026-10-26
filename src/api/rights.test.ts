import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type CustomRole, OfficeRight, type RoleSettings } from './contract/entities';
import { type Action, can, OFFICE_RIGHTS, type Actor } from './permissions';
import { ADMIN_PAGE_RIGHTS, heldRightsOfRole, opensAdminPage, rightsOf, withOfficeRights } from './rights';
import { BASIC_ON, DEFAULT_EXTRA, expandRights } from './rightsCatalog';
import { executeParsed, resolveAuthority } from './execute';
import type { AnyCall } from './registry';
import { makeUser, makeWorld } from '../test/factories';

const ALL = [...OFFICE_RIGHTS] as string[];
const sorted = (rights: readonly string[]) => [...rights].sort();
const PAY = ['payment.view', 'payment.add', 'payment.change', 'payment.receive'];
/** The default extras of Accounting: the four payment switches and the Daftra link (owner, 2026-10-26). */
const ACCOUNTING_EXTRA = [...PAY, 'payment.daftraLink'];

const admin = makeUser('usr_001', { systemRole: 'admin' });
const management = makeUser('usr_006', { systemRole: 'management' });
const accounting = makeUser('usr_007', { systemRole: 'accounting' });
const member = makeUser('usr_008');
// A custom role saved before role rights version 2: old ids, and no `off`.
const customRole: CustomRole = { id: 'rol_001', name: 'Payments', nameAr: 'المدفوعات', rights: ['project.delete', 'payment.manage'] };

// A call that only returns the rights of the authority it sees. The output check accepts any value.
const probe = {
  run: (_input: unknown, ctx: { authority: Actor }) => ctx.authority.officeRights ?? null,
  output: z.any(),
} as unknown as AnyCall;

describe('opensAdminPage: who sees the Admin page (owner, 2026-10-18, fbk_014)', () => {
  it('opens the page to the Admin, and to Management by its default people switches', () => {
    expect(opensAdminPage(admin)).toBe(true);
    expect(opensAdminPage(withOfficeRights(management, undefined))).toBe(true);
  });

  it('keeps the page from a person with no rights attached, because the rights fail closed', () => {
    expect(opensAdminPage(management)).toBe(false);
  });

  it('keeps the page from Accounting and from a Member with no switch that a section names', () => {
    expect(opensAdminPage(withOfficeRights(accounting, undefined))).toBe(false);
    expect(opensAdminPage(withOfficeRights(member, undefined))).toBe(false);
    expect(opensAdminPage({ ...member, officeRights: ['payment.view', 'report.office'] })).toBe(false);
  });

  it('opens the page to a Member with a switch that a section names', () => {
    expect(opensAdminPage({ ...member, officeRights: ['people.invite'] })).toBe(true);
    expect(opensAdminPage({ ...member, officeRights: ['people.teams'] })).toBe(true);
    expect(opensAdminPage({ ...member, officeRights: ['office.settings'] })).toBe(true);
    expect(opensAdminPage({ ...member, officeRights: ['templates.taskAny'] })).toBe(true);
    expect(opensAdminPage({ ...management, officeRights: ['report.office'] })).toBe(false);
  });

  it('names the switches that open a section, and only those', () => {
    expect(sorted(ADMIN_PAGE_RIGHTS)).toEqual(sorted([
      'people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove', 'clients.change', 'templates.projectCreate',
      'templates.projectAny', 'templates.updateProjects', 'templates.taskAny', 'subCompanies.manage', 'office.settings', 'feedback.manage',
    ]));
    for (const right of ADMIN_PAGE_RIGHTS) expect(ALL).toContain(right);
  });
});

describe('rightsOf: the office rights of each person (role rights version 2)', () => {
  it('gives the default switches when the office has no settings', () => {
    expect(sorted(rightsOf(admin, undefined))).toEqual(sorted(ALL));
    expect(rightsOf(admin, undefined)).toHaveLength(119);
    expect(sorted(rightsOf(member, undefined))).toEqual(sorted(BASIC_ON));
    expect(sorted(rightsOf(management, undefined))).toEqual(sorted([...BASIC_ON, ...DEFAULT_EXTRA.management]));
    expect(sorted(rightsOf(accounting, undefined))).toEqual(sorted([...BASIC_ON, ...ACCOUNTING_EXTRA]));
    expect(rightsOf(member, undefined)).toHaveLength(67);
    expect(rightsOf(management, undefined)).toHaveLength(77);
    expect(rightsOf(accounting, undefined)).toHaveLength(72);
  });

  it('takes the extra switches that the settings give a role, in place of the default extras', () => {
    const roles: RoleSettings = { rights: { management: ['clients.change'] } };
    expect(sorted(rightsOf(management, roles))).toEqual(sorted([...BASIC_ON, 'clients.change']));
    expect(sorted(rightsOf(accounting, roles))).toEqual(sorted([...BASIC_ON, ...ACCOUNTING_EXTRA]));
  });

  it('reads an old stored list: an old id stands for the new switches it names', () => {
    const roles: RoleSettings = { rights: { management: ['people.manage', 'payment.manage', 'report.office'], member: ['project.editCode'] } };
    expect(sorted(rightsOf(management, roles))).toEqual(sorted([...BASIC_ON, ...DEFAULT_EXTRA.management]));
    expect(rightsOf(member, roles)).toContain('project.code');
  });

  it('takes away the basic switches that `off` names', () => {
    const roles: RoleSettings = { off: { member: ['task.add.team', 'chat.direct'] } };
    const rights = rightsOf(member, roles);
    expect(rights).not.toContain('task.add.team');
    expect(rights).not.toContain('chat.direct');
    expect(rights).toHaveLength(65);
    expect(rights).toContain('task.add.office');
  });

  it('drops a stored switch whose need on another power is off, and keeps a scope whose narrower sibling is off', () => {
    // payment.add needs payment.view, which the role does not hold: payment.add counts as off. task.any.all stays without task.any.lead:
    // "Every project" covers the projects the person leads.
    const roles: RoleSettings = { rights: { member: ['payment.add', 'task.any.all'] }, off: { member: ['task.any.lead'] } };
    const rights = rightsOf(member, roles);
    expect(rights).not.toContain('payment.add');
    expect(rights).not.toContain('payment.view');
    expect(rights).toContain('task.any.all');
    expect(rights).not.toContain('task.any.lead');
    // Every ai switch needs ai.connect: with ai.connect off, no AI switch stays.
    const second: RoleSettings = { rights: { member: ['ai.undoOthers.all'] }, off: { member: ['ai.connect'] } };
    expect(rightsOf(member, second).filter((id) => id.startsWith('ai.'))).toEqual([]);
  });

  it('gives a custom role with no `off` the Member switches and its own: the meaning of before', () => {
    const roles: RoleSettings = { custom: [customRole] };
    const rights = rightsOf({ ...member, roleId: 'rol_001' }, roles);
    expect(sorted(rights)).toEqual(sorted([...BASIC_ON, ...PAY, 'project.delete.all']));
    // A change of the Member list reaches this kind of role.
    const withMember: RoleSettings = { custom: [customRole], rights: { member: ['clients.change'] }, off: { member: ['chat.direct'] } };
    const next = rightsOf({ ...member, roleId: 'rol_001' }, withMember);
    expect(next).toContain('clients.change');
    expect(next).not.toContain('chat.direct');
  });

  it('gives a custom role with `off` its own full list, which a change of the Member list does not reach', () => {
    const role: CustomRole = { id: 'rol_002', name: 'Site', nameAr: 'موقع', rights: ['payment.view'], off: ['chat.direct'] };
    const roles: RoleSettings = { custom: [role], rights: { member: ['clients.change'] }, off: { member: ['task.add.team'] } };
    const rights = rightsOf({ ...member, roleId: 'rol_002' }, roles);
    expect(sorted(rights)).toEqual(sorted([...BASIC_ON.filter((id) => id !== 'chat.direct'), 'payment.view']));
    expect(rights).toContain('task.add.team');
    expect(rights).not.toContain('clients.change');
  });

  it('gives the Member switches to a person whose custom role is gone', () => {
    expect(sorted(rightsOf({ ...member, roleId: 'rol_009' }, undefined))).toEqual(sorted(BASIC_ON));
    expect(rightsOf({ ...member, roleId: 'rol_009' }, { custom: [customRole], rights: { member: ['report.office'] } })).toContain('report.office');
  });

  it('gives the Admin every switch, whatever the settings say', () => {
    const roles: RoleSettings = { rights: { management: [] }, off: { member: [...BASIC_ON] }, custom: [{ ...customRole, rights: [] }] };
    expect(sorted(rightsOf(admin, roles))).toEqual(sorted(ALL));
    expect(sorted(rightsOf({ ...admin, roleId: 'rol_001' }, roles))).toEqual(sorted(ALL));
  });

  it('lists the same switches as the contract', () => {
    expect([...OFFICE_RIGHTS]).toEqual(OfficeRight.options);
  });

  it('gives the held list of a role to the screens with one function', () => {
    expect(heldRightsOfRole(undefined, 'member')).toHaveLength(67);
    expect(heldRightsOfRole(undefined, 'management')).toHaveLength(77);
    expect(heldRightsOfRole({ custom: [customRole] }, customRole)).toEqual(rightsOf({ ...member, roleId: 'rol_001' }, { custom: [customRole] }));
  });

  it('expands old ids to the new switches they stand for', () => {
    expect(expandRights(['payment.manage'])).toEqual(PAY);
  });
});

describe('can() reads the office rights of the actor', () => {
  it('reads the rights attached to the actor', () => {
    expect(can({ ...member, officeRights: ['project.delete.all'] }, 'project.delete')).toBe(true);
    expect(can({ ...management, officeRights: ['clients.change'] }, 'people.invite')).toBe(false);
    expect(can({ ...management, officeRights: [] }, 'people.invite')).toBe(false);
  });

  it('gives no office right to a person with no rights attached, so a path that forgot them fails closed', () => {
    const actions: Action[] = ['people.invite', 'payment.view', 'report.office', 'client.create', 'chat.direct', 'dashboard.view', 'search.use', 'ai.connect'];
    for (const person of [management, accounting, member]) {
      for (const action of actions) expect(can(person, action), `${person.systemRole} ${action}`).toBe(false);
    }
  });

  it('reads the default switches of the role when withOfficeRights attaches them', () => {
    expect(can(withOfficeRights(management, undefined), 'people.invite')).toBe(true);
    expect(can(withOfficeRights(accounting, undefined), 'payment.view')).toBe(true);
    expect(can(withOfficeRights(accounting, undefined), 'people.invite')).toBe(false);
    expect(can(withOfficeRights(member, undefined), 'project.delete', { projectRole: 'leader' })).toBe(false);
  });

  it('lets the Admin do every office action, whatever the attached rights are, or when none are attached', () => {
    expect(can({ ...admin, officeRights: [] }, 'project.delete')).toBe(true);
    expect(can({ ...admin, officeRights: [] }, 'people.invite')).toBe(true);
    for (const right of ['people.invite', 'payment.view', 'report.office', 'gaps.view', 'search.use'] as const) expect(can(admin, right), right).toBe(true);
  });
});

describe('resolveAuthority and executeParsed give the rights of the person the call acts for', () => {
  const roleState = () => {
    const state = makeWorld();
    state.settings = { ...state.settings, roles: { custom: [customRole] } };
    state.users.usr_003 = { ...state.users.usr_003, roleId: 'rol_001' };
    return state;
  };
  const expected = sorted([...BASIC_ON, ...PAY, 'project.delete.all']);

  it('attaches the rights of the authority from the office settings', () => {
    const { authority } = resolveAuthority(roleState(), 'usr_003', probe);
    expect(sorted(authority.officeRights ?? [])).toEqual(expected);
  });

  it('gives an agent the rights of the person it acts for, in the authority and in the actor', () => {
    const { authority, actor } = resolveAuthority(roleState(), 'usr_005', probe);
    expect(sorted(authority.officeRights ?? [])).toEqual(expected);
    // The actor is the agent record, and it carries the rights of its person: a check that reads the actor by mistake fails safe.
    expect(actor.id).toBe('usr_005');
    expect(actor.kind).toBe('agent');
    expect(sorted(actor.officeRights ?? [])).toEqual(expected);
  });

  it('shows the same rights to the handler in its context', () => {
    const state = roleState();
    const output = executeParsed(probe, 'probe', {}, state, {
      actorId: 'usr_003', authorityId: 'usr_003', correlationId: 'cor_test', now: new Date('2026-10-18T08:00:00Z'), persistent: false,
    }, undefined);
    expect(sorted(output as string[])).toEqual(expected);
  });

  it('withOfficeRights keeps the person and adds its rights', () => {
    const actor = withOfficeRights({ ...management }, undefined);
    expect(actor.id).toBe('usr_006');
    expect(can(actor, 'report.office')).toBe(true);
  });
});

describe('a stored switch whose need is off counts as off (fail closed, role rights version 2)', () => {
  it('turns off every AI switch when Connect AI assistants is off, also when the other AI switches stay stored as on', () => {
    const roles: RoleSettings = { off: { member: ['ai.connect'] } };
    const held = heldRightsOfRole(roles, 'member');
    expect(held).not.toContain('ai.connect');
    expect(held.filter((id) => id.startsWith('ai.'))).toEqual([]);
  });

  it('drops a payment switch whose need See payments is off', () => {
    const role: CustomRole = { id: 'rol_900', name: 'Clerk', nameAr: '', rights: ['payment.add', 'payment.receive'], off: [] };
    const held = heldRightsOfRole(undefined, role);
    expect(held).not.toContain('payment.add');
    expect(held).not.toContain('payment.receive');
  });

  it('keeps a switch whose need is held', () => {
    const role: CustomRole = { id: 'rol_901', name: 'Cashier', nameAr: '', rights: ['payment.view', 'payment.add'], off: [] };
    expect(heldRightsOfRole(undefined, role)).toEqual(expect.arrayContaining(['payment.view', 'payment.add']));
  });

  it('keeps an "Every project" switch whose "Projects I lead" switch is off: it covers the projects the person leads', () => {
    const role: CustomRole = { id: 'rol_902', name: 'Coordinator', nameAr: '', rights: ['task.any.all'], off: ['task.any.lead'] };
    expect(heldRightsOfRole(undefined, role)).toContain('task.any.all');
  });
});
