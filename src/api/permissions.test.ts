import { describe, expect, it } from 'vitest';
import { can, mayViewMeeting, meetingResource, principalOf, projectRoleOf, type Action, type ProjectRole } from './permissions';
import { withOfficeRights } from './rights';
import type { User } from './contract/entities';
import { makeUser, makeWorld } from '../test/factories';

const admin = makeUser('usr_001', { systemRole: 'admin' });
const leader = makeUser('usr_002');
const team = makeUser('usr_003');
const other = makeUser('usr_004');
const actors: [string, User, ProjectRole][] = [
  ['admin', admin, 'other'],
  ['leader', leader, 'leader'],
  ['team', team, 'team'],
  ['other', other, 'other'],
];

const none = () => ({});
const own = (u: User) => ({ ownerId: u.id, authorId: u.id });

// Expected results for admin, leader, team, other. Copied from spec section 2.3.
const TABLE: [Action, [boolean, boolean, boolean, boolean], (u: User) => Record<string, string>][] = [
  ['project.view', [true, true, true, true], none],
  ['project.create', [true, true, true, true], none],
  ['project.edit', [true, true, false, false], none],
  ['project.changeLeader', [true, true, false, false], none],
  ['project.archive', [true, true, false, false], none],
  ['project.delete', [true, false, false, false], none],
  ['project.editCode', [true, false, false, false], none],
  ['project.healthOverride', [true, true, false, false], none],
  // A team member names any team mate as lead (owner, 2026-10-07).
  ['task.createForAnyone', [true, true, true, false], none],
  ['task.createForSelf', [true, true, true, false], none],
  ['task.updateOwn', [true, true, true, false], own],
  ['task.contribute', [true, true, true, false], own],
  ['task.updateAny', [true, true, false, false], none],
  ['task.review', [true, true, false, false], none],
  ['task.delete', [true, true, false, false], none],
  ['content.post', [true, true, true, false], none],
  ['content.editOwn', [true, true, true, false], own],
  ['event.undoAgent', [true, true, false, false], none],
  ['admin.manage', [true, false, false, false], none],
  // The office rights (rights.ts). The Admin holds each of them; the other three columns hold none by default.
  ['people.manage', [true, false, false, false], none],
  ['payment.manage', [true, false, false, false], none],
  ['clients.manage', [true, false, false, false], none],
  ['templates.manageAll', [true, false, false, false], none],
  ['report.office', [true, false, false, false], none],
];

describe('permission table (spec 2.3)', () => {
  for (const [action, expected, extra] of TABLE) {
    actors.forEach(([label, actor, role], i) => {
      it(`${action} for ${label} is ${expected[i]}`, () => {
        expect(can(actor, action, { projectRole: role, ...extra(actor) })).toBe(expected[i]);
      });
    });
  }
});

describe('the default office rights of each system role (fbk_014)', () => {
  // The office rights come from the office settings (rights.ts). A person with none attached holds no office right.
  const management = withOfficeRights(makeUser('usr_006', { systemRole: 'management' }), undefined);
  const accounting = withOfficeRights(makeUser('usr_007', { systemRole: 'accounting' }), undefined);

  it('lets management make people and see the office report, and never delete a project', () => {
    expect(can(management, 'people.manage')).toBe(true);
    expect(can(management, 'payment.manage')).toBe(true);
    expect(can(management, 'report.office')).toBe(true);
    expect(can(management, 'project.delete')).toBe(false);
    expect(can(management, 'clients.manage')).toBe(false);
  });

  it('lets accounting see and change the payments only', () => {
    expect(can(accounting, 'payment.manage')).toBe(true);
    expect(can(accounting, 'people.manage')).toBe(false);
    expect(can(accounting, 'report.office')).toBe(false);
  });
});

describe('permission details', () => {
  it('stops a team member from changing a task they do not own', () => {
    expect(can(team, 'task.updateOwn', { projectRole: 'team', ownerId: 'usr_002' })).toBe(false);
  });

  it('lets a helper contribute to a task but not change it', () => {
    expect(can(team, 'task.contribute', { projectRole: 'team', ownerId: 'usr_002', helperIds: ['usr_003'] })).toBe(true);
    expect(can(team, 'task.updateOwn', { projectRole: 'team', ownerId: 'usr_002' })).toBe(false);
    expect(can(team, 'task.contribute', { projectRole: 'team', ownerId: 'usr_002', helperIds: [] })).toBe(false);
    expect(can(other, 'task.contribute', { projectRole: 'other', ownerId: 'usr_002', helperIds: ['usr_004'] })).toBe(false);
  });

  it('stops a team member from editing a comment they did not write', () => {
    expect(can(team, 'content.editOwn', { projectRole: 'team', authorId: 'usr_002' })).toBe(false);
  });

  it('lets an inactive person only view', () => {
    const gone = makeUser('usr_009', { active: false, systemRole: 'admin' });
    expect(can(gone, 'project.view')).toBe(true);
    expect(can(gone, 'project.create')).toBe(false);
    expect(can(gone, 'admin.manage')).toBe(false);
  });

  it('reads the project role from the state', () => {
    const state = makeWorld();
    expect(projectRoleOf(state, 'prj_001', 'usr_002')).toBe('leader');
    expect(projectRoleOf(state, 'prj_001', 'usr_003')).toBe('team');
    expect(projectRoleOf(state, 'prj_001', 'usr_004')).toBe('other');
    expect(projectRoleOf(state, 'prj_404', 'usr_002')).toBe('other');
  });

  it('finds the person behind an agent', () => {
    const state = makeWorld();
    expect(principalOf(state, 'usr_005')).toBe('usr_003');
    expect(principalOf(state, 'usr_002')).toBe('usr_002');
  });
});

