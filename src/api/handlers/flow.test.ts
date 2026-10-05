import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { Task } from '../contract/entities';
import { makeProject, makeStage, makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

// Today is Wed 30 Sep 2026. The world has Concept (stg_001, Aug) and Schematic Design (stg_002, Sep to Oct). This adds Permits (stg_003).
function world() {
  const t = testApi(calls);
  t.store.state.stages.stg_003 = makeStage({ id: 'stg_003', name: 'Permits', order: 2, startDate: '2026-11-01', endDate: '2026-11-30' });
  t.store.state.counters.stg = 3;
  t.store.state.counters.tsk = 0;
  return t;
}

type T = ReturnType<typeof world>;
function put(t: T, id: string, overrides: Partial<Task> = {}): Task {
  const task = makeTask({ id, title: `Task ${'ABCDE'[Number(id.slice(-1)) - 1]}`, ownerId: 'usr_003', ...overrides });
  t.store.state.tasks[id] = task;
  t.store.state.counters.tsk = Math.max(t.store.state.counters.tsk ?? 0, Number(id.slice(-3)));
  return task;
}
const needs = (t: T, id: string, ...ids: string[]) => {
  t.store.state.tasks[id].prerequisiteIds = ids;
};
const status = (t: T, id: string) => t.store.state.tasks[id].status;
const tag = async (t: T) => (await t.api.call('projects.get', { id: 'prj_001' })).currentStage.id;

describe('task prerequisites', () => {
  it('refuses to finish a task while a task it needs is open, and names it', async () => {
    const t = world();
    put(t, 'tsk_001');
    put(t, 'tsk_002');
    needs(t, 'tsk_002', 'tsk_001');
    await expect(t.api.call('tasks.complete', { id: 'tsk_002' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'prerequisite_open', names: 'Task A' } });
    expect(status(t, 'tsk_002')).toBe('todo');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect((await t.api.call('tasks.complete', { id: 'tsk_002' })).result).toBe('done');
  });

  it('also refuses to send it to review, and to approve it', async () => {
    const t = world();
    put(t, 'tsk_001');
    put(t, 'tsk_002');
    needs(t, 'tsk_002', 'tsk_001');
    t.as('usr_003');
    await expect(t.api.call('tasks.move', { id: 'tsk_002', status: 'in_review' })).rejects.toMatchObject({ details: { reason: 'prerequisite_open' } });
    await expect(t.api.call('tasks.move', { id: 'tsk_002', status: 'in_progress' })).resolves.toBeTruthy();
    t.store.state.tasks.tsk_002.status = 'in_review';
    t.as('usr_002');
    await expect(t.api.call('tasks.approve', { id: 'tsk_002' })).rejects.toMatchObject({ details: { reason: 'prerequisite_open' } });
  });

  it('lists every open prerequisite in the refusal and shows the wait in the row', async () => {
    const t = world();
    put(t, 'tsk_001');
    put(t, 'tsk_002');
    put(t, 'tsk_003');
    needs(t, 'tsk_003', 'tsk_001', 'tsk_002');
    await expect(t.api.call('tasks.complete', { id: 'tsk_003' })).rejects.toMatchObject({ details: { names: 'Task A, Task B' } });
    const detail = await t.api.call('tasks.get', { id: 'tsk_003' });
    expect(detail.waitingFor.tasks.map((x) => x.id)).toEqual(['tsk_001', 'tsk_002']);
    expect(detail.needsFirst.map((x) => x.id)).toEqual(['tsk_001', 'tsk_002']);
    expect((await t.api.call('tasks.get', { id: 'tsk_001' })).unlocks.map((x) => x.id)).toEqual(['tsk_003']);
  });

  it('lets the leader and the Admin set prerequisites, and stops a team member', async () => {
    const t = world();
    put(t, 'tsk_001');
    put(t, 'tsk_002');
    t.as('usr_003');
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { prerequisiteIds: ['tsk_001'] } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const detail = await t.api.call('tasks.update', { id: 'tsk_002', patch: { prerequisiteIds: ['tsk_001'] } });
    expect(detail.task.prerequisiteIds).toEqual(['tsk_001']);
    t.as('usr_001');
    expect((await t.api.call('tasks.update', { id: 'tsk_002', patch: { prerequisiteIds: [] } })).task.prerequisiteIds).toEqual([]);
  });

  it('refuses cycles, itself, repeats and a task of another project', async () => {
    const t = world();
    put(t, 'tsk_001');
    put(t, 'tsk_002');
    put(t, 'tsk_003');
    needs(t, 'tsk_002', 'tsk_001');
    needs(t, 'tsk_003', 'tsk_002');
    const set = (id: string, ids: string[]) => t.api.call('tasks.update', { id, patch: { prerequisiteIds: ids } });
    await expect(set('tsk_001', ['tsk_003'])).rejects.toMatchObject({ details: { reason: 'dependency_cycle' } });
    await expect(set('tsk_001', ['tsk_001'])).rejects.toMatchObject({ details: { reason: 'dependency_cycle' } });
    await expect(set('tsk_003', ['tsk_001', 'tsk_001'])).rejects.toMatchObject({ details: { reason: 'duplicate_prerequisite' } });
    t.store.state.projects.prj_002 = { ...t.store.state.projects.prj_001, id: 'prj_002', code: 'KH-26-002' };
    put(t, 'tsk_004', { projectId: 'prj_002' });
    await expect(set('tsk_003', ['tsk_004'])).rejects.toMatchObject({ details: { reason: 'prerequisite_not_in_project' } });
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { prerequisiteIds: Array.from({ length: 21 }, (_, i) => `tsk_${100 + i}`) } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('does not let a finished task start to wait for an open one', async () => {
    const t = world();
    put(t, 'tsk_001');
    put(t, 'tsk_002', { status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' });
    await expect(t.api.call('tasks.update', { id: 'tsk_002', patch: { prerequisiteIds: ['tsk_001'] } })).rejects.toMatchObject({ details: { reason: 'prerequisite_open' } });
  });

  it('makes a new task with prerequisites for the leader', async () => {
    const t = world();
    put(t, 'tsk_001');
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Next', prerequisiteIds: ['tsk_001'] });
    expect(made.task.prerequisiteIds).toEqual(['tsk_001']);
    expect(made.waitingFor.tasks).toHaveLength(1);
  });
});

describe('the reopen cascade', () => {
  const chain = (t: T) => {
    put(t, 'tsk_001', { status: 'done', completedAt: '2026-09-20T09:00:00.000+03:00' });
    put(t, 'tsk_002', { status: 'done', completedAt: '2026-09-21T09:00:00.000+03:00' });
    put(t, 'tsk_003', { status: 'done', completedAt: '2026-09-22T09:00:00.000+03:00' });
    put(t, 'tsk_004', { status: 'todo' });
    needs(t, 'tsk_002', 'tsk_001');
    needs(t, 'tsk_003', 'tsk_002');
  };

  it('opens every done task down the chain when a task opens again, and one Undo brings them all back', async () => {
    const t = world();
    chain(t);
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'in_progress' }, { correlationId: 'story_1' });
    expect(['tsk_001', 'tsk_002', 'tsk_003'].map((id) => status(t, id))).toEqual(['in_progress', 'todo', 'todo']);
    expect(t.store.state.tasks.tsk_002.completedAt).toBeNull();
    await t.api.call('events.undoStory', { correlationId: 'story_1' });
    expect(['tsk_001', 'tsk_002', 'tsk_003'].map((id) => status(t, id))).toEqual(['done', 'done', 'done']);
    expect(t.store.state.tasks.tsk_002.completedAt).toBe('2026-09-21T09:00:00.000+03:00');
  });

  it('reaches a done task through a task that is not done', async () => {
    const t = world();
    chain(t);
    t.store.state.tasks.tsk_002.status = 'in_progress';
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' });
    expect(status(t, 'tsk_003')).toBe('todo');
  });

  it('opens the tasks that need it when a new version starts, with one Undo', async () => {
    const t = world();
    chain(t);
    await t.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'The client changed the brief' }, { correlationId: 'story_2' });
    expect(['tsk_002', 'tsk_003'].map((id) => status(t, id))).toEqual(['todo', 'todo']);
    await t.api.call('events.undoStory', { correlationId: 'story_2' });
    expect(['tsk_001', 'tsk_002', 'tsk_003'].map((id) => status(t, id))).toEqual(['done', 'done', 'done']);
  });

  it('opens them when Undo of a finish opens the task again', async () => {
    const t = world();
    put(t, 'tsk_001');
    put(t, 'tsk_002');
    needs(t, 'tsk_002', 'tsk_001');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'story_a' });
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    await t.api.call('events.undoStory', { correlationId: 'story_a' });
    expect(status(t, 'tsk_001')).toBe('todo');
    expect(status(t, 'tsk_002')).toBe('todo');
  });

  it('does not let a single Undo finish a task while what it needs is open', async () => {
    const t = world();
    chain(t);
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' });
    const cascade = Object.values(t.store.state.events).find((e) => e.verb === 'task.reopened' && e.targetId === 'tsk_002')!;
    await expect(t.api.call('events.undo', { eventId: cascade.id })).rejects.toMatchObject({ details: { reason: 'prerequisite_open' } });
  });
});

