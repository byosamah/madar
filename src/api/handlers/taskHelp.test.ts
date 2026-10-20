import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { historyCalls } from './history';
import { notificationCalls } from './notifications';
import { makeTask, makeUser, NOW, testApi } from '../../test/factories';
import type { Store } from '../store';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);
const eventCount = (store: Store) => Object.keys(store.state.events).length;
const latest = (store: Store) => Object.values(store.state.events).sort((a, b) => b.seq - a.seq)[0];

/**
 * Faisal (usr_002) leads the project and made tsk_001. Sara (usr_003) leads tsk_001. Nour (usr_006) is on the team and does not
 * help yet. Omar (usr_004) is outside the team.
 */
function world() {
  const t = testApi({ ...taskCalls, ...historyCalls, ...notificationCalls });
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Team', discipline: 'Interior designer' });
  t.store.state.members['prj_001:usr_006'] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Interior designer' };
  t.store.state.tasks.tsk_001 = makeTask();
  t.store.state.counters.tsk = 1;
  return t;
}

describe('a team member joins a task as a helper (fbk_035)', () => {
  it('adds the person with one call, and tells the lead', async () => {
    const t = world();
    t.as('usr_006');
    const joined = await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    expect(joined.task.helperIds).toEqual(['usr_006']);
    expect(joined.helpers.map((h) => h.id)).toEqual(['usr_006']);
    expect(notices(t.store, 'helper_joined', 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'helper_joined', 'usr_006')).toHaveLength(0);
    expect(latest(t.store)).toMatchObject({ verb: 'task.updated', targetId: 'tsk_001', after: { helperIds: ['usr_006'] } });
  });

  it('keeps the helpers that the task had', async () => {
    const t = world();
    t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Ali Team' });
    t.store.state.members['prj_001:usr_007'] = { projectId: 'prj_001', userId: 'usr_007', discipline: 'Architect' };
    t.store.state.tasks.tsk_001.helperIds = ['usr_007'];
    t.as('usr_006');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    expect(t.store.state.tasks.tsk_001.helperIds).toEqual(['usr_007', 'usr_006']);
  });

  it('lets a helper leave with no notice', async () => {
    const t = world();
    t.as('usr_006');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    const left = await t.api.call('tasks.help', { taskId: 'tsk_001', help: false });
    expect(left.task.helperIds).toEqual([]);
    expect(notices(t.store, 'helper_joined', 'usr_003')).toHaveLength(1);
  });

  it('takes the join back with Undo', async () => {
    const t = world();
    t.as('usr_006');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    await t.api.call('events.undo', { eventId: latest(t.store).id });
    expect(t.store.state.tasks.tsk_001.helperIds ?? []).toEqual([]);
  });

  it('changes nothing on a second join, or on a leave by a person who does not help', async () => {
    const t = world();
    t.as('usr_006');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    const before = eventCount(t.store);
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    expect(t.store.state.tasks.tsk_001.helperIds).toEqual(['usr_006']);
    t.as('usr_002');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: false });
    expect(eventCount(t.store)).toBe(before);
    expect(notices(t.store, 'helper_joined', 'usr_003')).toHaveLength(1);
  });

  it('works on a done task too, so a person who helped gets the credit after', async () => {
    const t = world();
    t.store.state.tasks.tsk_001.status = 'done';
    t.as('usr_006');
    await expect(t.api.call('tasks.help', { taskId: 'tsk_001', help: true })).resolves.toMatchObject({ task: { helperIds: ['usr_006'] } });
  });

  it('refuses the lead, and a person outside the team', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('tasks.help', { taskId: 'tsk_001', help: true })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'lead_is_helper' } });
    t.as('usr_004');
    await expect(t.api.call('tasks.help', { taskId: 'tsk_001', help: true })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks.tsk_001.helperIds ?? []).toEqual([]);
  });

  it('tells nobody when the task has no lead', async () => {
    const t = world();
    t.store.state.tasks.tsk_001.ownerId = null;
    t.as('usr_006');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    expect(Object.values(t.store.state.notifications).filter((n) => n.trigger === 'helper_joined')).toHaveLength(0);
  });

  it('works for the person of an agent', async () => {
    const t = world();
    t.store.state.tasks.tsk_001.ownerId = 'usr_002';
    t.as('usr_005');
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    expect(t.store.state.tasks.tsk_001.helperIds).toEqual(['usr_003']);
    expect(notices(t.store, 'helper_joined', 'usr_002')).toHaveLength(1);
  });

  it('shows the join to a team member who neither leads nor helps', async () => {
    const t = world();
    t.as('usr_006');
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan.help).toBe(true);
    await t.api.call('tasks.help', { taskId: 'tsk_001', help: true });
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan.help).toBe(false);
    t.as('usr_003');
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan.help).toBe(false);
  });
});

