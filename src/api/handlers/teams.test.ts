import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { insightCalls } from './insights';
import { projectCalls } from './projects';
import { teamCalls } from './teams';
import { makeProject, makeUser, makeWorld, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { memberKey } from '../store';

const calls = { ...teamCalls, ...projectCalls, ...historyCalls, ...insightCalls };

beforeEach(() => setNow(NOW));

/** The world of the factories plus a Management person (usr_006), two more people (usr_007, usr_008) and a second project led by usr_004. */
function office() {
  const state = makeWorld();
  state.users.usr_006 = makeUser('usr_006', { name: 'Turki Management', systemRole: 'management' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Lina Interior' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Yousef MEP' });
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Second Tower', leaderId: 'usr_004' });
  state.counters.usr = 8;
  return testApi(calls, state);
}

describe('office teams', () => {
  it('lets Admin and Management make, change and delete teams, and refuses everyone else', async () => {
    const t = office();
    const design = await t.api.call('teams.create', { name: 'Design', memberIds: ['usr_002', 'usr_003'] });
    expect(design).toMatchObject({ id: 'tm_001', name: 'Design', memberIds: ['usr_002', 'usr_003'] });
    expect(design.members.map((m) => m.name)).toEqual(['Faisal Leader', 'Sara Team']);
    t.as('usr_006');
    const site = await t.api.call('teams.create', { name: 'Site' });
    expect(site.memberIds).toEqual([]);
    expect((await t.api.call('teams.update', { id: site.id, memberIds: ['usr_007'] })).memberIds).toEqual(['usr_007']);
    await t.api.call('teams.delete', { id: site.id });
    t.as('usr_003');
    await expect(t.api.call('teams.create', { name: 'Mine' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('teams.update', { id: design.id, name: 'Other' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('teams.delete', { id: design.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(Object.keys(t.store.state.teams ?? {})).toEqual(['tm_001']);
  });

  it('works in an office saved before teams existed', async () => {
    const t = office();
    delete t.store.state.teams;
    expect(await t.api.call('teams.list', {})).toEqual([]);
    expect(await t.api.call('projects.list', { teamId: 'tm_001' })).toEqual([]);
    delete t.store.state.teams;
    expect((await t.api.call('teams.create', { name: 'First' })).id).toBe('tm_001');
  });

  it('lets every person read the teams, by name', async () => {
    const t = office();
    await t.api.call('teams.create', { name: 'Technical' });
    await t.api.call('teams.create', { name: 'Design' });
    t.as('usr_004');
    expect((await t.api.call('teams.list', {})).map((team) => team.name)).toEqual(['Design', 'Technical']);
  });

  it('keeps names unique, ignoring case, and renames a team to its own name without a refusal', async () => {
    const t = office();
    const design = await t.api.call('teams.create', { name: 'Design' });
    await expect(t.api.call('teams.create', { name: ' design ' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['name'], reason: 'duplicate_team' } });
    const other = await t.api.call('teams.create', { name: 'Site' });
    await expect(t.api.call('teams.update', { id: other.id, name: 'DESIGN' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await t.api.call('teams.update', { id: design.id, name: 'DESIGN' })).name).toBe('DESIGN');
    await expect(t.api.call('teams.create', { name: '  ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('teams.create', { name: 'x'.repeat(61) })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('holds active people only, each person once', async () => {
    const t = office();
    await expect(t.api.call('teams.create', { name: 'With agent', memberIds: ['usr_005'] })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['memberIds'] } });
    t.store.state.users.usr_008.active = false;
    await expect(t.api.call('teams.create', { name: 'With leaver', memberIds: ['usr_008'] })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('teams.create', { name: 'Ghost', memberIds: ['usr_099'] })).rejects.toMatchObject({ code: 'not_found' });
    const team = await t.api.call('teams.create', { name: 'Twice', memberIds: ['usr_002', 'usr_002'] });
    expect(team.memberIds).toEqual(['usr_002']);
    // A person who leaves the office later drops out of what a screen reads, not out of the stored list.
    t.store.state.users.usr_002.active = false;
    expect((await t.api.call('teams.list', {}))[0].members).toEqual([]);
  });

  it('lets one person be in several teams', async () => {
    const t = office();
    await t.api.call('teams.create', { name: 'Design', memberIds: ['usr_003'] });
    await t.api.call('teams.create', { name: 'Interiors', memberIds: ['usr_003', 'usr_007'] });
    const rows = await t.api.call('teams.list', {});
    expect(rows.filter((team) => team.memberIds.includes('usr_003'))).toHaveLength(2);
  });

  it('brings a deleted team back with Undo, and undoes a rename', async () => {
    const t = office();
    const team = await t.api.call('teams.create', { name: 'Design', memberIds: ['usr_003'] });
    await t.api.call('teams.update', { id: team.id, name: 'Studio' });
    const events = Object.values(t.store.state.events).filter((e) => e.targetType === 'team');
    expect(events.map((e) => e.verb)).toEqual(['team.created', 'team.updated']);
    await t.api.call('events.undo', { eventId: events[1].id });
    expect(t.store.state.teams?.[team.id].name).toBe('Design');
    await t.api.call('teams.delete', { id: team.id });
    expect(t.store.state.teams?.[team.id]).toBeUndefined();
    const deleted = Object.values(t.store.state.events).find((e) => e.verb === 'team.deleted');
    await t.api.call('events.undo', { eventId: deleted!.id });
    expect(t.store.state.teams?.[team.id]).toMatchObject({ name: 'Design', memberIds: ['usr_003'] });
  });

  it('refuses an Undo of a team change to a person who may not manage teams', async () => {
    const t = office();
    const team = await t.api.call('teams.create', { name: 'Design' });
    await t.api.call('teams.delete', { id: team.id });
    const deleted = Object.values(t.store.state.events).find((e) => e.verb === 'team.deleted')!;
    // Another Admin-less person cannot undo it: the event is not theirs, and they lack the right.
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: deleted.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('adding a team to a project', () => {
  it('adds the people who are not on the project yet, and says how many', async () => {
    const t = office();
    const team = await t.api.call('teams.create', { name: 'Design', memberIds: ['usr_002', 'usr_003', 'usr_007', 'usr_008'] });
    t.as('usr_002');
    const result = await t.api.call('members.addTeam', { projectId: 'prj_001', teamId: team.id });
    expect(result.added).toBe(2);
    expect(result.detail.members.map((m) => m.user.id).sort()).toEqual(['usr_002', 'usr_003', 'usr_007', 'usr_008']);
    expect(t.store.state.members[memberKey('prj_001', 'usr_007')]).toMatchObject({ discipline: 'Architect' });
    const again = await t.api.call('members.addTeam', { projectId: 'prj_001', teamId: team.id });
    expect(again.added).toBe(0);
  });

  it('sends each new person the same notice as adding one person, and nobody else', async () => {
    const t = office();
    const team = await t.api.call('teams.create', { name: 'Design', memberIds: ['usr_003', 'usr_007'] });
    t.as('usr_002');
    await t.api.call('members.addTeam', { projectId: 'prj_001', teamId: team.id });
    const notices = Object.values(t.store.state.notifications).filter((n) => n.trigger === 'added_to_project');
    expect(notices.map((n) => n.userId)).toEqual(['usr_007']);
    expect(notices[0]).toMatchObject({ targetType: 'project', targetId: 'prj_001', actorId: 'usr_002' });
  });

  it('skips a person who left the office', async () => {
    const t = office();
    const team = await t.api.call('teams.create', { name: 'Design', memberIds: ['usr_007', 'usr_008'] });
    t.store.state.users.usr_008.active = false;
    t.as('usr_002');
    expect((await t.api.call('members.addTeam', { projectId: 'prj_001', teamId: team.id })).added).toBe(1);
    expect(t.store.state.members[memberKey('prj_001', 'usr_008')]).toBeUndefined();
  });

  it('follows the rule of adding one person: the leader and the Admin only', async () => {
    const t = office();
    const team = await t.api.call('teams.create', { name: 'Design', memberIds: ['usr_007'] });
    for (const userId of ['usr_003', 'usr_004', 'usr_006']) {
      t.as(userId);
      await expect(t.api.call('members.addTeam', { projectId: 'prj_001', teamId: team.id })).rejects.toMatchObject({ code: 'forbidden' });
      await expect(t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_007' })).rejects.toMatchObject({ code: 'forbidden' });
    }
    t.as('usr_001');
    expect((await t.api.call('members.addTeam', { projectId: 'prj_001', teamId: team.id })).added).toBe(1);
    await expect(t.api.call('members.addTeam', { projectId: 'prj_001', teamId: 'tm_099' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('the Team filter', () => {
  async function filtered() {
    const t = office();
    // usr_007 is on the second project only. usr_002 leads the first. usr_003 is on the first.
    t.store.state.members[memberKey('prj_002', 'usr_007')] = { projectId: 'prj_002', userId: 'usr_007', discipline: 'Interior' };
    t.store.state.members[memberKey('prj_002', 'usr_004')] = { projectId: 'prj_002', userId: 'usr_004', discipline: 'Architect' };
    const lead = await t.api.call('teams.create', { name: 'Leaders', memberIds: ['usr_002'] });
    const interiors = await t.api.call('teams.create', { name: 'Interiors', memberIds: ['usr_007'] });
    const both = await t.api.call('teams.create', { name: 'Both', memberIds: ['usr_003', 'usr_007'] });
    const nobody = await t.api.call('teams.create', { name: 'Nobody', memberIds: ['usr_008'] });
    return { t, lead, interiors, both, nobody };
  }

  it('matches a project when any person of the team leads it or is on its team', async () => {
    const { t, lead, interiors, both, nobody } = await filtered();
    const ids = async (teamId: string) => (await t.api.call('projects.list', { teamId })).map((s) => s.project.id).sort();
    expect(await ids(lead.id)).toEqual(['prj_001']);
    expect(await ids(interiors.id)).toEqual(['prj_002']);
    expect(await ids(both.id)).toEqual(['prj_001', 'prj_002']);
    expect(await ids(nobody.id)).toEqual([]);
    expect((await t.api.call('projects.list', {})).map((s) => s.project.id).sort()).toEqual(['prj_001', 'prj_002']);
  });

  it('matches nothing for a team that does not exist, as a leader that does not exist does', async () => {
    const { t } = await filtered();
    expect(await t.api.call('projects.list', { teamId: 'tm_099' })).toEqual([]);
    expect((await t.api.call('dashboard.get', { teamId: 'tm_099' })).tiles.activeProjects).toBe(0);
  });

  it('narrows every number of the Dashboard', async () => {
    const { t, interiors, both } = await filtered();
    expect((await t.api.call('dashboard.get', {})).tiles.activeProjects).toBe(2);
    const one = await t.api.call('dashboard.get', { teamId: interiors.id });
    expect(one.tiles.activeProjects).toBe(1);
    expect(one.schedule.map((row) => row.project.id)).toEqual(['prj_002']);
    expect((await t.api.call('dashboard.get', { teamId: both.id })).tiles.activeProjects).toBe(2);
  });
});
