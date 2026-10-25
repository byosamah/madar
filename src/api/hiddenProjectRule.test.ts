import { describe, expect, it } from 'vitest';
import { makeProject, makeUser, makeWorld } from '../test/factories';
import type { OfficeRight } from './contract/entities';
import { can, holdsRight, mayViewProject, projectAccessOf, projectResource } from './permissions';
import { rightsOf, withRights } from './rights';
import { BASIC_ON, CATALOG_RIGHT_IDS, DEFAULT_EXTRA } from './rightsCatalog';
import { memberKey, type State } from './store';

/**
 * The view rule of a project (hidden projects, owner 2026-10-22). prj_001 is open (leader usr_002, team usr_003). prj_002 is hidden
 * (leader usr_002, team usr_003, chosen usr_006). usr_004 is a Member outside both. usr_007 is Management. usr_001 is the Admin.
 */
function world(): State {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Chosen' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Management', systemRole: 'management' });
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', leaderId: 'usr_002', access: { hidden: true, viewerIds: ['usr_006'] } });
  for (const userId of ['usr_002', 'usr_003']) state.members[memberKey('prj_002', userId)] = { projectId: 'prj_002', userId, discipline: 'Architect' };
  return state;
}

const sees = (state: State, projectId: string, userId: string) => mayViewProject(state, state.projects[projectId], state.users[userId]);

describe('the catalog holds the four rights of hidden projects', () => {
  it('has See every project and Choose who sees (lead) on for every role, and the other two for the Admin only', () => {
    expect(BASIC_ON).toContain('project.seeAll');
    expect(BASIC_ON).toContain('project.access.lead');
    expect(BASIC_ON).not.toContain('project.access.all');
    expect(BASIC_ON).not.toContain('project.hidden');
    for (const role of ['management', 'accounting', 'member'] as const) {
      expect(DEFAULT_EXTRA[role]).not.toContain('project.access.all');
      expect(DEFAULT_EXTRA[role]).not.toContain('project.hidden');
    }
    for (const id of ['project.seeAll', 'project.access.lead', 'project.access.all', 'project.hidden'] as const) expect(CATALOG_RIGHT_IDS).toContain(id);
    expect(CATALOG_RIGHT_IDS).toHaveLength(118);
  });

  it('gives the Admin all four and a Member the two basic ones', () => {
    const state = world();
    expect(rightsOf(state.users.usr_001, state.settings.roles)).toEqual(expect.arrayContaining(['project.seeAll', 'project.access.lead', 'project.access.all', 'project.hidden']));
    const member = rightsOf(state.users.usr_004, state.settings.roles);
    expect(member).toEqual(expect.arrayContaining(['project.seeAll', 'project.access.lead']));
    expect(member).not.toContain('project.hidden');
    expect(member).not.toContain('project.access.all');
  });
});

describe('mayViewProject', () => {
  it('shows an open project to every active person with the default rights', () => {
    const state = world();
    for (const userId of ['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_006', 'usr_007']) expect(sees(state, 'prj_001', userId), userId).toBe(true);
  });

  it('shows a hidden project to its leader, its team, its chosen people and the Admin only', () => {
    const state = world();
    for (const userId of ['usr_001', 'usr_002', 'usr_003', 'usr_006']) expect(sees(state, 'prj_002', userId), userId).toBe(true);
    for (const userId of ['usr_004', 'usr_007']) expect(sees(state, 'prj_002', userId), userId).toBe(false);
  });

  it('shows a hidden project to a Management person who holds See hidden projects', () => {
    const state = world();
    state.settings.roles = { rights: { management: [...DEFAULT_EXTRA.management, 'project.hidden'] } };
    expect(sees(state, 'prj_002', 'usr_007')).toBe(true);
    expect(sees(state, 'prj_002', 'usr_004')).toBe(false);
  });

  it('hides an open project from a role without See every project, unless the person works on it', () => {
    const state = world();
    state.settings.roles = { off: { member: ['project.seeAll'] as OfficeRight[] } };
    expect(sees(state, 'prj_001', 'usr_004')).toBe(false);
    expect(sees(state, 'prj_001', 'usr_003')).toBe(true);
    expect(sees(state, 'prj_001', 'usr_002')).toBe(true);
    // The Admin keeps every project, and Management keeps its switch.
    expect(sees(state, 'prj_001', 'usr_001')).toBe(true);
    expect(sees(state, 'prj_001', 'usr_007')).toBe(true);
  });

  it('shows a project to a chosen person also when the role lacks See every project', () => {
    const state = world();
    state.settings.roles = { off: { member: ['project.seeAll'] as OfficeRight[] } };
    expect(sees(state, 'prj_002', 'usr_006')).toBe(true);
    state.projects.prj_001.access = { hidden: false, viewerIds: ['usr_004'] };
    expect(sees(state, 'prj_001', 'usr_004')).toBe(true);
  });

  it('never shows a hidden project to a person who left the office, but keeps an open project as before', () => {
    const state = world();
    state.users.usr_003.active = false;
    expect(sees(state, 'prj_002', 'usr_003')).toBe(false);
    expect(sees(state, 'prj_001', 'usr_003')).toBe(true);
  });

  it('reads a missing access field as an open project with no chosen people', () => {
    const state = world();
    expect(projectAccessOf(state.projects.prj_001, 'usr_004')).toEqual({ hidden: false, chosen: false });
    expect(projectAccessOf(state.projects.prj_002, 'usr_006')).toEqual({ hidden: true, chosen: true });
  });
});

