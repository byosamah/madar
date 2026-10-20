import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type CustomRole, OfficeRight, type RoleSettings } from './contract/entities';
import { type Action, can, DEFAULT_RIGHTS, OFFICE_RIGHTS, type Actor } from './permissions';
import { ADMIN_PAGE_RIGHTS, opensAdminPage, rightsOf, withOfficeRights } from './rights';
import { executeParsed, resolveAuthority } from './execute';
import type { AnyCall } from './registry';
import { makeUser, makeWorld } from '../test/factories';

// Every office right: the seven of fbk_014 and the ten of role-rights (2026-10-23).
const ALL = [...OFFICE_RIGHTS] as string[];
const sorted = (rights: readonly string[]) => [...rights].sort();

const admin = makeUser('usr_001', { systemRole: 'admin' });
const management = makeUser('usr_006', { systemRole: 'management' });
const accounting = makeUser('usr_007', { systemRole: 'accounting' });
const member = makeUser('usr_008');
const customRole: CustomRole = { id: 'rol_001', name: 'Payments', nameAr: 'المدفوعات', rights: ['project.delete', 'payment.manage'] };

// A call that only returns the rights of the authority it sees. The output check accepts any value.
const probe = {
  run: (_input: unknown, ctx: { authority: Actor }) => ctx.authority.officeRights ?? null,
  output: z.any(),
} as unknown as AnyCall;

describe('opensAdminPage: who sees the Admin page (owner, 2026-10-18, fbk_014)', () => {
  it('opens the page to the Admin, and to Management by its default people right', () => {
    expect(opensAdminPage(admin)).toBe(true);
    expect(opensAdminPage(withOfficeRights(management, undefined))).toBe(true);
  });

  it('keeps the page from a person with no rights attached, because the rights fail closed', () => {
    expect(opensAdminPage(management)).toBe(false);
  });

  it('keeps the page from Accounting and from a Member with no right that a section names', () => {
    expect(opensAdminPage(withOfficeRights(accounting, undefined))).toBe(false);
    expect(opensAdminPage(withOfficeRights(member, undefined))).toBe(false);
    expect(opensAdminPage({ ...member, officeRights: ['payment.manage', 'report.office'] })).toBe(false);
  });

  it('opens the page to a Member with a custom role that holds a section right', () => {
    const planner = { ...member, officeRights: ['people.manage'] as const };
    expect(opensAdminPage(planner)).toBe(true);
    expect(opensAdminPage({ ...management, officeRights: ['report.office'] })).toBe(false);
  });

  it('names the rights that open a section, and only those', () => {
    expect(sorted(ADMIN_PAGE_RIGHTS)).toEqual([
      'clients.manage', 'feedback.manage', 'people.manage', 'subCompanies.manage', 'templates.manageAll', 'templates.updateProjects',
    ]);
  });
});

describe('rightsOf: the office rights of each person', () => {
  it('gives the default rights when the office has no settings', () => {
    expect(sorted(rightsOf(admin, undefined))).toEqual(sorted(ALL));
    expect(sorted(rightsOf(management, undefined))).toEqual(sorted(['people.manage', 'payment.manage', 'report.office']));
    expect(sorted(rightsOf(accounting, undefined))).toEqual(['payment.manage']);
    expect(sorted(rightsOf(member, undefined))).toEqual([]);
  });

  it('takes the rights that the settings give a role, in place of the defaults', () => {
    const roles: RoleSettings = { rights: { management: ['clients.manage'] } };
    expect(rightsOf(management, roles)).toEqual(['clients.manage']);
    expect(rightsOf(accounting, roles)).toEqual(['payment.manage']);
  });

  it('gives a custom role its own rights, with the rights of the Member role', () => {
    const roles: RoleSettings = { custom: [customRole] };
    expect(sorted(rightsOf({ ...member, roleId: 'rol_001' }, roles))).toEqual(['payment.manage', 'project.delete']);
    const withMember: RoleSettings = { custom: [customRole], rights: { member: ['clients.manage'] } };
    expect(sorted(rightsOf({ ...member, roleId: 'rol_001' }, withMember))).toEqual(['clients.manage', 'payment.manage', 'project.delete']);
  });

  it('gives the Member rights to a person whose custom role is gone', () => {
    expect(rightsOf({ ...member, roleId: 'rol_009' }, undefined)).toEqual([]);
    expect(rightsOf({ ...member, roleId: 'rol_009' }, { custom: [customRole], rights: { member: ['report.office'] } })).toEqual(['report.office']);
  });

  it('gives the Admin every right, whatever the settings say', () => {
    const roles: RoleSettings = { rights: { management: [] }, custom: [{ ...customRole, rights: [] }] };
    expect(sorted(rightsOf(admin, roles))).toEqual(sorted(ALL));
    expect(sorted(rightsOf({ ...admin, roleId: 'rol_001' }, roles))).toEqual(sorted(ALL));
  });

  it('lists the same office rights as the contract', () => {
    expect([...OFFICE_RIGHTS]).toEqual(OfficeRight.options);
    expect(Object.keys(DEFAULT_RIGHTS).sort()).toEqual(['accounting', 'management', 'member']);
  });
});