describe('stage prerequisites', () => {
  it('refuses to finish a task while a stage it needs has open tasks, and names the stage', async () => {
    const t = world();
    put(t, 'tsk_001', { stageId: 'stg_002' });
    put(t, 'tsk_002', { stageId: 'stg_003' });
    t.as('usr_002');
    await t.api.call('stages.setPrerequisites', { stageId: 'stg_003', prerequisiteIds: ['stg_002'] });
    await expect(t.api.call('tasks.complete', { id: 'tsk_002' })).rejects.toMatchObject({ details: { reason: 'stage_prerequisite_open', names: 'Schematic Design' } });
    const row = await t.api.call('tasks.get', { id: 'tsk_002' });
    expect(row.waitingFor.stages).toEqual([{ id: 'stg_002', name: 'Schematic Design' }]);
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await expect(t.api.call('tasks.complete', { id: 'tsk_002' })).resolves.toMatchObject({ result: 'done' });
  });

  it('waits again when the stage gets an open task, but finished tasks stay finished', async () => {
    const t = world();
    put(t, 'tsk_001', { stageId: 'stg_002', status: 'done', completedAt: '2026-09-20T09:00:00.000+03:00' });
    put(t, 'tsk_002', { stageId: 'stg_003', status: 'done', completedAt: '2026-09-21T09:00:00.000+03:00' });
    put(t, 'tsk_003', { stageId: 'stg_003' });
    t.store.state.stages.stg_003.prerequisiteIds = ['stg_002'];
    await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_002', title: 'A late addition', reason: 'The client added scope' });
    expect(status(t, 'tsk_002')).toBe('done');
    const rows = await t.api.call('tasks.list', { projectId: 'prj_001' });
    expect(rows.find((r) => r.task.id === 'tsk_003')?.waitingFor.stages).toHaveLength(1);
    expect(rows.find((r) => r.task.id === 'tsk_002')?.waitingFor.stages).toHaveLength(0);
  });

  it('refuses cycles, other projects and repeats, and only the leader and the Admin set them', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('stages.setPrerequisites', { stageId: 'stg_003', prerequisiteIds: ['stg_002'] });
    await t.api.call('stages.setPrerequisites', { stageId: 'stg_002', prerequisiteIds: ['stg_001'] });
    await expect(t.api.call('stages.setPrerequisites', { stageId: 'stg_001', prerequisiteIds: ['stg_003'] })).rejects.toMatchObject({ details: { reason: 'dependency_cycle' } });
    await expect(t.api.call('stages.setPrerequisites', { stageId: 'stg_001', prerequisiteIds: ['stg_001'] })).rejects.toMatchObject({ details: { reason: 'dependency_cycle' } });
    await expect(t.api.call('stages.setPrerequisites', { stageId: 'stg_003', prerequisiteIds: ['stg_001', 'stg_001'] })).rejects.toMatchObject({ details: { reason: 'duplicate_prerequisite' } });
    t.store.state.projects.prj_099 = makeProject({ id: 'prj_099', name: 'Other project' });
    t.store.state.stages.stg_099 = makeStage({ id: 'stg_099', projectId: 'prj_099' });
    await expect(t.api.call('stages.setPrerequisites', { stageId: 'stg_003', prerequisiteIds: ['stg_099'] })).rejects.toMatchObject({ details: { reason: 'prerequisite_not_in_project' } });
    t.as('usr_003');
    await expect(t.api.call('stages.setPrerequisites', { stageId: 'stg_003', prerequisiteIds: [] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('keeps the prerequisites of a stage that stays when the stage list is replaced', async () => {
    const t = world();
    t.store.state.stages.stg_003.prerequisiteIds = ['stg_002'];
    const stages = Object.values(t.store.state.stages).filter((s) => s.projectId === 'prj_001').sort((a, b) => a.order - b.order);
    await t.api.call('stages.replace', { projectId: 'prj_001', stages: stages.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })) });
    expect(t.store.state.stages.stg_003.prerequisiteIds).toEqual(['stg_002']);
    await t.api.call('stages.replace', { projectId: 'prj_001', stages: stages.filter((s) => s.id !== 'stg_002').map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate })) });
    expect(t.store.state.stages.stg_003.prerequisiteIds ?? []).toEqual([]);
  });
});

