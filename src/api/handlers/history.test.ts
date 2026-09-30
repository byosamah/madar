import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { taskCalls } from './tasks';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const calls = { ...taskCalls, ...historyCalls };

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