describe('can() reads the office rights of the actor', () => {
  it('reads the rights attached to the actor', () => {
    expect(can({ ...member, officeRights: ['project.delete'] }, 'project.delete')).toBe(true);
    expect(can({ ...management, officeRights: ['clients.manage'] }, 'people.manage')).toBe(false);
    expect(can({ ...management, officeRights: [] }, 'people.manage')).toBe(false);
  });

  it('gives no office right to a person with no rights attached, so a path that forgot them fails closed', () => {
    for (const person of [management, accounting, member]) {
      for (const right of ALL) expect(can(person, right as Action), `${person.systemRole} ${right}`).toBe(false);
    }
  });

  it('reads the default rights of the role when withOfficeRights attaches them', () => {
    expect(can(withOfficeRights(management, undefined), 'people.manage')).toBe(true);
    expect(can(withOfficeRights(accounting, undefined), 'payment.manage')).toBe(true);
    expect(can(withOfficeRights(accounting, undefined), 'people.manage')).toBe(false);
    expect(can(withOfficeRights(member, undefined), 'project.delete')).toBe(false);
  });

  it('lets the Admin do every office action, whatever the attached rights are, or when none are attached', () => {
    expect(can({ ...admin, officeRights: [] }, 'project.delete')).toBe(true);
    expect(can({ ...admin, officeRights: [] }, 'people.manage')).toBe(true);
    for (const right of ALL) expect(can(admin, right as Action), right).toBe(true);
  });
});

describe('resolveAuthority and executeParsed give the rights of the person the call acts for', () => {
  const roleState = () => {
    const state = makeWorld();
    state.settings = { ...state.settings, roles: { custom: [customRole] } };
    state.users.usr_003 = { ...state.users.usr_003, roleId: 'rol_001' };
    return state;
  };

  it('attaches the rights of the authority from the office settings', () => {
    const { authority } = resolveAuthority(roleState(), 'usr_003', probe);
    expect(sorted(authority.officeRights ?? [])).toEqual(['payment.manage', 'project.delete']);
  });

  it('gives an agent the rights of the person it acts for', () => {
    const { authority } = resolveAuthority(roleState(), 'usr_005', probe);
    expect(sorted(authority.officeRights ?? [])).toEqual(['payment.manage', 'project.delete']);
  });

  it('shows the same rights to the handler in its context', () => {
    const state = roleState();
    const output = executeParsed(probe, 'probe', {}, state, {
      actorId: 'usr_003', authorityId: 'usr_003', correlationId: 'cor_test', now: new Date('2026-10-18T08:00:00Z'), persistent: false,
    }, undefined);
    expect(sorted(output as string[])).toEqual(['payment.manage', 'project.delete']);
  });

  it('withOfficeRights keeps the person and adds its rights', () => {
    const actor = withOfficeRights({ ...management }, undefined);
    expect(actor.id).toBe('usr_006');
    expect(can(actor, 'report.office')).toBe(true);
  });
});
