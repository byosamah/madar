import { describe, expect, it } from 'vitest';
import { OfficeRight, StoredRight } from './contract/entities';
import { type Action, can, OFFICE_RIGHTS, RIGHT_SECTIONS, type Actor, type Resource } from './permissions';
import { ADMIN_PAGE_RIGHTS, opensAdminPage, rightsOf, withOfficeRights } from './rights';
import { BASIC_ON, DEFAULT_EXTRA, expandRights, LEGACY_RIGHT_IDS } from './rightsCatalog';
import { makeUser } from '../test/factories';

/**
 * The ten rights that role-rights adds (owner, 2026-10-23), read through the old actions. Since role rights version 2 (2026-10-21) an old
 * right stands for new switches (the legacy map of the catalog), and the old actions answer from them ("compat"). A role holds what a Member
 * does today. Each right adds one power of the Admin. Every test uses a person who is NOT on the team of the project, so only the right
 * can open the action. The helper expands the old ids, as the roles calls and rightsOf do.
 */
const member = makeUser('usr_008');
const admin = makeUser('usr_001', { systemRole: 'admin' });
const withRights = (rights: readonly StoredRight[]): Actor => ({ ...member, officeRights: expandRights(rights) });
// A task of the project, made and led by other people. Only the task actions read the people; the project actions ignore them.
const outsider: Resource = { projectRole: 'other', makerId: 'usr_002', ownerId: 'usr_003', helperIds: [] };

/** Each new right, the actions it passes on a project the person is not on, and actions it must not pass. */
const NEW_RIGHTS: [StoredRight, Action[], Action[]][] = [
  ['project.editAny', ['project.details', 'project.team', 'project.stages', 'project.deadlines', 'project.template', 'project.health'], ['project.leader', 'project.archive', 'project.delete', 'project.code', 'task.review', 'task.any', 'ai.undoOthers', 'admin.manage']],
  ['project.changeLeaderAny', ['project.leader'], ['project.details', 'project.archive', 'project.health', 'task.review']],
  ['project.archiveAny', ['project.archive'], ['project.details', 'project.leader', 'project.health', 'project.delete']],
  ['task.reviewAny', ['task.review'], ['task.any', 'task.work', 'task.deleteOwn', 'project.details', 'ai.undoOthers']],
  ['task.changeAny', ['task.any'], ['task.review', 'project.details', 'ai.undoOthers', 'post.create', 'task.add']],
  ['agents.undoAny', ['ai.undoOthers'], ['task.review', 'project.details', 'admin.manage']],
  ['subCompanies.manage', ['subCompanies.manage'], ['admin.manage', 'feedback.manage', 'gaps.view', 'people.invite']],
  ['templates.updateProjects', ['templates.updateProjects'], ['templates.projectAny', 'admin.manage', 'project.details']],
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
    const gone = { ...withRights([...OFFICE_RIGHTS]), active: false };
    for (const [, passes] of NEW_RIGHTS) for (const action of passes) expect(can(gone, action, outsider), action).toBe(false);
  });

  it('keeps task.changeAny away from an office task: the rules of an office task stay as they are', () => {
    const holder = withRights(['task.changeAny', 'task.reviewAny', 'agents.undoAny', 'project.editAny']);
    // The task of another person, which the holder neither made, nor leads, nor helps with.
    const office: Resource = { office: true, makerId: 'usr_002', ownerId: 'usr_003', helperIds: [] };
    const actions: Action[] = ['task.view', 'task.any', 'task.work', 'task.details', 'task.dates', 'task.deleteOwn', 'task.review', 'ai.undoOthers', 'comment.read', 'comment.create', 'file.upload'];
    for (const action of actions) expect(can(holder, action, office), action).toBe(false);
    // The Admin sees it, as before.
    expect(can(admin, 'task.view', office)).toBe(true);
  });

  it('does not let task.changeAny delete a file or a Tracker entry: those have their own switches, and they stay with the leader', () => {
    const holder = withRights(['task.changeAny']);
    expect(can(holder, 'file.deleteAny', { projectRole: 'other' })).toBe(false);
    expect(can(holder, 'tracker.deleteAny', { projectRole: 'other' })).toBe(false);
    expect(can(holder, 'task.any', outsider)).toBe(true);
    expect(can(admin, 'file.deleteAny', { projectRole: 'other' })).toBe(true);
    expect(can(admin, 'tracker.deleteAny', { projectRole: 'other' })).toBe(true);
  });

  it('opens no action that stays tied to a person', () => {
    const holder = withRights(['task.changeAny', 'project.editAny']);
    // post.editOwn stays with the author on the team. A right of the sheet does not open it.
    expect(can(holder, 'post.editOwn', { projectRole: 'other', authorId: holder.id })).toBe(false);
    // The meeting rules do not read these rights.
    const meeting = { projectRole: 'other' as const, meeting: { organizerId: 'usr_002', attendeeIds: [], noProject: false } };
    expect(can(holder, 'meeting.editOwn', meeting)).toBe(false);
    expect(can(holder, 'meeting.any', meeting)).toBe(false);
  });

  it('keeps the rights of a team member who holds no right', () => {
    const team = withOfficeRights(member, undefined);
    expect(can(team, 'project.details', { projectRole: 'team' })).toBe(false);
    expect(can(team, 'task.any', { projectRole: 'team' })).toBe(false);
    expect(can(team, 'task.add', { projectRole: 'team' })).toBe(true);
  });
});