describe('the automatic stage tag', () => {
  it('is the earliest stage by start date that has an open task', async () => {
    const t = world();
    // Schematic Design starts on 1 Sep and Concept on 1 Aug, but give Concept the later start: time order, not the order of the list.
    t.store.state.stages.stg_001.startDate = '2026-09-20';
    t.store.state.stages.stg_001.endDate = '2026-10-10';
    put(t, 'tsk_001', { stageId: 'stg_001' });
    put(t, 'tsk_002', { stageId: 'stg_002' });
    put(t, 'tsk_003', { stageId: 'stg_003' });
    expect(await tag(t)).toBe('stg_002');
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.stages.map((s) => s.id)).toEqual(['stg_002', 'stg_001', 'stg_003']);
  });

  it('is the last stage with any task when every task is done, and the first stage with no task', async () => {
    const t = world();
    expect(await tag(t)).toBe('stg_001');
    put(t, 'tsk_001', { stageId: 'stg_001', status: 'done' });
    put(t, 'tsk_002', { stageId: 'stg_002', status: 'done' });
    expect(await tag(t)).toBe('stg_002');
    put(t, 'tsk_003', { stageId: 'stg_003' });
    expect(await tag(t)).toBe('stg_003');
  });

  it('is computed from the tasks, whatever the saved value says', async () => {
    const t = world();
    t.store.state.projects.prj_001.currentStageId = 'stg_003';
    put(t, 'tsk_001', { stageId: 'stg_001' });
    expect(await tag(t)).toBe('stg_001');
    expect((await t.api.call('projects.list', {})).find((s) => s.project.id === 'prj_001')?.currentStage.id).toBe('stg_001');
  });

  it('keeps the saved value in step on every write that changes tasks', async () => {
    const t = world();
    const saved = () => t.store.state.projects.prj_001.currentStageId;
    const a = await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_002', title: 'One', ownerId: 'usr_003' });
    expect(saved()).toBe('stg_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_003', title: 'Two' });
    expect(saved()).toBe('stg_002');
    await t.api.call('tasks.complete', { id: a.task.id });
    expect(saved()).toBe('stg_003');
    const b = Object.values(t.store.state.tasks).find((x) => x.stageId === 'stg_003')!;
    await t.api.call('tasks.delete', { id: b.id });
    expect(saved()).toBe('stg_002');
  });

  it('follows a change of stage dates and a new stage list', async () => {
    const t = world();
    put(t, 'tsk_001', { stageId: 'stg_001' });
    put(t, 'tsk_002', { stageId: 'stg_002' });
    await t.api.call('stages.setDates', { stageId: 'stg_002', startDate: '2026-07-01', endDate: '2026-07-31' });
    expect(t.store.state.projects.prj_001.currentStageId).toBe('stg_002');
    const stages = Object.values(t.store.state.stages).filter((s) => s.projectId === 'prj_001').sort((a, b) => a.order - b.order);
    await t.api.call('stages.replace', { projectId: 'prj_001', stages: [{ name: 'Brief' }, ...stages.map((s) => ({ id: s.id, name: s.name, startDate: s.startDate, endDate: s.endDate }))] });
    expect(t.store.state.stages[t.store.state.projects.prj_001.currentStageId].name).toBe('Schematic Design');
  });
});

