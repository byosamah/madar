import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { Task } from '../contract/entities';
import { can, taskResource } from '../permissions';
import type { Store } from '../store';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Office tasks: tasks with no project (owner, 2026-10-06). Hala (usr_001) is the Admin. Faisal (usr_002) leads prj_001, Sara
 * (usr_003) is on its team, Omar (usr_004) is outside it, usr_005 is Sara's agent, Nour (usr_006) is a Member.
 * In most tests Omar makes an office task, Sara leads it and Nour helps. Faisal is on no office task.
 */
function world() {
  const t = testApi(calls);
  t.store.state.users.usr_006 = makeUser('usr_006', { name: 'Nour Member' });
  t.store.state.users.usr_007 = makeUser('usr_007', { name: 'Omar Agent', kind: 'agent', discipline: 'Agent', ownerId: 'usr_004' });
  t.store.state.counters.usr = 7;
  return t;
}

const notices = (store: Store, userId: string) => Object.values(store.state.notifications).filter((n) => n.userId === userId);

async function officeTask(t: ReturnType<typeof world>, input: Record<string, unknown> = {}) {
  t.as('usr_004');
  const made = await t.api.call('tasks.create', { title: 'Renew the office licence', ownerId: 'usr_003', helperIds: ['usr_006'], ...input });
  return made.task;
}

describe('the record of an office task', () => {
  it('parses a task with no project and no stage', () => {
    const task = Task.parse({
      id: 'tsk_009', projectId: null, stageId: null, title: 'Order paper', description: '', ownerId: 'usr_003', status: 'todo', dueDate: null,
      flagged: false, needsReview: false, checklist: [], createdBy: 'usr_004', createdAt: '2026-09-30T09:00:00.000+03:00', completedAt: null,
    });
    expect(task.projectId).toBeNull();
    expect(task.stageId).toBeNull();
  });
});

describe('making an office task', () => {
  it('makes a task with no project and no stage, and tells the lead and the helpers', async () => {
    const t = world();
    const task = await officeTask(t);
    expect(task).toMatchObject({ projectId: null, stageId: null, ownerId: 'usr_003', helperIds: ['usr_006'], createdBy: 'usr_004' });
    expect(notices(t.store, 'usr_003').map((n) => n.trigger)).toEqual(['task_assigned']);
    expect(notices(t.store, 'usr_006').map((n) => n.trigger)).toEqual(['task_assigned']);
    const detail = await t.api.call('tasks.get', { id: task.id });
    expect(detail.project).toBeNull();
    expect(detail.stage).toBeNull();
  });

  it('lets any person give it to any active person, and to nobody', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('tasks.create', { title: 'For Hala', ownerId: 'usr_001' })).resolves.toMatchObject({ task: { ownerId: 'usr_001' } });
    await expect(t.api.call('tasks.create', { title: 'No lead yet' })).resolves.toMatchObject({ task: { ownerId: null }, owner: null });
  });

  it('refuses a person who left, an agent, a stage and prerequisites', async () => {
    const t = world();
    t.store.state.users.usr_006.active = false;
    t.as('usr_004');
    await expect(t.api.call('tasks.create', { title: 'X', ownerId: 'usr_006' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'person_inactive' } });
    await expect(t.api.call('tasks.create', { title: 'X', ownerId: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_a_person' } });
    await expect(t.api.call('tasks.create', { title: 'X', helperIds: ['usr_005'] })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_a_person' } });
    await expect(t.api.call('tasks.create', { title: 'X', stageId: 'stg_001' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'office_no_stage' } });
    t.as('usr_002');
    const project = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Plan' });
    t.as('usr_004');
    await expect(t.api.call('tasks.create', { title: 'X', prerequisiteIds: [project.task.id] })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'office_no_prerequisites' } });
  });

  it('makes no change to any project: no stage move, no update of a project, no Tracker entry', async () => {
    const t = world();
    const before = structuredClone(t.store.state.projects.prj_001);
    await officeTask(t);
    expect(t.store.state.projects.prj_001).toEqual(before);
    const events = Object.values(t.store.state.events);
    expect(events.every((e) => e.projectId === null)).toBe(true);
    expect(events.find((e) => e.verb === 'task.created')?.officeTaskId).toBeDefined();
  });

  it('sets the review need only when the maker is not the lead', async () => {
    const t = world();
    expect((await officeTask(t)).needsReview).toBe(true);
    expect((await officeTask(t, { ownerId: 'usr_004', helperIds: [] })).needsReview).toBe(false);
    expect((await officeTask(t, { ownerId: undefined, helperIds: [] })).needsReview).toBe(false);
    await expect(officeTask(t, { ownerId: 'usr_004', helperIds: [], needsReview: true })).rejects.toMatchObject({ details: { reason: 'review_by_maker' } });
  });
});

