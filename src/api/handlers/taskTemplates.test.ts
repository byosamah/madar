import { beforeEach, describe, expect, it } from 'vitest';
import { taskCalls } from './tasks';
import { taskTemplateCalls } from './taskTemplates';
import { historyCalls } from './history';
import { makeStage, makeTask, NOW, TODAY, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { dueFromDuration } from '../../lib/workdays';

beforeEach(() => setNow(NOW));

/** A small office, plus a Permits stage and a done task with a ticked checklist to save from. */
function world() {
  const t = testApi({ ...taskCalls, ...taskTemplateCalls, ...historyCalls });
  t.store.state.stages.stg_003 = makeStage({ id: 'stg_003', name: 'Permits', order: 2 });
  t.store.state.counters.stg = 3;
  t.store.state.tasks.tsk_001 = makeTask({
    title: 'Floor plans set', description: 'All levels.', ownerId: 'usr_003', needsReview: false,
    checklist: [{ id: 'chk_a', text: 'Ground floor', done: true }, { id: 'chk_b', text: 'Typical floor', done: true }, { id: 'chk_c', text: 'Roof plan', done: false }],
  });
  t.store.state.counters.tsk = 1;
  return t;
}

describe('taskTemplates.save', () => {
  it('saves a template from a task: title, stage name, description, checklist titles, review and timing', async () => {
    const t = world();
    t.as('usr_002');
    const saved = await t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001' });
    expect(saved).toMatchObject({
      id: 'ttp_001', name: 'Floor plans set', stageName: 'Schematic Design', description: 'All levels.',
      checklist: ['Ground floor', 'Typical floor', 'Roof plan'], needsReview: false, schedule: 'static', durationDays: null,
      createdBy: 'usr_002', createdByName: 'Faisal Leader', canEdit: true,
    });
    expect(Object.values(t.store.state.events).some((e) => e.verb === 'taskTemplate.created')).toBe(true);
  });

  it('keeps the timing of a dynamic task', async () => {
    const t = world();
    Object.assign(t.store.state.tasks.tsk_001, { schedule: 'dynamic', startDate: '2026-10-04', durationDays: 6, dueDate: '2026-10-11' });
    t.as('usr_002');
    expect(await t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001' })).toMatchObject({ schedule: 'dynamic', durationDays: 6 });
  });

  it('lets the Admin save, and refuses a team member and an outsider', async () => {
    const t = world();
    t.as('usr_001');
    await t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001' });
    t.as('usr_003');
    await expect(t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001', name: 'Mine' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    await expect(t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001', name: 'Theirs' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('saves from fields alone for a person who leads a project, and refuses everyone else', async () => {
    const t = world();
    t.as('usr_002');
    const saved = await t.api.call('taskTemplates.save', { name: 'Door schedule', stageName: 'Permits', checklist: ['Doors', 'Windows'] });
    expect(saved).toMatchObject({ stageName: 'Permits', checklist: ['Doors', 'Windows'], needsReview: true, schedule: 'static' });
    t.as('usr_003');
    await expect(t.api.call('taskTemplates.save', { name: 'X', stageName: 'Permits' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await expect(t.api.call('taskTemplates.save', { name: 'X' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['stageName'] } });
    await expect(t.api.call('taskTemplates.save', { stageName: 'Permits' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['name'] } });
  });

  it('needs a duration for a dynamic template', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('taskTemplates.save', { name: 'X', stageName: 'Permits', schedule: 'dynamic' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await t.api.call('taskTemplates.save', { name: 'X', stageName: 'Permits', schedule: 'dynamic', durationDays: 4 })).toMatchObject({ durationDays: 4 });
  });

  it('refuses the same name in the same stage, ignoring case, but not in another stage', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001' });
    await expect(t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001', name: 'FLOOR plans SET' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001', stageName: 'Permits' })).resolves.toMatchObject({ stageName: 'Permits' });
  });

  it('removes the template when the save is undone', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001' }, { correlationId: 'cor_ui_save' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_save' });
    expect(await t.api.call('taskTemplates.list', {})).toEqual([]);
  });
});

describe('taskTemplates.list', () => {
  it('lists nothing in an old office with no collection', async () => {
    const t = world();
    delete t.store.state.taskTemplates;
    expect(await t.api.call('taskTemplates.list', {})).toEqual([]);
  });

  it('lists only the templates of the stage name asked for', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { name: 'Floor plans set', stageName: 'Construction Documents' });
    await t.api.call('taskTemplates.save', { name: 'Material board', stageName: 'Design Development' });
    await t.api.call('taskTemplates.save', { name: 'Balady pack', stageName: 'Permits' });
    t.as('usr_004');
    expect((await t.api.call('taskTemplates.list', { stageName: 'permits' })).map((r) => r.name)).toEqual(['Balady pack']);
    expect((await t.api.call('taskTemplates.list', { stageName: 'Design Development' })).map((r) => r.name)).toEqual(['Material board']);
    expect((await t.api.call('taskTemplates.list', { stageName: 'Tender' }))).toEqual([]);
    expect((await t.api.call('taskTemplates.list', {})).map((r) => r.stageName)).toEqual(['Construction Documents', 'Design Development', 'Permits']);
  });
});

