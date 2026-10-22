import { describe, expect, it } from 'vitest';
import { can, mayViewMeeting, meetingResource, principalOf, projectRoleOf, type Action, type ProjectRole } from './permissions';
import { withOfficeRights } from './rights';
import type { User } from './contract/entities';
import { makeUser, makeWorld } from '../test/factories';

const admin = makeUser('usr_001', { systemRole: 'admin' });
// The people carry the office rights of a Member (rights.ts): a person with none attached holds none (fail closed).
const leader = withOfficeRights(makeUser('usr_002'), undefined);
const team = withOfficeRights(makeUser('usr_003'), undefined);
const other = withOfficeRights(makeUser('usr_004'), undefined);
const actors: [string, User, ProjectRole][] = [
  ['admin', admin, 'other'],
  ['leader', leader, 'leader'],
  ['team', team, 'team'],
  ['other', other, 'other'],
];

const none = () => ({});
/** The facts of an open project: the view rule fails closed without them (hidden projects). */
const open = () => ({ access: { hidden: false, chosen: false } });
const own = (u: User) => ({ ownerId: u.id, authorId: u.id });

// Expected results for admin, leader, team, other. Copied from spec section 2.3.
const TABLE: [Action, [boolean, boolean, boolean, boolean], (u: User) => Record<string, unknown>][] = [
  ['project.view', [true, true, true, true], open],
  ['project.create', [true, true, true, true], none],
  ['project.details', [true, true, false, false], none],
  ['project.team', [true, true, false, false], none],
  ['project.stages', [true, true, false, false], none],
  ['project.deadlines', [true, true, false, false], none],
  ['project.template', [true, true, false, false], none],
  ['project.leader', [true, true, false, false], none],
  ['project.archive', [true, true, false, false], none],
  ['project.delete', [true, false, false, false], none],
  ['project.code', [true, false, false, false], none],
  ['project.health', [true, true, false, false], none],
  // A team member adds a to-do and names any team mate as lead (owner, 2026-10-07).
  ['task.add', [true, true, true, false], none],
  ['task.assign', [true, true, true, true], none],
  ['task.work', [true, true, true, false], own],
  ['task.details', [true, true, true, false], own],
  ['task.dates', [true, true, true, false], own],
  ['task.any', [true, true, false, false], none],
  ['task.review', [true, true, false, false], none],
  ['file.deleteAny', [true, true, false, false], none],
  ['tracker.deleteAny', [true, true, false, false], none],
  ['post.create', [true, true, true, false], none],
  ['comment.create', [true, true, true, false], none],
  ['file.upload', [true, true, true, false], none],
  ['tracker.log', [true, true, true, false], none],
  ['post.editOwn', [true, true, true, false], own],
  ['file.deleteOwn', [true, true, true, false], own],
  ['ai.undoOthers', [true, true, false, false], none],
  ['admin.manage', [true, false, false, false], none],
  // The office rights (rights.ts). The Admin holds each of them; the other three columns hold none by default.
  ['people.invite', [true, false, false, false], none],
  ['people.remove', [true, false, false, false], none],
  ['payment.view', [true, false, false, false], none],
  ['payment.add', [true, false, false, false], none],
  ['clients.change', [true, false, false, false], none],
  ['templates.projectAny', [true, false, false, false], none],
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
    for (const action of ['people.invite', 'people.change', 'people.teams', 'people.turnOff', 'people.remove'] as const) expect(can(management, action), action).toBe(true);
    for (const action of ['payment.view', 'payment.add', 'payment.change', 'payment.receive'] as const) expect(can(management, action), action).toBe(true);
    expect(can(management, 'report.office')).toBe(true);
    expect(can(management, 'project.delete')).toBe(false);
    expect(can(management, 'clients.change')).toBe(false);
  });

  it('lets accounting see and change the payments only', () => {
    for (const action of ['payment.view', 'payment.add', 'payment.change', 'payment.receive'] as const) expect(can(accounting, action), action).toBe(true);
    expect(can(accounting, 'people.invite')).toBe(false);
    expect(can(accounting, 'report.office')).toBe(false);
  });
});

