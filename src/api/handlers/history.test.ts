import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { taskCalls } from './tasks';
import { timeCalls } from './time';
import { makeTask, NOW, TODAY, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const calls = { ...taskCalls, ...historyCalls, ...projectCalls, ...peopleCalls, ...timeCalls };

describe('events', () => {
  it('undoes my own change', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [latest] = await t.api.call('events.list', { targetType: 'task', targetId: 'tsk_001' });
    await t.api.call('events.undo', { eventId: latest.event.id });
    expect(t.store.state.tasks.tsk_001.status).toBe('todo');
  });

  it("lets the leader or the agent's person undo an agent change, and stops others", async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', needsReview: false });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', needsReview: false });
    t.as('usr_005');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    const [second, first] = await t.api.call('events.list', { projectId: 'prj_001' });
    expect(first.actor.kind).toBe('agent');
    expect(first.event.actingForId).toBe('usr_003');
    t.as('usr_004');
    await expect(t.api.call('events.undo', { eventId: first.event.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await t.api.call('events.undo', { eventId: first.event.id });
    expect(t.store.state.tasks.tsk_001.status).toBe('todo');
    t.as('usr_003');
    await t.api.call('events.undo', { eventId: second.event.id });
    expect(t.store.state.tasks.tsk_002.status).toBe('todo');
  });

  it('reports a conflict when the item changed later', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [done] = await t.api.call('events.list', { targetId: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'in_progress' });
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: done.event.id })).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('undo keeps the rules of the original action', () => {
  it('stops a leader who gave the project away from taking it back by undo', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.setLeader', { id: 'prj_001', leaderId: 'usr_003' });
    const [change] = await t.api.call('events.list', { projectId: 'prj_001', targetType: 'project' });
    expect(change.event.verb).toBe('project.leader_changed');
    await expect(t.api.call('events.undo', { eventId: change.event.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.projects.prj_001.leaderId).toBe('usr_003');
  });

  it('refuses to undo a create that other items now use', async () => {
    const t = testApi(calls);
    const user = await t.api.call('users.create', { name: 'New Person', email: 'new@madar.test', discipline: 'Engineer' });
    await t.api.call('members.add', { projectId: 'prj_001', userId: user.id });
    const [created] = await t.api.call('events.list', { targetType: 'user', targetId: user.id });
    await expect(t.api.call('events.undo', { eventId: created.event.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(t.store.state.users[user.id]).toBeDefined();
  });

  it('refuses to bring back a task whose project is gone', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask();
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    const [deleted] = await t.api.call('events.list', { targetId: 'tsk_001' });
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    await expect(t.api.call('events.undo', { eventId: deleted.event.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(t.store.state.tasks.tsk_001).toBeUndefined();
  });

  it('refuses to undo cleared hours when the day would pass 24 hours', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: TODAY, hours: 10 });
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: TODAY, hours: 0 });
    const [cleared] = await t.api.call('events.list', { targetType: 'time' });
    expect(cleared.event.verb).toBe('time.cleared');
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_001', date: TODAY, hours: 20 });
    await expect(t.api.call('events.undo', { eventId: cleared.event.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(Object.values(t.store.state.time).reduce((sum, e) => sum + e.hours, 0)).toBe(20);
  });

  it('refuses to undo hours in a week that is now locked', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: TODAY, hours: 6 });
    const [logged] = await t.api.call('events.list', { targetType: 'time' });
    setNow(new Date('2026-10-18T06:00:00Z'));
    await expect(t.api.call('events.undo', { eventId: logged.event.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(Object.keys(t.store.state.time)).toHaveLength(1);
  });
});

describe('the history hides hours from people who cannot see them', () => {
  it('shows hours to the person and the leader, not to others', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: TODAY, hours: 6 });
    const timeEvents = async (userId: string) => {
      t.as(userId);
      return (await t.api.call('events.list', { projectId: 'prj_001' })).filter((view) => view.event.targetType === 'time');
    };
    expect(await timeEvents('usr_003')).toHaveLength(1);
    expect(await timeEvents('usr_002')).toHaveLength(1);
    expect(await timeEvents('usr_004')).toHaveLength(0);
  });
});
