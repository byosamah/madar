import { describe, expect, it } from 'vitest';
import { OfficeRight } from './contract/entities';
import { type Action, can, DEFAULT_RIGHTS, OFFICE_RIGHTS, RIGHT_SECTIONS, type Actor, type Resource } from './permissions';
import { ADMIN_PAGE_RIGHTS, opensAdminPage, rightsOf, withOfficeRights } from './rights';
import { makeUser } from '../test/factories';

/**
 * The ten rights that role-rights adds (owner, 2026-10-23). A role holds what a Member does today. Each right adds one power of the Admin.
 * Every test uses a person who is NOT on the team of the project, so only the right can open the action.
 */
const member = makeUser('usr_008');
const admin = makeUser('usr_001', { systemRole: 'admin' });
const withRights = (rights: readonly OfficeRight[]): Actor => ({ ...member, officeRights: rights });
const outsider: Resource = { projectRole: 'other' };

/** Each new right, the actions it passes on a project the person is not on, and actions it must not pass. */
const NEW_RIGHTS: [OfficeRight, Action[], Action[]][] = [
  ['project.editAny', ['project.edit', 'project.healthOverride'], ['project.changeLeader', 'project.archive', 'project.delete', 'project.editCode', 'task.review', 'task.updateAny', 'event.undoAgent', 'admin.manage']],
  ['project.changeLeaderAny', ['project.changeLeader'], ['project.edit', 'project.archive', 'project.healthOverride', 'task.review']],
  ['project.archiveAny', ['project.archive'], ['project.edit', 'project.changeLeader', 'project.healthOverride', 'project.delete']],
  ['task.reviewAny', ['task.review'], ['task.updateAny', 'task.updateOwn', 'task.delete', 'project.edit', 'event.undoAgent']],
  ['task.changeAny', ['task.updateAny', 'task.updateOwn', 'task.contribute', 'task.delete'], ['task.review', 'project.edit', 'event.undoAgent', 'content.post', 'task.createForSelf']],
  ['agents.undoAny', ['event.undoAgent'], ['task.review', 'project.edit', 'admin.manage']],
  ['subCompanies.manage', ['subCompanies.manage'], ['admin.manage', 'feedback.manage', 'gaps.view', 'people.manage']],
  ['templates.updateProjects', ['templates.updateProjects'], ['templates.manageAll', 'admin.manage', 'project.edit']],
  ['feedback.manage', ['feedback.manage'], ['admin.manage', 'gaps.view', 'subCompanies.manage']],
  ['gaps.view', ['gaps.view'], ['admin.manage', 'feedback.manage', 'report.office']],
];

describe('the new office rights in can() (role-rights)', () => {
  for (const [right, passes, stays] of NEW_RIGHTS) {
    describe(right, () => {
      it('is refused to a Member who is not on the team, and to a Member who holds another right', () => {
        for (const action of passes) {
          expect(can(withRights([]), action, outsider), `${action} with no right`).toBe(false);
          expect(can(withRights(['payment.manage']), action, outsider), `${action} with payment.manage`).toBe(false);
        }
      });

      it('passes its actions on a project where the person is not on the team', () => {
        for (const action of passes) expect(can(withRights([right]), action, outsider), action).toBe(true);
      });

      it('passes nothing else', () => {
        for (const action of stays) expect(can(withRights([right]), action, outsider), action).toBe(false);
      });

      it('is held by the Admin', () => {
        for (const action of passes) expect(can(admin, action, outsider), action).toBe(true);
      });

      it('fails closed for a person with no rights attached', () => {
        for (const action of passes) expect(can(member, action, outsider), action).toBe(false);
      });
    });
  }

  it('never gives a right to a person who left the office', () => {
    const gone = { ...withRights(OFFICE_RIGHTS), active: false };
    for (const [, passes] of NEW_RIGHTS) for (const action of passes) expect(can(gone, action, outsider), action).toBe(false);
  });

  it('keeps task.changeAny away from an office task: the rules of an office task stay as they are', () => {
    const holder = withRights(['task.changeAny', 'task.reviewAny', 'agents.undoAny', 'project.editAny']);
    // The task of another person, which the holder neither made, nor leads, nor helps with.
    const office: Resource = { office: true, makerId: 'usr_002', ownerId: 'usr_003', helperIds: [] };
    const actions: Action[] = ['task.view', 'task.updateAny', 'task.updateOwn', 'task.contribute', 'task.delete', 'task.review', 'event.undoAgent', 'comment.read', 'content.post'];
    for (const action of actions) expect(can(holder, action, office), action).toBe(false);
    // The Admin sees it, as before.
    expect(can(admin, 'task.view', office)).toBe(true);
  });

  it('opens no action that stays tied to a person', () => {
    const holder = withRights(['task.changeAny', 'project.editAny']);
    // content.editOwn stays with the author on the team. A right of the sheet does not open it.
    expect(can(holder, 'content.editOwn', { projectRole: 'other', authorId: holder.id })).toBe(false);
    // The meeting rules do not read these rights.
    expect(can(holder, 'meeting.edit', { projectRole: 'other', meeting: { organizerId: 'usr_002', attendeeIds: [], noProject: false } })).toBe(false);
  });

  it('keeps the rights of a team member who holds no right', () => {
    const team = withRights([]);
    expect(can(team, 'project.edit', { projectRole: 'team' })).toBe(false);
    expect(can(team, 'task.updateAny', { projectRole: 'team' })).toBe(false);
    expect(can(team, 'task.createForSelf', { projectRole: 'team' })).toBe(true);
  });
});