describe('the rights of a meeting (fbk_022, owner 2026-10-19)', () => {
  const state = makeWorld();
  const people = [admin, leader, team, other] as const;
  const mine = { organizerId: 'usr_003', attendeeIds: ['usr_004'] };
  const rights = (projectId: string | null, actor: User) => (['meeting.view', 'meeting.create', 'meeting.edit'] as const).map((action) => can(actor, action, meetingResource(state, { projectId, ...mine }, actor.id)));

  it('lets everyone read a project meeting, the team plan one, and the organizer, the leader and the Admin change it', () => {
    // Order of the people: admin, leader, team (the organizer), other (an attendee).
    expect(people.map((actor) => rights('prj_001', actor))).toEqual([
      [true, true, true], [true, true, true], [true, true, true], [true, false, false],
    ]);
  });

  it('lets only the organizer and the attendees read a meeting with no project, anyone plan one, and only the organizer change it', () => {
    // The Admin is not invited, so the Admin reads and changes nothing (owner, 2026-10-19, Q4).
    expect(people.map((actor) => rights(null, actor))).toEqual([
      [false, true, false], [false, true, false], [true, true, true], [true, true, false],
    ]);
    expect(mayViewMeeting(state, admin, { projectId: null, ...mine })).toBe(false);
    expect(mayViewMeeting(state, admin, { projectId: null, organizerId: 'usr_003', attendeeIds: ['usr_001'] })).toBe(true);
  });

  it('lets the organizer, the attendees, the leader and the Admin write the minutes of a project meeting, and not a team member who did not attend', () => {
    const minutes = (projectId: string | null, actor: User) => can(actor, 'meeting.minutes', meetingResource(state, { projectId, ...mine }, actor.id));
    // admin, leader, team (the organizer), other (an attendee).
    expect(people.map((actor) => minutes('prj_001', actor))).toEqual([true, true, true, true]);
    // A team member who did not attend: Sara leads nothing and is not on the meeting.
    const sideline = { organizerId: 'usr_004', attendeeIds: [] as string[] };
    expect(can(team, 'meeting.minutes', meetingResource(state, { projectId: 'prj_001', ...sideline }, team.id))).toBe(false);
    expect(can(leader, 'meeting.minutes', meetingResource(state, { projectId: 'prj_001', ...sideline }, leader.id))).toBe(true);
    expect(can(admin, 'meeting.minutes', meetingResource(state, { projectId: 'prj_001', ...sideline }, admin.id))).toBe(true);
  });

  it('lets only the organizer and the attendees write the minutes of a meeting with no project, the Admin only when invited', () => {
    const minutes = (actor: User, attendeeIds: string[]) => can(actor, 'meeting.minutes', meetingResource(state, { projectId: null, organizerId: 'usr_003', attendeeIds }, actor.id));
    expect(people.map((actor) => minutes(actor, ['usr_004']))).toEqual([false, false, true, true]);
    expect(minutes(admin, ['usr_001'])).toBe(true);
  });

  it('reads the organizer behind an agent, and gives nothing to a person who left', () => {
    const agent = makeUser('usr_005', { kind: 'agent', ownerId: 'usr_003', discipline: 'Agent' });
    state.users.usr_005 = agent;
    const viaAgent = { projectId: null, organizerId: 'usr_005', attendeeIds: [] as string[] };
    expect(can(team, 'meeting.edit', meetingResource(state, viaAgent, team.id))).toBe(true);
    expect(can(other, 'meeting.view', meetingResource(state, viaAgent, other.id))).toBe(false);
    const gone = makeUser('usr_003', { active: false });
    expect(can(gone, 'meeting.view', meetingResource(state, { projectId: 'prj_001', ...mine }, gone.id))).toBe(false);
    expect(can(gone, 'meeting.create', { meeting: { organizerId: gone.id, attendeeIds: [], noProject: true } })).toBe(false);
    expect(can(gone, 'meeting.minutes', meetingResource(state, { projectId: 'prj_001', ...mine }, gone.id))).toBe(false);
  });

  it('answers false for a meeting action that has no meeting, and for a task action on a meeting', () => {
    expect(can(admin, 'meeting.view', {})).toBe(false);
    expect(can(admin, 'task.view', meetingResource(state, { projectId: null, ...mine }, admin.id))).toBe(false);
  });
});