describe('the list of the switches', () => {
  it('has 119 switches in 13 sections, in the order of the sections', () => {
    expect(RIGHT_SECTIONS.map((section) => section.key)).toEqual([
      'projects', 'todos', 'meetings', 'posts', 'files', 'chat', 'tracker', 'people', 'money', 'templates', 'dashboard', 'ai', 'office',
    ]);
    expect(OFFICE_RIGHTS).toHaveLength(119);
    expect(new Set(OFFICE_RIGHTS).size).toBe(119);
    expect([...OFFICE_RIGHTS]).toEqual(RIGHT_SECTIONS.flatMap((section) => section.rights));
  });

  it('agrees with the contract, in the same order', () => {
    expect([...OFFICE_RIGHTS]).toEqual(OfficeRight.options);
  });

  it('parses a role stored with the old seventeen rights, and gives the new ids only in an output', () => {
    for (const right of LEGACY_RIGHT_IDS) expect(StoredRight.safeParse(right).success, right).toBe(true);
    expect(OfficeRight.safeParse('people.manage').success).toBe(false);
    expect(OfficeRight.safeParse('people.invite').success).toBe(true);
  });
});

describe('the defaults: nobody gets a new power from this release', () => {
  const NEW = NEW_RIGHTS.map(([right]) => right);
  const sorted = (rights: readonly string[]) => [...rights].sort();

  it('keeps the defaults of Management, Accounting and Member: the basic switches, and the extras of today', () => {
    expect(sorted(rightsOf(makeUser('usr_010', { systemRole: 'member' }), undefined))).toEqual(sorted(BASIC_ON));
    expect(sorted(rightsOf(makeUser('usr_010', { systemRole: 'management' }), undefined))).toEqual(sorted([...BASIC_ON, ...DEFAULT_EXTRA.management]));
    expect(sorted(rightsOf(makeUser('usr_010', { systemRole: 'accounting' }), undefined))).toEqual(sorted([...BASIC_ON, ...DEFAULT_EXTRA.accounting]));
  });

  it('gives Management, Accounting and Member none of the powers that no role holds today', () => {
    const none = ['project.details.all', 'project.team.all', 'project.stages.all', 'project.deadlines.all', 'project.template.all', 'project.archive.all',
      'project.leader.all', 'project.health.all', 'project.delete.lead', 'project.delete.all', 'project.code', 'task.review.all', 'task.any.all',
      'ai.undoOthers.all', 'subCompanies.manage', 'templates.updateProjects', 'feedback.manage', 'gaps.view', 'clients.change', 'office.settings',
      'task.officeAll', 'task.add.all', 'templates.projectAny', 'templates.taskAny', 'templates.taskSave.all'];
    for (const role of ['management', 'accounting', 'member'] as const) {
      const held = rightsOf(makeUser('usr_010', { systemRole: role }), undefined);
      for (const right of none) expect(held, `${role} ${right}`).not.toContain(right);
    }
    expect(NEW.length).toBe(10);
  });

  it('gives a custom role with the old rights the same powers as before', () => {
    const role = { id: 'rol_001', name: 'Payments', nameAr: 'المدفوعات', rights: ['project.delete', 'payment.manage'] as StoredRight[] };
    const held = rightsOf({ ...member, roleId: 'rol_001' }, { custom: [role] });
    // The old right project.delete stands for the switch of every project only (the sibling for the projects the person leads stays off).
    expect(held).toEqual(expect.arrayContaining(['payment.view', 'payment.add', 'payment.change', 'payment.receive', 'project.delete.all']));
    expect(held).not.toContain('project.delete.lead');
    expect(held).toHaveLength(BASIC_ON.length + 5);
  });

  it('gives the Admin all 119 switches, the old ones and the new ones', () => {
    const held = rightsOf(admin, { rights: { member: [] } });
    expect([...held]).toEqual([...OFFICE_RIGHTS]);
    for (const right of NEW.flatMap((id) => expandRights([id]))) expect(held).toContain(right);
  });

  it('gives a Member with a custom role the powers of that role, and no more', () => {
    const role = { id: 'rol_002', name: 'Lead', nameAr: 'قيادة', rights: ['project.editAny', 'feedback.manage'] as StoredRight[] };
    const roles = { custom: [role] };
    const person = withOfficeRights({ ...member, roleId: 'rol_002' }, roles);
    expect(can(person, 'project.details', outsider)).toBe(true);
    expect(can(person, 'feedback.manage')).toBe(true);
    expect(can(person, 'project.archive', outsider)).toBe(false);
    expect(can(person, 'gaps.view')).toBe(false);
  });
});

describe('the Admin page opens for the new section rights', () => {
  it('names the switches that open a section', () => {
    expect([...ADMIN_PAGE_RIGHTS].sort()).toEqual([
      'clients.change', 'feedback.manage', 'office.settings', 'people.change', 'people.invite', 'people.remove', 'people.teams', 'people.turnOff',
      'subCompanies.manage', 'templates.projectAny', 'templates.projectCreate', 'templates.taskAny', 'templates.updateProjects',
    ]);
  });

  it('opens the page for a Member who holds one of them', () => {
    for (const right of ['feedback.manage', 'subCompanies.manage', 'templates.updateProjects'] as StoredRight[]) {
      expect(opensAdminPage(withRights([right])), right).toBe(true);
    }
  });

  it('keeps the page closed for the rights that open no section', () => {
    const closed: StoredRight[] = ['project.editAny', 'task.changeAny', 'gaps.view', 'agents.undoAny', 'task.reviewAny', 'project.archiveAny', 'project.changeLeaderAny'];
    for (const right of closed) expect(opensAdminPage(withRights([right])), right).toBe(false);
  });
});