describe('the reason for moving back', () => {
  const back = (t: T) => {
    put(t, 'tsk_001', { stageId: 'stg_001', status: 'done', completedAt: '2026-09-20T09:00:00.000+03:00' });
    put(t, 'tsk_002', { stageId: 'stg_002' });
  };

  it('refuses a reopening that moves the tag back without a reason, and names the stage', async () => {
    const t = world();
    back(t);
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'stage_back_reason', stageName: 'Concept', stageId: 'stg_001' },
    });
    expect(status(t, 'tsk_001')).toBe('done');
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: '   ' })).rejects.toMatchObject({ details: { reason: 'stage_back_reason' } });
  });

  it('records the reason with the call, and shows it until the tag moves forward again', async () => {
    const t = world();
    back(t);
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Balady asked for changes' });
    const project = t.store.state.projects.prj_001;
    expect(project.currentStageId).toBe('stg_001');
    expect(project.stageBack).toMatchObject({ fromStageId: 'stg_002', toStageId: 'stg_001', reason: 'Balady asked for changes', by: 'usr_001' });
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(t.store.state.projects.prj_001.currentStageId).toBe('stg_002');
    expect(t.store.state.projects.prj_001.stageBack ?? null).toBeNull();
  });

  it('asks the same of a task that is added or moved into an earlier stage', async () => {
    const t = world();
    put(t, 'tsk_002', { stageId: 'stg_002' });
    await t.api.call('tasks.update', { id: 'tsk_002', patch: { title: 'Renamed' } });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_001', title: 'Early' })).rejects.toMatchObject({ details: { reason: 'stage_back_reason' } });
    const made = await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_001', title: 'Early', reason: 'A late brief item', ownerId: 'usr_003' });
    expect(t.store.state.projects.prj_001.stageBack).toMatchObject({ toStageId: 'stg_001', reason: 'A late brief item' });
    await t.api.call('tasks.complete', { id: made.task.id });
    put(t, 'tsk_003', { stageId: 'stg_003' });
    t.store.state.tasks.tsk_002.status = 'done';
    await t.api.call('tasks.update', { id: 'tsk_003', patch: { stageId: 'stg_003' } });
    await expect(t.api.call('tasks.update', { id: 'tsk_003', patch: { stageId: 'stg_002' } })).rejects.toMatchObject({ details: { reason: 'stage_back_reason', stageName: 'Schematic Design' } });
    await expect(t.api.call('tasks.update', { id: 'tsk_003', patch: { stageId: 'stg_002' }, reason: 'It belongs earlier' })).resolves.toBeTruthy();
    await t.api.call('tasks.update', { id: 'tsk_003', patch: { stageId: 'stg_003' } });
    await expect(t.api.call('tasks.update', { id: 'tsk_003', patch: { stageId: 'stg_001' } })).rejects.toMatchObject({ details: { reason: 'stage_back_reason' } });
  });

  it('asks when a prerequisite cascade moves the tag back, and uses the reason of a new version', async () => {
    const t = world();
    put(t, 'tsk_001', { stageId: 'stg_001', status: 'done', completedAt: '2026-09-20T09:00:00.000+03:00' });
    put(t, 'tsk_002', { stageId: 'stg_002', status: 'done', completedAt: '2026-09-21T09:00:00.000+03:00' });
    needs(t, 'tsk_002', 'tsk_001');
    expect(await tag(t)).toBe('stg_002');
    await expect(t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' })).rejects.toMatchObject({ details: { reason: 'stage_back_reason', stageName: 'Concept' } });
    await t.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'New site survey' });
    expect(t.store.state.projects.prj_001.stageBack).toMatchObject({ reason: 'New site survey', toStageId: 'stg_001' });
  });

  it('never asks for a change that does not move the tag back, or for an Undo', async () => {
    const t = world();
    back(t);
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    expect(t.store.state.projects.prj_001.currentStageId).toBe('stg_002');
    await t.api.call('tasks.move', { id: 'tsk_002', status: 'in_progress' }, { correlationId: 'story_x' });
    await t.api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'story_y' });
    await t.api.call('events.undoStory', { correlationId: 'story_y' });
    expect(status(t, 'tsk_002')).toBe('in_progress');
  });

  it('puts the tag back by Undo and clears the note', async () => {
    const t = world();
    back(t);
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo', reason: 'Why not' }, { correlationId: 'story_z' });
    expect(t.store.state.projects.prj_001.currentStageId).toBe('stg_001');
    await t.api.call('events.undoStory', { correlationId: 'story_z' });
    expect(t.store.state.projects.prj_001.currentStageId).toBe('stg_002');
    expect(t.store.state.projects.prj_001.stageBack ?? null).toBeNull();
    expect(status(t, 'tsk_001')).toBe('done');
  });
});

