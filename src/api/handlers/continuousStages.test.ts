import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { Task } from '../contract/entities';
import { makeStage, makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A continuous project means that the stages run together (fbk_084, owner 2026-11-08: "Continuous is enough"). It has no current stage, so the
 * three order rules switch off: no reason for a move to an earlier stage, no "stage changed" notice and no "moved the project" line in Activity.
 * Stage prerequisites (an order that a person sets on purpose) keep working. The world has Concept (stg_001), Schematic Design (stg_002) and
 * Permits (stg_003) in prj_001. usr_001 is the Admin, usr_002 leads prj_001 and usr_003 works on it.
 */
function world(continuous: boolean) {
  const t = testApi(calls);
  t.store.state.stages.stg_003 = makeStage({ id: 'stg_003', name: 'Permits', order: 2, startDate: '2026-11-01', endDate: '2026-11-30' });
  t.store.state.counters.stg = 3;
  t.store.state.counters.tsk = 0;
  t.store.state.projects.prj_001.continuous = continuous;
  return t;
}

type T = ReturnType<typeof world>;
function put(t: T, id: string, overrides: Partial<Task> = {}): Task {
  const task = makeTask({ id, title: `Task ${'ABCDE'[Number(id.slice(-1)) - 1]}`, ownerId: 'usr_003', ...overrides });
  t.store.state.tasks[id] = task;
  t.store.state.counters.tsk = Math.max(t.store.state.counters.tsk ?? 0, Number(id.slice(-3)));
  return task;
}
const stageEvents = (t: T) => Object.values(t.store.state.events).filter((event) => event.verb === 'project.stage_changed' && event.projectId === 'prj_001');
const stageNotices = (t: T) => Object.values(t.store.state.notifications ?? {}).filter((notice) => notice.trigger === 'stage_changed');

describe('a continuous project: the order rules are off', () => {
  it('asks no reason when a to-do is added to an earlier stage, and keeps the project note empty', async () => {
    const t = world(true);
    put(t, 'tsk_002', { stageId: 'stg_002' });
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_001', title: 'Early', ownerId: 'usr_003' });
    expect(made.task.stageId).toBe('stg_001');
    expect(t.store.state.projects.prj_001.stageBack ?? null).toBeNull();
  });

  it('asks no reason when a to-do moves to an earlier stage or opens again in one', async () => {
    const t = world(true);
    put(t, 'tsk_001', { stageId: 'stg_001', status: 'done', completedAt: '2026-09-20T09:00:00.000+03:00' });
    put(t, 'tsk_002', { stageId: 'stg_002' });
    put(t, 'tsk_003', { stageId: 'stg_003' });
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' })).resolves.toBeTruthy();
    await expect(t.api.call('tasks.update', { id: 'tsk_003', patch: { stageId: 'stg_001' } })).resolves.toBeTruthy();
    expect(t.store.state.tasks.tsk_003.stageId).toBe('stg_001');
  });

  it('writes no stage event and sends no stage notice when the work moves to a later stage', async () => {
    const t = world(true);
    const a = put(t, 'tsk_001', { stageId: 'stg_001' });
    put(t, 'tsk_002', { stageId: 'stg_002' });
    await t.api.call('tasks.complete', { id: a.id });
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
    expect(stageEvents(t)).toEqual([]);
    expect(stageNotices(t)).toEqual([]);
  });

  it('keeps the saved stage and the health note untouched', async () => {
    const t = world(true);
    const before = t.store.state.projects.prj_001.currentStageId;
    t.store.state.projects.prj_001.healthOverride = { value: 'at_risk', reason: 'Waiting for the client', setBy: 'usr_001', setAt: '2026-09-29T09:00:00.000+03:00' };
    const a = put(t, 'tsk_001', { stageId: 'stg_001' });
    put(t, 'tsk_002', { stageId: 'stg_002' });
    await t.api.call('tasks.complete', { id: a.id });
    expect(t.store.state.projects.prj_001.currentStageId).toBe(before);
    expect(t.store.state.projects.prj_001.healthOverride).not.toBeNull();
  });

  it('keeps the stage prerequisites: a to-do waits for the stage it needs', async () => {
    const t = world(true);
    t.store.state.stages.stg_002.prerequisiteIds = ['stg_001'];
    put(t, 'tsk_001', { stageId: 'stg_001' });
    put(t, 'tsk_002', { stageId: 'stg_002' });
    await expect(t.api.call('tasks.complete', { id: 'tsk_002' })).rejects.toMatchObject({ details: { reason: 'stage_prerequisite_open' } });
  });

  it('writes no stage event for a move to an earlier stage', async () => {
    const t = world(true);
    put(t, 'tsk_001', { stageId: 'stg_002' });
    put(t, 'tsk_002', { stageId: 'stg_003' });
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { stageId: 'stg_001' } });
    expect(stageEvents(t)).toEqual([]);
  });
});

describe('a project whose stages go in order keeps every rule', () => {
  it('still asks the reason, still writes the stage event and still tells the team', async () => {
    const t = world(false);
    put(t, 'tsk_002', { stageId: 'stg_002' });
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { title: 'Renamed' } });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_001', title: 'Early' })).rejects.toMatchObject({ details: { reason: 'stage_back_reason' } });
    const a = put(t, 'tsk_001', { stageId: 'stg_001' });
    await t.api.call('tasks.complete', { id: a.id });
    expect(stageEvents(t).length).toBeGreaterThan(0);
    expect(stageNotices(t).length).toBeGreaterThan(0);
  });
});

describe('the flag canEditDetails of a to-do row', () => {
  it('is true for the person who may change the details of the to-do, and false for another team member', async () => {
    const t = world(true);
    put(t, 'tsk_001', { stageId: 'stg_001', ownerId: 'usr_003' });
    put(t, 'tsk_002', { stageId: 'stg_001', ownerId: 'usr_002' });
    t.as('usr_003');
    const rows = await t.api.call('tasks.list', { projectId: 'prj_001' });
    const flag = (id: string) => rows.find((row) => row.task.id === id)?.canEditDetails;
    expect(flag('tsk_001')).toBe(true);
    expect(flag('tsk_002')).toBe(false);
    t.as('usr_001');
    const admin = await t.api.call('tasks.list', { projectId: 'prj_001' });
    expect(admin.every((row) => row.canEditDetails === true)).toBe(true);
  });

  it('agrees with tasks.update: a row with the flag false is refused a stage change', async () => {
    const t = world(true);
    put(t, 'tsk_002', { stageId: 'stg_001', ownerId: 'usr_002' });
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { stageId: 'stg_002' } })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