describe('an office task and the join (fbk_035)', () => {
  async function officeTask(t: ReturnType<typeof world>) {
    t.as('usr_004');
    const made = await t.api.call('tasks.create', { title: 'Renew the office licence', ownerId: 'usr_003', helperIds: ['usr_006'] });
    return made.task;
  }

  it('reads as missing for a person who does not see it', async () => {
    const t = world();
    const task = await officeTask(t);
    t.as('usr_002');
    await expect(t.api.call('tasks.help', { taskId: task.id, help: true })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('lets a helper leave, and lets nobody join: its maker names its people', async () => {
    const t = world();
    const task = await officeTask(t);
    t.as('usr_004');
    expect((await t.api.call('tasks.get', { id: task.id })).viewerCan.help).toBe(false);
    await expect(t.api.call('tasks.help', { taskId: task.id, help: true })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'office_help' } });
    t.as('usr_006');
    await expect(t.api.call('tasks.help', { taskId: task.id, help: false })).resolves.toMatchObject({ task: { helperIds: [] } });
  });
});

describe('the lead deletes a task (fbk_034)', () => {
  it('lets the lead delete a task that another person made, and tells the maker', async () => {
    const t = world();
    t.as('usr_003');
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan.delete).toBe(true);
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_001).toBeUndefined();
    expect(notices(t.store, 'task_deleted', 'usr_002')).toHaveLength(1);
    t.as('usr_002');
    const views = await t.api.call('notifications.list', {});
    const view = views.find((item) => item.notification.trigger === 'task_deleted');
    expect(view).toMatchObject({ target: 'Ground floor plan', actor: { id: 'usr_003' } });
  });

  it('tells nobody when the maker deletes their own task', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    expect(Object.values(t.store.state.notifications).filter((n) => n.trigger === 'task_deleted')).toHaveLength(0);
  });

  it('keeps the delete from a team member who does not lead the task', async () => {
    const t = world();
    t.as('usr_006');
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan.delete).toBe(false);
    await expect(t.api.call('tasks.delete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('brings the task back with Undo, and takes the notice of the maker back', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    const deleted = Object.values(t.store.state.events).find((event) => event.verb === 'task.deleted') as { id: string; correlationId: string };
    await t.api.call('events.undoStory', { correlationId: deleted.correlationId });
    expect(t.store.state.tasks.tsk_001).toMatchObject({ title: 'Ground floor plan' });
    expect(notices(t.store, 'task_deleted', 'usr_002')).toHaveLength(0);
  });

  it('brings the task back when the lead undoes the delete change alone', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    const deleted = Object.values(t.store.state.events).find((event) => event.verb === 'task.deleted') as { id: string };
    await t.api.call('events.undo', { eventId: deleted.id });
    expect(t.store.state.tasks.tsk_001).toMatchObject({ title: 'Ground floor plan' });
  });

  it('refuses the delete to a lead who took the task with no lead themselves, so a take never opens a delete', async () => {
    const t = world();
    t.store.state.tasks.tsk_001.ownerId = null;
    t.as('usr_006');
    await t.api.call('tasks.take', { taskId: 'tsk_001' });
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).viewerCan.delete).toBe(false);
    await expect(t.api.call('tasks.delete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await expect(t.api.call('tasks.delete', { id: 'tsk_001' })).resolves.toEqual({ deleted: true });
  });

  it('lets the lead delete again when the maker names them after their take', async () => {
    const t = world();
    t.store.state.tasks.tsk_001.ownerId = null;
    t.as('usr_006');
    await t.api.call('tasks.take', { taskId: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_003' } });
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_006' } });
    t.as('usr_006');
    await expect(t.api.call('tasks.delete', { id: 'tsk_001' })).resolves.toEqual({ deleted: true });
  });

  it('keeps an office task for its maker and the Admin: its lead does not delete it', async () => {
    const t = world();
    t.as('usr_004');
    const { task } = await t.api.call('tasks.create', { title: 'Renew the office licence', ownerId: 'usr_003' });
    t.as('usr_003');
    await expect(t.api.call('tasks.delete', { id: task.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