describe('automatic date shifts', () => {
  // A is due Fri 25 Sep and is finished on Wed 30 Sep: Sun, Mon, Tue and Wed count, so 4 working days late.
  const late = (t: T) => {
    put(t, 'tsk_001', { status: 'in_progress', dueDate: '2026-09-25', startDate: '2026-09-16' });
    put(t, 'tsk_002', { schedule: 'dynamic', startDate: '2026-10-01', durationDays: 5, dueDate: '2026-10-07' });
    put(t, 'tsk_003', { schedule: 'static', startDate: '2026-10-01', dueDate: '2026-10-07' });
    put(t, 'tsk_004', { schedule: 'dynamic', status: 'done', startDate: '2026-09-01', durationDays: 3, dueDate: '2026-09-03' });
    needs(t, 'tsk_002', 'tsk_001');
    needs(t, 'tsk_003', 'tsk_001');
    needs(t, 'tsk_004', 'tsk_001');
  };

  it('moves a dynamic task by the working days the task it needs was late, and no other', async () => {
    const t = world();
    late(t);
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const b = t.store.state.tasks.tsk_002;
    expect([b.startDate, b.dueDate]).toEqual(['2026-10-07', '2026-10-13']);
    expect([t.store.state.tasks.tsk_003.startDate, t.store.state.tasks.tsk_003.dueDate]).toEqual(['2026-10-01', '2026-10-07']);
    expect(t.store.state.tasks.tsk_004.dueDate).toBe('2026-09-03');
  });

  it('writes the old dates in the task as a note', async () => {
    const t = world();
    late(t);
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [note] = (await t.api.call('tasks.get', { id: 'tsk_002' })).task.dateNotes ?? [];
    expect(note).toMatchObject({
      from: { startDate: '2026-10-01', dueDate: '2026-10-07' }, to: { startDate: '2026-10-07', dueDate: '2026-10-13' },
      reason: 'Task A finished 4 working days late', byTaskId: 'tsk_001', lateDays: 4,
    });
    expect((await t.api.call('tasks.get', { id: 'tsk_003' })).task.dateNotes).toBeUndefined();
  });

  it('logs each move in the Tracker', async () => {
    const t = world();
    late(t);
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const entries = Object.values(t.store.state.tracker ?? {}).filter((e) => e.auto === 'shift');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'other', direction: 'none', title: 'Task B moved 4 working days', waiting: null });
    expect(entries[0].note).toContain('Task A');
    expect(entries[0].note).toContain('Wed 7 Oct');
    expect(entries[0].note).toContain('Tue 13 Oct');
  });

  it('does not move anything when the task is finished on or before its due day', async () => {
    const t = world();
    late(t);
    t.store.state.tasks.tsk_001.dueDate = '2026-09-30';
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_002.startDate).toBe('2026-10-01');
    expect(Object.values(t.store.state.tracker ?? {}).filter((e) => e.auto === 'shift')).toHaveLength(0);
  });

  it('counts a weekend as no working day', async () => {
    const t = world();
    late(t);
    // Due Thu 24 Sep, finished Wed 30 Sep: Sun to Wed is 4 working days; Fri and Sat do not count.
    t.store.state.tasks.tsk_001.dueDate = '2026-09-24';
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    expect(t.store.state.tasks.tsk_002.dateNotes?.[0].lateDays).toBe(4);
    // One day late: due Tue 29, finished Wed 30.
    const u = world();
    late(u);
    u.store.state.tasks.tsk_001.dueDate = '2026-09-29';
    await u.api.call('tasks.complete', { id: 'tsk_001' });
    expect([u.store.state.tasks.tsk_002.startDate, u.store.state.tasks.tsk_002.dueDate]).toEqual(['2026-10-04', '2026-10-08']);
  });

  it('is undone by one Undo, with its Tracker entries', async () => {
    const t = world();
    late(t);
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'story_shift' });
    await t.api.call('events.undoStory', { correlationId: 'story_shift' });
    const b = t.store.state.tasks.tsk_002;
    expect([b.startDate, b.dueDate]).toEqual(['2026-10-01', '2026-10-07']);
    expect(b.dateNotes ?? []).toEqual([]);
    expect(status(t, 'tsk_001')).toBe('in_progress');
    expect(Object.values(t.store.state.tracker ?? {}).filter((e) => e.auto === 'shift')).toHaveLength(0);
  });

  it('shifts when the review is approved, and keeps only the last 20 notes', async () => {
    const t = world();
    late(t);
    t.store.state.tasks.tsk_001.status = 'in_review';
    t.store.state.tasks.tsk_002.dateNotes = Array.from({ length: 20 }, (_, i) => ({
      from: { startDate: null, dueDate: null }, to: { startDate: null, dueDate: null }, reason: `older ${i}`, at: '2026-09-01T09:00:00.000+03:00',
    }));
    await t.api.call('tasks.approve', { id: 'tsk_001' });
    const notes = t.store.state.tasks.tsk_002.dateNotes ?? [];
    expect(notes).toHaveLength(20);
    expect(notes[19].reason).toBe('Task A finished 4 working days late');
    expect(notes[0].reason).toBe('older 1');
  });
});