describe('taskTemplates.rename and delete', () => {
  it('lets the person who saved it and the Admin rename and delete, and no one else', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { name: 'Balady pack', stageName: 'Permits' });
    t.as('usr_003');
    expect((await t.api.call('taskTemplates.list', {}))[0].canEdit).toBe(false);
    await expect(t.api.call('taskTemplates.rename', { id: 'ttp_001', name: 'X' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('taskTemplates.delete', { id: 'ttp_001' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    expect(await t.api.call('taskTemplates.rename', { id: 'ttp_001', name: 'Balady submission' })).toMatchObject({ name: 'Balady submission', canEdit: true });
    t.as('usr_002');
    await t.api.call('taskTemplates.delete', { id: 'ttp_001' });
    expect(await t.api.call('taskTemplates.list', {})).toEqual([]);
    await expect(t.api.call('taskTemplates.delete', { id: 'ttp_001' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('refuses a new name that another template of the stage has', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { name: 'One', stageName: 'Permits' });
    await t.api.call('taskTemplates.save', { name: 'Two', stageName: 'Permits' });
    await expect(t.api.call('taskTemplates.rename', { id: 'ttp_002', name: 'one' })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await t.api.call('taskTemplates.rename', { id: 'ttp_002', name: 'Two' })).toMatchObject({ name: 'Two' });
  });

  it('brings a deleted template back with Undo', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { name: 'Balady pack', stageName: 'Permits' });
    await t.api.call('taskTemplates.delete', { id: 'ttp_001' }, { correlationId: 'cor_ui_del' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_del' });
    expect((await t.api.call('taskTemplates.list', {})).map((r) => r.name)).toEqual(['Balady pack']);
  });
});

describe('tasks.createFromTemplate', () => {
  it('keeps the template\'s "no review" only for the leader or the Admin (security review, 2026-10-01)', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001' });
    const byLeader = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002' });
    expect(byLeader.task.needsReview).toBe(false);
    t.as('usr_003');
    const byMember = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002' });
    expect(byMember.task.needsReview).toBe(true);
  });

  async function withTemplate() {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { fromTaskId: 'tsk_001' });
    return t;
  }

  it('makes the task with the template fields and the checklist unticked', async () => {
    const t = await withTemplate();
    t.as('usr_003');
    const made = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002' });
    expect(made.task).toMatchObject({
      title: 'Floor plans set', description: 'All levels.', status: 'todo', ownerId: 'usr_003', stageId: 'stg_002', projectId: 'prj_001',
    });
    // Security: only the leader or the Admin may skip the review step, so a team member's task from a template keeps it.
    expect(made.task.needsReview).toBe(true);
    expect(made.task.checklist.map((item) => [item.text, item.done])).toEqual([['Ground floor', false], ['Typical floor', false], ['Roof plan', false]]);
    expect(new Set(made.task.checklist.map((item) => item.id)).size).toBe(3);
    // The source task and the template do not change.
    expect(t.store.state.tasks.tsk_001.checklist[0].done).toBe(true);
  });

  it('refuses a stage the template was not saved for', async () => {
    const t = await withTemplate();
    t.as('usr_002');
    await expect(t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_003' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['templateId'] },
    });
    await expect(t.api.call('tasks.createFromTemplate', { templateId: 'ttp_009', stageId: 'stg_002' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('starts a dynamic template today and gives the due date from its working days', async () => {
    const t = world();
    t.as('usr_002');
    await t.api.call('taskTemplates.save', { name: 'Sections set', stageName: 'Schematic Design', schedule: 'dynamic', durationDays: 5 });
    const made = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002' });
    expect(made.task).toMatchObject({ schedule: 'dynamic', durationDays: 5, startDate: TODAY, dueDate: dueFromDuration(TODAY, 5) });
  });

  it('follows the rules of tasks.create: a team member cannot assign it to someone else, an outsider cannot make one', async () => {
    const t = await withTemplate();
    t.as('usr_003');
    await expect(t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002', ownerId: 'usr_002' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_004');
    await expect(t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const made = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002', ownerId: 'usr_003' });
    expect(made.task.ownerId).toBe('usr_003');
  });

  it('removes the task when the creation is undone', async () => {
    const t = await withTemplate();
    t.as('usr_002');
    const made = await t.api.call('tasks.createFromTemplate', { templateId: 'ttp_001', stageId: 'stg_002' }, { correlationId: 'cor_ui_make' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_make' });
    expect(t.store.state.tasks[made.task.id]).toBeUndefined();
  });
});
