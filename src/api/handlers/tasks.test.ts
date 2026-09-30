import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import type { Store } from '../store';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);

function withTask(overrides = {}) {
  const t = testApi(taskCalls);
  t.store.state.tasks.tsk_001 = makeTask(overrides);
  t.store.state.counters.tsk = 1;
  return t;
}

describe('tasks.create', () => {
  it('lets a team member add a task for themselves', async () => {
    const t = testApi(taskCalls);
    t.as('usr_003');
    const detail = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Roof plan' });
    expect(detail.task).toMatchObject({ ownerId: 'usr_003', stageId: 'stg_002', status: 'todo', needsReview: true });
    expect(notices(t.store, 'task_assigned', 'usr_003')).toHaveLength(0);
  });

  it('stops a team member from assigning others or turning review off', async () => {
    const t = testApi(taskCalls);
    t.as('usr_003');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', ownerId: 'usr_002' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', needsReview: false })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader assign a task and tells the owner', async () => {
    const t = testApi(taskCalls);
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Wall sections', ownerId: 'usr_003', dueDate: '2026-10-08' });
    expect(notices(t.store, 'task_assigned', 'usr_003')).toHaveLength(1);
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', ownerId: 'usr_004' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['ownerId'] },
    });
  });

  it('stops an outsider', async () => {
    const t = testApi(taskCalls);
    t.as('usr_004');
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('review flow (spec 5.5)', () => {
  it('sends a team member tick to review and tells the leader', async () => {
    const t = withTask();
    t.as('usr_003');
    const out = await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(out.result).toBe('in_review');
    expect(out.task.task.status).toBe('in_review');
    expect(notices(t.store, 'review_requested', 'usr_002')).toHaveLength(1);
  });

  it('marks the task done when review is off', async () => {
    const t = withTask({ needsReview: false });
    t.as('usr_003');
    const out = await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(out.result).toBe('done');
    expect(out.task.task.completedAt).not.toBeNull();
  });

  it('marks the task done when the leader ticks it', async () => {
    const t = withTask();
    t.as('usr_002');
    expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('done');
  });

  it('approves a task in review and tells the owner', async () => {
    const t = withTask();
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    const detail = await t.api.call('tasks.approve', { id: 'tsk_001' });
    expect(detail.task.status).toBe('done');
    expect(notices(t.store, 'task_approved', 'usr_003')).toHaveLength(1);
  });

  it('sends a task back with a note', async () => {
    const t = withTask();
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await expect(t.api.call('tasks.sendBack', { id: 'tsk_001', note: ' ' })).rejects.toMatchObject({ code: 'invalid_input' });
    const detail = await t.api.call('tasks.sendBack', { id: 'tsk_001', note: 'Check the stair widths.' });
    expect(detail.task.status).toBe('in_progress');
    expect(detail.commentCount).toBe(1);
    expect(notices(t.store, 'task_sent_back', 'usr_003')).toHaveLength(1);
  });

  it('refuses to approve a task that is not in review', async () => {
    const t = withTask();
    t.as('usr_002');
    await expect(t.api.call('tasks.approve', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('stops an outsider from ticking and a team member from reviewing', async () => {
    const t = withTask();
    t.as('usr_004');
    await expect(t.api.call('tasks.complete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await expect(t.api.call('tasks.approve', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('sends a drag to Done through review and lets the owner pull it back', async () => {
    const t = withTask();
    t.as('usr_003');
    expect((await t.api.call('tasks.move', { id: 'tsk_001', status: 'done' })).result).toBe('in_review');
    expect((await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' })).task.task.status).toBe('todo');
  });

  it('sends reviews to the Admin when the project has no leader', async () => {
    const t = withTask();
    t.store.state.projects.prj_001.leaderId = null;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(notices(t.store, 'review_requested', 'usr_001')).toHaveLength(1);
  });
});

describe('tasks.update and tasks.delete', () => {
  it('lets the owner edit and stops them from reassigning', async () => {
    const t = withTask();
    t.as('usr_003');
    const detail = await t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'GF plan', flagged: true } });
    expect(detail.task).toMatchObject({ title: 'GF plan', flagged: true });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_002' } })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('lets the leader reassign and tells the new owner', async () => {
    const t = withTask();
    t.as('usr_002');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_002' } });
    expect(t.store.state.tasks.tsk_001.ownerId).toBe('usr_002');
    t.as('usr_001');
    await t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_003' } });
    expect(notices(t.store, 'task_assigned', 'usr_003')).toHaveLength(1);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_005' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('lets the leader delete a task', async () => {
    const t = withTask();
    t.as('usr_003');
    await expect(t.api.call('tasks.delete', { id: 'tsk_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_001).toBeUndefined();
  });
});

describe('agents', () => {
  it('act with the rights of their person', async () => {
    const t = withTask();
    t.as('usr_005');
    const created = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Area check' });
    expect(created.task).toMatchObject({ ownerId: 'usr_003', createdBy: 'usr_005' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', ownerId: 'usr_002' })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('in_review');
    const event = Object.values(t.store.state.events).find((e) => e.targetId === 'tsk_001');
    expect(event).toMatchObject({ actorId: 'usr_005', actingForId: 'usr_003' });
  });
});

describe('tasks.list', () => {
  it('filters mine, overdue and review for me, and hides projects that are not active', async () => {
    const t = testApi(taskCalls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', dueDate: '2026-09-28', status: 'in_progress' });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', dueDate: '2026-10-05' });
    s.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_003', status: 'in_review' });
    t.as('usr_003');
    expect((await t.api.call('tasks.list', { filter: 'mine' })).map((r) => r.task.id)).toEqual(['tsk_001', 'tsk_003']);
    const overdue = await t.api.call('tasks.list', { filter: 'overdue' });
    expect(overdue.map((r) => r.task.id)).toEqual(['tsk_001']);
    expect(overdue[0].overdue).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('tasks.list', { filter: 'review_for_me' })).map((r) => r.task.id)).toEqual(['tsk_003']);
    s.projects.prj_001.status = 'on_hold';
    expect(await t.api.call('tasks.list', {})).toHaveLength(0);
  });
});

describe('task rows for the viewer', () => {
  it('tells the viewer which rows they may move', async () => {
    const t = testApi(taskCalls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003' });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002' });
    t.as('usr_003');
    const rows = await t.api.call('tasks.list', { projectId: 'prj_001' });
    expect(Object.fromEntries(rows.map((row) => [row.task.id, row.canMove]))).toEqual({ tsk_001: true, tsk_002: false });
  });
});