describe('can() reads the same rule', () => {
  it('answers project.view, task.view and comment.read of a project resource with the view rule', () => {
    const state = world();
    const outsider = withRights(state, state.users.usr_004);
    const chosen = withRights(state, state.users.usr_006);
    for (const action of ['project.view', 'task.view', 'comment.read'] as const) {
      expect(can(outsider, action, projectResource(state, 'prj_002', 'usr_004')), action).toBe(false);
      expect(can(chosen, action, projectResource(state, 'prj_002', 'usr_006')), action).toBe(true);
      expect(can(outsider, action, projectResource(state, 'prj_001', 'usr_004')), action).toBe(true);
    }
  });

  it('denies a person who is not on the project when the resource names the role but carries no access facts (fail closed)', () => {
    const state = world();
    const outsider = withRights(state, state.users.usr_004);
    const chosen = withRights(state, state.users.usr_006);
    for (const action of ['project.view', 'task.view', 'comment.read'] as const) {
      expect(can(outsider, action, { projectRole: 'other' }), action).toBe(false);
      expect(can(chosen, action, { projectRole: 'other' }), `${action} chosen`).toBe(false);
      // The leader and the team need no facts, and the holder of See hidden projects sees every project.
      expect(can(withRights(state, state.users.usr_002), action, { projectRole: 'leader' }), `${action} leader`).toBe(true);
      expect(can(withRights(state, state.users.usr_003), action, { projectRole: 'team' }), `${action} team`).toBe(true);
      expect(can(withRights(state, state.users.usr_001), action, { projectRole: 'other' }), `${action} Admin`).toBe(true);
    }
  });

  it('denies a resource with no project facts at all to everyone but a holder of See hidden projects', () => {
    const state = world();
    for (const action of ['project.view', 'task.view', 'comment.read'] as const) {
      expect(can(withRights(state, state.users.usr_004), action), action).toBe(false);
      expect(can(withRights(state, state.users.usr_004), action, {}), action).toBe(false);
      expect(can(withRights(state, state.users.usr_001), action), `${action} Admin`).toBe(true);
    }
  });

  it('never shows a project to a person who left the office when the facts are missing', () => {
    const state = world();
    state.users.usr_004.active = false;
    expect(can(withRights(state, state.users.usr_004), 'project.view', { projectRole: 'other' })).toBe(false);
    expect(can(withRights(state, state.users.usr_004), 'project.view', projectResource(state, 'prj_001', 'usr_004'))).toBe(true);
  });

  it('asks the scope rule for Choose who sees a project', () => {
    const state = world();
    const leader = withRights(state, state.users.usr_002);
    const member = withRights(state, state.users.usr_003);
    const admin = withRights(state, state.users.usr_001);
    expect(can(leader, 'project.access', { projectRole: 'leader' })).toBe(true);
    expect(can(member, 'project.access', { projectRole: 'team' })).toBe(false);
    expect(can(leader, 'project.access', { projectRole: 'other' })).toBe(false);
    expect(can(admin, 'project.access', { projectRole: 'other' })).toBe(true);
    expect(holdsRight(member, 'project.hidden')).toBe(false);
    expect(holdsRight(admin, 'project.hidden')).toBe(true);
  });
});