describe('permission details', () => {
  it('stops a team member from changing a task they do not own', () => {
    for (const action of ['task.work', 'task.details', 'task.dates'] as const) expect(can(team, action, { projectRole: 'team', ownerId: 'usr_002' }), action).toBe(false);
    expect(can(team, 'task.any', { projectRole: 'team', ownerId: 'usr_002' })).toBe(false);
  });

  it('lets the lead of a task change it with the switch of each kind of change', () => {
    for (const action of ['task.work', 'task.details', 'task.dates'] as const) expect(can(team, action, { projectRole: 'team', ownerId: 'usr_003' }), action).toBe(true);
  });

  it('stops a team member from editing a comment they did not write', () => {
    expect(can(team, 'post.editOwn', { projectRole: 'team', authorId: 'usr_002' })).toBe(false);
    expect(can(team, 'post.editOwn', { projectRole: 'team', authorId: 'usr_003' })).toBe(true);
  });

  it('lets an inactive person only view', () => {
    const gone = makeUser('usr_009', { active: false, systemRole: 'admin' });
    expect(can(gone, 'project.view', open())).toBe(true);
    // Without the access facts, or for a hidden project, a person who left sees nothing.
    expect(can(gone, 'project.view')).toBe(false);
    expect(can(gone, 'project.view', { access: { hidden: true, chosen: false } })).toBe(false);
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
  // The minutes: the switch for the own meetings (organizer or attendee) or the switch for any meeting of the project.
  const writes = (actor: User, resource: ReturnType<typeof meetingResource>) => can(actor, 'meeting.minutesOwn', resource) || can(actor, 'meeting.minutesAny', resource);
  // view, plan, edit (the organizer's switch or the switch for any meeting of the project).
  const rights = (projectId: string | null, actor: User) => {
    const on = meetingResource(state, { projectId, ...mine }, actor.id);
    return [can(actor, 'meeting.view', on), can(actor, 'meeting.plan', on), can(actor, 'meeting.editOwn', on) || can(actor, 'meeting.any', on)];
  };

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
    const minutes = (projectId: string | null, actor: User) => writes(actor, meetingResource(state, { projectId, ...mine }, actor.id));
    // admin, leader, team (the organizer), other (an attendee).
    expect(people.map((actor) => minutes('prj_001', actor))).toEqual([true, true, true, true]);
    // A team member who did not attend: Sara leads nothing and is not on the meeting.
    const sideline = { organizerId: 'usr_004', attendeeIds: [] as string[] };
    expect(writes(team, meetingResource(state, { projectId: 'prj_001', ...sideline }, team.id))).toBe(false);
    expect(writes(leader, meetingResource(state, { projectId: 'prj_001', ...sideline }, leader.id))).toBe(true);
    expect(writes(admin, meetingResource(state, { projectId: 'prj_001', ...sideline }, admin.id))).toBe(true);
  });

  it('lets only the organizer and the attendees write the minutes of a meeting with no project, the Admin only when invited', () => {
    const minutes = (actor: User, attendeeIds: string[]) => writes(actor, meetingResource(state, { projectId: null, organizerId: 'usr_003', attendeeIds }, actor.id));
    expect(people.map((actor) => minutes(actor, ['usr_004']))).toEqual([false, false, true, true]);
    expect(minutes(admin, ['usr_001'])).toBe(true);
  });

  it('reads the organizer behind an agent, and gives nothing to a person who left', () => {
    const agent = makeUser('usr_005', { kind: 'agent', ownerId: 'usr_003', discipline: 'Agent' });
    state.users.usr_005 = agent;
    const viaAgent = { projectId: null, organizerId: 'usr_005', attendeeIds: [] as string[] };
    expect(can(team, 'meeting.editOwn', meetingResource(state, viaAgent, team.id))).toBe(true);
    expect(can(other, 'meeting.view', meetingResource(state, viaAgent, other.id))).toBe(false);
    const gone = makeUser('usr_003', { active: false });
    expect(can(gone, 'meeting.view', meetingResource(state, { projectId: 'prj_001', ...mine }, gone.id))).toBe(false);
    expect(can(gone, 'meeting.plan', { meeting: { organizerId: gone.id, attendeeIds: [], noProject: true } })).toBe(false);
    expect(writes(gone, meetingResource(state, { projectId: 'prj_001', ...mine }, gone.id))).toBe(false);
  });

  it('answers false for a meeting action that has no meeting, and for a task action on a meeting', () => {
    expect(can(admin, 'meeting.view', {})).toBe(false);
    expect(can(admin, 'task.view', meetingResource(state, { projectId: null, ...mine }, admin.id))).toBe(false);
  });
});