describe('the rights on an office task', () => {
  it('gives the view to the maker, the lead, a helper and the Admin only', async () => {
    const t = world();
    const task = await officeTask(t);
    const sees = (id: string) => can(t.store.state.users[id], 'task.view', taskResource(t.store.state, task, id));
    expect(['usr_001', 'usr_002', 'usr_003', 'usr_004', 'usr_006'].map(sees)).toEqual([true, false, true, true, true]);
    // A project task stays open to everyone.
    t.as('usr_002');
    const project = (await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Plan' })).task;
    expect(can(t.store.state.users.usr_004, 'task.view', taskResource(t.store.state, project, 'usr_004'))).toBe(true);
  });

  it('refuses every task call of a person who does not see it with not_found', async () => {
    const t = world();
    const task = await officeTask(t);
    t.as('usr_002');
    for (const [name, input] of [
      ['tasks.get', { id: task.id }], ['tasks.update', { id: task.id, patch: { title: 'Mine' } }], ['tasks.complete', { id: task.id }],
      ['tasks.move', { id: task.id, status: 'in_progress' }], ['tasks.take', { taskId: task.id }], ['tasks.delete', { id: task.id }],
      ['tasks.approve', { id: task.id }], ['tasks.sendBack', { id: task.id, note: 'No' }], ['tasks.newVersion', { id: task.id, reason: 'Again' }],
    ] as const) {
      await expect(t.api.call(name as 'tasks.get', input as never), name).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('lets the lead change the details and finish it, and only the maker or the Admin change the lead and the helpers', async () => {
    const t = world();
    const task = await officeTask(t);
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: task.id, patch: { title: 'Renew the licence', dueDate: '2026-10-08' } })).resolves.toMatchObject({ task: { title: 'Renew the licence' } });
    await expect(t.api.call('tasks.update', { id: task.id, patch: { ownerId: 'usr_006' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_006');
    await expect(t.api.call('tasks.update', { id: task.id, patch: { title: 'No' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    const moved = await t.api.call('tasks.update', { id: task.id, patch: { ownerId: 'usr_006', helperIds: ['usr_003'] } });
    expect(moved.task).toMatchObject({ ownerId: 'usr_006', helperIds: ['usr_003'] });
    expect(notices(t.store, 'usr_006').filter((n) => n.trigger === 'task_assigned')).toHaveLength(2);
    t.as('usr_001');
    await expect(t.api.call('tasks.update', { id: task.id, patch: { helperIds: [] } })).resolves.toMatchObject({ task: { helperIds: [] } });
  });

  it('refuses a stage and prerequisites on a change', async () => {
    const t = world();
    const task = await officeTask(t);
    await expect(t.api.call('tasks.update', { id: task.id, patch: { stageId: 'stg_001' } })).rejects.toMatchObject({ details: { reason: 'office_no_stage' } });
    await expect(t.api.call('tasks.update', { id: task.id, patch: { prerequisiteIds: [] } })).rejects.toMatchObject({ details: { reason: 'office_no_prerequisites' } });
  });

  it('lets a helper tick the checklist, and the maker delete the task', async () => {
    const t = world();
    const task = await officeTask(t, { helperIds: ['usr_006'] });
    t.as('usr_003');
    const listed = await t.api.call('tasks.update', { id: task.id, patch: { checklist: [{ id: 'chk_1', text: 'Call', done: false }] } });
    t.as('usr_006');
    await t.api.call('tasks.update', { id: task.id, patch: { checklist: [{ ...listed.task.checklist[0], done: true }] } });
    t.as('usr_003');
    await expect(t.api.call('tasks.delete', { id: task.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    await expect(t.api.call('tasks.delete', { id: task.id })).resolves.toEqual({ deleted: true });
  });

  it('lets a person who sees a task with no lead take it', async () => {
    const t = world();
    const task = await officeTask(t, { ownerId: undefined, helperIds: ['usr_006'] });
    t.as('usr_002');
    await expect(t.api.call('tasks.take', { taskId: task.id })).rejects.toMatchObject({ code: 'not_found' });
    t.as('usr_006');
    await expect(t.api.call('tasks.take', { taskId: task.id })).resolves.toMatchObject({ task: { ownerId: 'usr_006', helperIds: [] } });
  });

  it('gives an agent the rights of its person', async () => {
    const t = world();
    const task = await officeTask(t);
    t.as('usr_005');
    await expect(t.api.call('tasks.get', { id: task.id })).resolves.toMatchObject({ task: { id: task.id } });
    // An agent of Omar makes a task: Omar is its maker.
    t.as('usr_007');
    const made = await t.api.call('tasks.create', { title: 'From the agent', ownerId: 'usr_006' });
    t.as('usr_004');
    await expect(t.api.call('tasks.update', { id: made.task.id, patch: { ownerId: 'usr_003' } })).resolves.toMatchObject({ task: { ownerId: 'usr_003' } });
  });
});

describe('the review of an office task', () => {
  it('sends the finished task to the maker, who approves it', async () => {
    const t = world();
    const task = await officeTask(t);
    t.as('usr_003');
    const done = await t.api.call('tasks.complete', { id: task.id });
    expect(done.result).toBe('in_review');
    expect(notices(t.store, 'usr_004').map((n) => n.trigger)).toEqual(['review_requested']);
    // Only the maker and the Admin review. The project leaders of the office do not.
    expect(notices(t.store, 'usr_001')).toHaveLength(0);
    t.as('usr_003');
    await expect(t.api.call('tasks.approve', { id: task.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    await expect(t.api.call('tasks.approve', { id: task.id })).resolves.toMatchObject({ task: { status: 'done' } });
    expect(notices(t.store, 'usr_003').map((n) => n.trigger)).toContain('task_approved');
  });

  it('sends the review to every active Admin when the maker left', async () => {
    const t = world();
    const task = await officeTask(t);
    t.store.state.users.usr_004.active = false;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: task.id });
    expect(notices(t.store, 'usr_001').map((n) => n.trigger)).toEqual(['review_requested']);
  });

  it('finishes at once when the maker leads it, and turns the review off when the maker takes the lead', async () => {
    const t = world();
    const own = await officeTask(t, { ownerId: 'usr_004', helperIds: [] });
    await expect(t.api.call('tasks.complete', { id: own.id })).resolves.toMatchObject({ result: 'done' });
    const task = await officeTask(t);
    const changed = await t.api.call('tasks.update', { id: task.id, patch: { ownerId: 'usr_004' } });
    expect(changed.task.needsReview).toBe(false);
    await expect(t.api.call('tasks.update', { id: task.id, patch: { needsReview: true } })).rejects.toMatchObject({ details: { reason: 'review_by_maker' } });
  });

  it('opens a new version with no Tracker entry', async () => {
    const t = world();
    const task = await officeTask(t, { ownerId: 'usr_004', helperIds: [] });
    await t.api.call('tasks.complete', { id: task.id });
    const next = await t.api.call('tasks.newVersion', { id: task.id, reason: 'The office asked again' });
    expect(next.task).toMatchObject({ status: 'todo', version: 2 });
    expect(Object.values(t.store.state.tracker ?? {})).toHaveLength(0);
  });

  it('cannot become a task template', async () => {
    const t = world();
    const task = await officeTask(t, { ownerId: 'usr_004', helperIds: [] });
    t.as('usr_001');
    await expect(t.api.call('taskTemplates.save', { fromTaskId: task.id })).rejects.toMatchObject({ details: { reason: 'office_no_stage' } });
  });
});