describe('the order of tasks and stages', () => {
  it('lists tasks by start date, then due date, then stage, then title', async () => {
    const t = world();
    put(t, 'tsk_001', { title: 'Zebra', startDate: '2026-10-05', dueDate: '2026-10-09' });
    put(t, 'tsk_002', { title: 'Alpha', startDate: '2026-10-05', dueDate: '2026-10-08' });
    put(t, 'tsk_003', { title: 'Nothing set', startDate: null, dueDate: null });
    put(t, 'tsk_004', { title: 'Early', startDate: '2026-10-01', dueDate: '2026-10-30' });
    put(t, 'tsk_005', { title: 'Bravo', startDate: '2026-10-05', dueDate: '2026-10-09', stageId: 'stg_001' });
    const rows = await t.api.call('tasks.list', { projectId: 'prj_001' });
    expect(rows.map((r) => r.task.title)).toEqual(['Early', 'Alpha', 'Bravo', 'Zebra', 'Nothing set']);
  });

  it('lists stages by start date, then end date, then order, with undated stages last', async () => {
    const t = world();
    t.store.state.stages.stg_003.startDate = '2026-08-01';
    t.store.state.stages.stg_003.endDate = '2026-08-15';
    t.store.state.stages.stg_001.endDate = '2026-08-31';
    t.store.state.stages.stg_004 = makeStage({ id: 'stg_004', name: 'Tender', order: 3, startDate: null, endDate: null });
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.stages.map((s) => s.id)).toEqual(['stg_003', 'stg_001', 'stg_002', 'stg_004']);
  });
});