describe('the list of the office rights', () => {
  it('has 17 rights in 7 sections, in the order of the sections', () => {
    expect(RIGHT_SECTIONS.map((section) => section.key)).toEqual(['projects', 'todos', 'people', 'money', 'templates', 'ai', 'office']);
    expect(OFFICE_RIGHTS).toHaveLength(17);
    expect(new Set(OFFICE_RIGHTS).size).toBe(17);
    expect([...OFFICE_RIGHTS]).toEqual(RIGHT_SECTIONS.flatMap((section) => section.rights));
  });

  it('agrees with the contract, in the same order', () => {
    expect([...OFFICE_RIGHTS]).toEqual(OfficeRight.options);
  });

  it('puts the rights in the sections the owner named', () => {
    const rightsOfSection = (key: string) => RIGHT_SECTIONS.find((section) => section.key === key)!.rights;
    expect(rightsOfSection('projects')).toEqual(['project.editAny', 'project.changeLeaderAny', 'project.archiveAny', 'project.delete', 'project.editCode']);
    expect(rightsOfSection('todos')).toEqual(['task.reviewAny', 'task.changeAny']);
    expect(rightsOfSection('people')).toEqual(['people.manage', 'clients.manage', 'subCompanies.manage']);
    expect(rightsOfSection('money')).toEqual(['payment.manage']);
    expect(rightsOfSection('templates')).toEqual(['templates.manageAll', 'templates.updateProjects']);
    expect(rightsOfSection('ai')).toEqual(['report.office', 'agents.undoAny']);
    expect(rightsOfSection('office')).toEqual(['feedback.manage', 'gaps.view']);
  });

  it('parses a role stored with the old seven rights', () => {
    for (const right of ['people.manage', 'payment.manage', 'project.delete', 'project.editCode', 'clients.manage', 'templates.manageAll', 'report.office']) {
      expect(OfficeRight.safeParse(right).success, right).toBe(true);
    }
  });
});

describe('the defaults: nobody gets a new power from this release', () => {
  const OLD = ['people.manage', 'payment.manage', 'project.delete', 'project.editCode', 'clients.manage', 'templates.manageAll', 'report.office'];
  const NEW = NEW_RIGHTS.map(([right]) => right);

  it('keeps the default rights of Management, Accounting and Member exactly as they were', () => {
    expect(DEFAULT_RIGHTS.management).toEqual(['people.manage', 'payment.manage', 'report.office']);
    expect(DEFAULT_RIGHTS.accounting).toEqual(['payment.manage']);
    expect(DEFAULT_RIGHTS.member).toEqual([]);
  });

  it('gives Management, Accounting and Member none of the ten new rights, and the old ones as before', () => {
    const expected = { management: ['people.manage', 'payment.manage', 'report.office'], accounting: ['payment.manage'], member: [] };
    for (const role of ['management', 'accounting', 'member'] as const) {
      const person = makeUser('usr_010', { systemRole: role });
      const held = rightsOf(person, undefined);
      for (const right of NEW) expect(held, `${role} ${right}`).not.toContain(right);
      expect([...held].sort()).toEqual([...expected[role]].sort());
    }
  });

  it('gives a custom role with the old rights the same rights as before', () => {
    const role = { id: 'rol_001', name: 'Payments', nameAr: 'المدفوعات', rights: ['project.delete', 'payment.manage'] as OfficeRight[] };
    expect([...rightsOf({ ...member, roleId: 'rol_001' }, { custom: [role] })].sort()).toEqual(['payment.manage', 'project.delete']);
  });

  it('gives the Admin all 17 rights, the old ones and the new ones', () => {
    const held = rightsOf(admin, { rights: { member: [] } });
    expect([...held]).toEqual([...OFFICE_RIGHTS]);
    for (const right of [...OLD, ...NEW]) expect(held).toContain(right);
  });

  it('gives a Member with a custom role the new rights of that role, and no more', () => {
    const role = { id: 'rol_002', name: 'Lead', nameAr: 'قيادة', rights: ['project.editAny', 'feedback.manage'] as OfficeRight[] };
    const held = rightsOf({ ...member, roleId: 'rol_002' }, { custom: [role] });
    expect([...held].sort()).toEqual(['feedback.manage', 'project.editAny']);
    const person = withOfficeRights({ ...member, roleId: 'rol_002' }, { custom: [role] });
    expect(can(person, 'project.edit', outsider)).toBe(true);
    expect(can(person, 'feedback.manage')).toBe(true);
    expect(can(person, 'project.archive', outsider)).toBe(false);
    expect(can(person, 'gaps.view')).toBe(false);
  });
});

describe('the Admin page opens for the new section rights', () => {
  it('names the rights that open a section, with the sub-companies and the requests and bugs', () => {
    expect([...ADMIN_PAGE_RIGHTS].sort()).toEqual([
      'clients.manage', 'feedback.manage', 'people.manage', 'subCompanies.manage', 'templates.manageAll', 'templates.updateProjects',
    ]);
  });

  it('opens the page for a Member who holds one of them', () => {
    for (const right of ['feedback.manage', 'subCompanies.manage', 'templates.updateProjects'] as OfficeRight[]) {
      expect(opensAdminPage(withRights([right])), right).toBe(true);
    }
  });

  it('keeps the page closed for the rights that open no section', () => {
    const closed: OfficeRight[] = ['project.editAny', 'task.changeAny', 'gaps.view', 'agents.undoAny', 'task.reviewAny', 'project.archiveAny', 'project.changeLeaderAny'];
    for (const right of closed) expect(opensAdminPage(withRights([right])), right).toBe(false);
  });
});
