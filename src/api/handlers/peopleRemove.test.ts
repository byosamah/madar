import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { taskCalls } from './tasks';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const office = () => testApi({ ...peopleCalls, ...historyCalls, ...projectCalls, ...taskCalls });

// Owner, 2026-10-12: a person who is turned off and will not come back no longer has to stay in the list. The Admin removes them: the
// record stays, so the History, the tasks, the comments and the messages keep their name, but the person leaves every list for good.
// In the test office: usr_001 Hala (Admin), usr_002 Faisal, usr_003 Sara (on prj_001), usr_004 Omar, usr_005 the agent of Sara.
describe('removing a turned-off person (owner, 2026-10-12)', () => {
  it('takes the person out of the people list for good, and keeps the record and its name', async () => {
    const t = office();
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_004', status: 'todo' });
    await t.api.call('users.deactivate', { id: 'usr_004' });
    expect((await t.api.call('users.list', { includeInactive: true })).map((user) => user.id)).toContain('usr_004');
    const removed = await t.api.call('users.remove', { id: 'usr_004' });
    expect(removed).toMatchObject({ id: 'usr_004', active: false, removed: true });
    expect((await t.api.call('users.list', { includeInactive: true })).map((user) => user.id)).not.toContain('usr_004');
    expect((await t.api.call('users.list', {})).map((user) => user.id)).not.toContain('usr_004');
    // The record stays, so what the person did keeps their name.
    expect(t.store.state.users.usr_004.name).toBe('Omar Other');
    expect((await t.api.call('users.get', { id: 'usr_004' })).name).toBe('Omar Other');
    const rows = await t.api.call('tasks.list', { filter: 'all' });
    expect(rows.find((row) => row.task.id === 'tsk_001')!.owner).toMatchObject({ id: 'usr_004', name: 'Omar Other' });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'user.removed');
    expect(event).toMatchObject({ targetType: 'user', targetId: 'usr_004', actorId: 'usr_001' });
  });

  it('refuses a person who is still on, and removes nothing', async () => {
    const t = office();
    await expect(t.api.call('users.remove', { id: 'usr_004' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'still_active' } });
    expect(t.store.state.users.usr_004.removed).toBeUndefined();
    expect((await t.api.call('users.list', {})).map((user) => user.id)).toContain('usr_004');
  });

  it('refuses your own account', async () => {
    const t = office();
    await expect(t.api.call('users.remove', { id: 'usr_001' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.users.usr_001.removed).toBeUndefined();
  });

  it('is for people who manage people: a member is refused, and Management cannot remove an Admin or the agent of an Admin', async () => {
    const t = office();
    // A refused call puts the state back as a new object, so each step reads t.store.state again.
    t.store.state.users.usr_004.active = false;
    t.as('usr_003');
    await expect(t.api.call('users.remove', { id: 'usr_004' })).rejects.toMatchObject({ code: 'forbidden' });
    t.store.state.users.usr_002.systemRole = 'management';
    t.store.state.users.usr_004.systemRole = 'admin';
    t.as('usr_002');
    await expect(t.api.call('users.remove', { id: 'usr_004' })).rejects.toMatchObject({ code: 'forbidden' });
    // Management removes a turned-off member.
    t.store.state.users.usr_004.systemRole = 'member';
    expect((await t.api.call('users.remove', { id: 'usr_004' })).removed).toBe(true);
  });

  it('removes the agents of a removed person with them, so no agent stays between the people', async () => {
    const t = office();
    const s = t.store.state;
    s.users.usr_003.active = false;
    // The agent should be off already, since turning a person off turns their agents off. Even when it is not, it goes with them.
    expect(s.users.usr_005.active).toBe(true);
    await t.api.call('users.remove', { id: 'usr_003' });
    expect(s.users.usr_005).toMatchObject({ removed: true, active: false });
    const names = (await t.api.call('users.list', { includeInactive: true })).map((user) => user.id);
    expect(names).not.toContain('usr_003');
    expect(names).not.toContain('usr_005');
  });

  it('removes a turned-off agent on its own', async () => {
    const t = office();
    t.store.state.users.usr_005.active = false;
    const removed = await t.api.call('users.remove', { id: 'usr_005' });
    expect(removed).toMatchObject({ id: 'usr_005', kind: 'agent', removed: true });
    expect((await t.api.call('users.list', { includeInactive: true })).map((user) => user.id)).not.toContain('usr_005');
    // The person that it acted for stays.
    expect((await t.api.call('users.list', {})).map((user) => user.id)).toContain('usr_003');
  });

  it('is harmless a second time: no second event', async () => {
    const t = office();
    t.store.state.users.usr_004.active = false;
    await t.api.call('users.remove', { id: 'usr_004' });
    await t.api.call('users.remove', { id: 'usr_004' });
    expect(Object.values(t.store.state.events).filter((e) => e.verb === 'user.removed')).toHaveLength(1);
  });

  it('never turns a removed person on again or edits them', async () => {
    const t = office();
    t.store.state.users.usr_004.active = false;
    await t.api.call('users.remove', { id: 'usr_004' });
    await expect(t.api.call('users.reactivate', { id: 'usr_004' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'removed' } });
    await expect(t.api.call('users.update', { id: 'usr_004', patch: { discipline: 'Architect' } })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'removed' } });
    expect(t.store.state.users.usr_004.active).toBe(false);
  });

  it('takes a removed team member out of the team of a project, and the record of their work stays', async () => {
    const t = office();
    const s = t.store.state;
    expect((await t.api.call('projects.get', { id: 'prj_001' })).members.map((m) => m.user.id)).toContain('usr_003');
    s.users.usr_003.active = false;
    expect((await t.api.call('projects.get', { id: 'prj_001' })).members.find((m) => m.user.id === 'usr_003')).toMatchObject({ active: false });
    await t.api.call('users.remove', { id: 'usr_003' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).members.map((m) => m.user.id)).not.toContain('usr_003');
  });
});
