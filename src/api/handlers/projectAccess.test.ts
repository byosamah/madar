import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { mayViewProject } from '../permissions';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * projects.setAccess (hidden projects, owner 2026-10-22): the leader and the Admin choose who sees a project. prj_001: leader usr_002, team
 * usr_003. usr_004 is outside. usr_006 and usr_008 are other members. usr_007 left the office. usr_009 is the agent of the leader.
 */
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Member' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Gone Member', active: false });
  state.users.usr_008 = makeUser('usr_008', { name: 'Noor Member' });
  state.users.usr_009 = makeUser('usr_009', { name: 'Leader Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_002' });
  state.counters.usr = 9;
  return t;
}

describe('projects.setAccess', () => {
  it('lets the leader hide the project and choose people, with one event that keeps the old and the new value', async () => {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_006', 'usr_008'] });
    expect(detail.project.access).toEqual({ hidden: true, viewerIds: ['usr_006', 'usr_008'] });
    const events = Object.values(t.store.state.events).filter((e) => e.verb === 'project.access_changed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ targetType: 'project', targetId: 'prj_001', projectId: 'prj_001' });
    expect(events[0].before).toEqual({ access: undefined });
    expect(events[0].after).toEqual({ access: { hidden: true, viewerIds: ['usr_006', 'usr_008'] } });
  });

  it('lets the Admin choose for any project, and refuses a team member, an outsider and the agent of an outsider', async () => {
    const t = world();
    t.as('usr_001');
    await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] })).resolves.toBeDefined();
    for (const person of ['usr_003', 'usr_004', 'usr_005']) {
      t.as(person);
      await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: false, viewerIds: [] }), person).rejects.toMatchObject({ code: 'forbidden' });
    }
  });

  it('lets the agent of the leader choose, with the rights of the leader', async () => {
    const t = world();
    t.as('usr_009');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] });
    expect(t.store.state.projects.prj_001.access?.hidden).toBe(true);
  });

  it('refuses a leader whose role lost Choose who sees a project (the Admin can turn it off)', async () => {
    const t = world();
    t.store.state.settings.roles = { off: { member: ['project.access.lead'] } };
    t.as('usr_002');
    await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: [] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('tells a new chosen person with added_to_project, and nobody who is on the team already', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_006', 'usr_003', 'usr_002'] });
    const notices = Object.values(t.store.state.notifications).filter((n) => n.trigger === 'added_to_project');
    expect(notices.map((n) => n.userId)).toEqual(['usr_006']);
    expect(notices[0]).toMatchObject({ targetType: 'project', targetId: 'prj_001' });
    // The same list again changes nothing and tells nobody.
    const before = Object.keys(t.store.state.notifications).length;
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_006', 'usr_003', 'usr_002'] });
    expect(Object.keys(t.store.state.notifications)).toHaveLength(before);
    expect(Object.values(t.store.state.events).filter((e) => e.verb === 'project.access_changed')).toHaveLength(1);
  });

  it('makes a chosen person see the hidden project, and keeps the others out', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_006'] });
    const state = t.store.state;
    const sees = (id: string) => mayViewProject(state, state.projects.prj_001, state.users[id]);
    expect(['usr_001', 'usr_002', 'usr_003', 'usr_006'].map(sees)).toEqual([true, true, true, true]);
    expect([sees('usr_004'), sees('usr_008')]).toEqual([false, false]);
  });

  it('keeps the chosen people while the project is open, and drops the list entries with no repeat', async () => {
    const t = world();
    t.as('usr_002');
    const detail = await t.api.call('projects.setAccess', { id: 'prj_001', hidden: false, viewerIds: ['usr_006', 'usr_006'] });
    expect(detail.project.access).toEqual({ hidden: false, viewerIds: ['usr_006'] });
  });

  it('makes no event for an open project that stays open with no chosen people', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: false, viewerIds: [] });
    expect(Object.values(t.store.state.events).filter((e) => e.verb === 'project.access_changed')).toHaveLength(0);
    expect(t.store.state.projects.prj_001.access).toBeUndefined();
  });

  it('refuses a new chosen person who left, an agent and an unknown person, and takes more than 50 people as invalid input', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_007'] })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'person_inactive' } });
    await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_009'] })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'viewer_agent' } });
    await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_099'] })).rejects.toMatchObject({ code: 'not_found' });
    const many = Array.from({ length: 51 }, (_, i) => `usr_${String(i + 100).padStart(3, '0')}`);
    await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: many })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.projects.prj_001.access).toBeUndefined();
  });

  it('keeps a person in the list who has left since, when the list is saved again', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_006'] });
    t.store.state.users.usr_006.active = false;
    await expect(t.api.call('projects.setAccess', { id: 'prj_001', hidden: false, viewerIds: ['usr_006'] })).resolves.toBeDefined();
  });

  it('answers a missing project with not_found', async () => {
    const t = world();
    t.as('usr_001');
    await expect(t.api.call('projects.setAccess', { id: 'prj_404', hidden: true, viewerIds: [] })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('is taken back by Undo, by the person who may choose', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('projects.setAccess', { id: 'prj_001', hidden: true, viewerIds: ['usr_006'] });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'project.access_changed')!;
    // A team member may not take it back.
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: event.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.projects.prj_001.access).toBeUndefined();
  });
});
