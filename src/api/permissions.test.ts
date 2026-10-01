import { describe, expect, it } from 'vitest';
import { can, principalOf, projectRoleOf, type Action, type ProjectRole } from './permissions';
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
  ['project.healthOverride', [true, true, false, false], none],
  ['task.createForAnyone', [true, true, false, false], none],
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
