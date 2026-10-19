import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { projectCalls } from './projects';
import { projectTemplateCalls } from './projectTemplates';
import { taskCalls } from './tasks';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import type { SyncChoices } from '../templateSync';

beforeEach(() => setNow(NOW));

const world = () => testApi({ ...projectCalls, ...projectTemplateCalls, ...taskCalls, ...historyCalls });
type World = ReturnType<typeof world>;

/** Two stages, Concept (s1) and Permits (s2). t1 has the role r1 (usr_002 by default), t2 has no role. */
const TEMPLATE = {
  name: 'Villa',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 10, durationDays: 5, flexible: true },
  ],
};

/** A task of the template that waits for nothing, with its own id, title and place. */
const extra = (id: string, title: string, stageId: string, startOffset: number, roleId: string | null = null) =>
  ({ id, stageId, title, description: '', checklist: [], needsReview: false, roleId, startOffset, durationDays: 2, flexible: true });

const NO_CHANGE: SyncChoices = { add: false, bringBack: false, removed: 'keep', text: false, dates: false, leads: false, closed: 'leave', stages: false, edited: 'keep' };
const choose = (over: Partial<SyncChoices>) => ({ ...NO_CHANGE, ...over });

/** Saves a template (a new one without an id), and returns its id. */
async function savedTemplate(t: World, template: Record<string, unknown> = TEMPLATE): Promise<string> {
  return (await t.api.call('projectTemplates.save', template as never)).id;
}

/** A project made from the template, with the start of 4 October 2026. */
async function madeFrom(t: World, templateId: string, name: string): Promise<string> {
  const { project } = await t.api.call('projects.create', { name, template: { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
  return project.id;
}

/** The task of a template part in one project, or undefined. */
const byPart = (t: World, projectId: string, partId: string) =>
  Object.values(t.store.state.tasks).find((task) => task.projectId === projectId && task.templatePartId === partId);

/** The stage of a template part in one project. */
const stageByPart = (t: World, projectId: string, partId: string) =>
  Object.values(t.store.state.stages).find((stage) => stage.projectId === projectId && stage.templatePartId === partId)!;

const linkOf = (t: World, projectId: string) => t.store.state.projects[projectId].templateLink!;

/** The template with some of its parts changed, keeping its id. */
const changed = (templateId: string, changes: Record<string, unknown>) => ({ ...TEMPLATE, ...changes, id: templateId });

describe('projectTemplates.usage', () => {
  it('lists the open projects that use the template, and the open projects with no link', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    await madeFrom(t, templateId, 'Beta villa');
    await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('projects.create', { name: 'Gamma plain', stages: ['Brief'] });
    const usage = await t.api.call('projectTemplates.usage', { templateId });
    expect(usage.linked.map((row) => row.project.name)).toEqual(['Alpha villa', 'Beta villa']);
    expect(usage.linked[0]).toMatchObject({ status: 'active', staleDays: null });
    expect(usage.notLinked.map((row) => row.project.name)).toEqual(expect.arrayContaining(['Gamma plain', 'Test Tower']));
  });

  it('leaves out a project that is linked to another template', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const other = await savedTemplate(t, { ...TEMPLATE, name: 'Cottage' });
    await madeFrom(t, other, 'Cottage one');
    const usage = await t.api.call('projectTemplates.usage', { templateId });
    expect(usage.linked).toEqual([]);
    expect(usage.notLinked.map((row) => row.project.name)).not.toContain('Cottage one');
  });

  it('forbids a Member', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    t.as('usr_003');
    await expect(t.api.call('projectTemplates.usage', { templateId })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('projectTemplates.syncPlan', () => {
  it('names the diff of each listed project that uses the template, and no other project', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] }));
    const plan = await t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [alpha, 'prj_001'] });
    expect(plan.map((row) => row.project.id)).toEqual([alpha]);
    expect(plan[0].diff.text.map((item) => item.itemId)).toEqual([byPart(t, alpha, 't1')!.id]);
  });

  it('forbids a Member', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    t.as('usr_003');
    await expect(t.api.call('projectTemplates.syncPlan', { templateId, projectIds: ['prj_001'] })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('projectTemplates.syncApply: each choice does what it says and nothing more', () => {
  it('add creates a new template task, and a part that the team dropped stays dropped', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('tasks.delete', { id: byPart(t, alpha, 't2')!.id });
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [...TEMPLATE.tasks, extra('t3', 'Site visit', 's2', 15)] }));
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ add: true }) });
    expect(counts).toMatchObject({ added: 1, broughtBack: 0 });
    expect(byPart(t, alpha, 't3')).toMatchObject({ title: 'Site visit', stageId: stageByPart(t, alpha, 's2').id });
    expect(byPart(t, alpha, 't2')).toBeUndefined();
    expect(linkOf(t, alpha).droppedPartIds).toEqual(['t2']);
    expect(linkOf(t, alpha).syncedAt).not.toBeNull();
  });

  it('bringBack brings a dropped task back and takes its part off the dropped list', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('tasks.delete', { id: byPart(t, alpha, 't2')!.id });
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ bringBack: true }) });
    expect(counts).toMatchObject({ added: 0, broughtBack: 1 });
    expect(byPart(t, alpha, 't2')).toMatchObject({ title: 'Balady pack' });
    expect(linkOf(t, alpha).droppedPartIds).toEqual([]);
  });

  it('text sets the new title of an open task', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ text: true }) });
    expect(byPart(t, alpha, 't1')).toMatchObject({ title: 'Massing study v2' });
  });

  it('closed: leave keeps the title of a done task, and text_only changes it', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    t.store.state.tasks[byPart(t, alpha, 't1')!.id].status = 'done';
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ text: true, closed: 'leave' }) });
    expect(byPart(t, alpha, 't1')).toMatchObject({ title: 'Massing study' });
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ closed: 'text_only' }) });
    expect(counts).toMatchObject({ closed: 1, text: 0 });
    expect(byPart(t, alpha, 't1')).toMatchObject({ title: 'Massing study v2', status: 'done' });
  });

  it('dates: a moved set date needs a reason, and a reason goes into the task conversation', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const before = byPart(t, alpha, 't1')!.dueDate;
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], durationDays: 14 }, TEMPLATE.tasks[1]] }));
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ dates: true }) }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['dateReason'], reason: 'date_reason_needed' } });
    expect(byPart(t, alpha, 't1')!.dueDate).toBe(before);
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ dates: true }), dateReason: 'The design took more days' });
    const massing = byPart(t, alpha, 't1')!;
    expect(massing.dueDate).not.toBe(before);
    expect(Object.values(t.store.state.comments).some((c) => c.targetId === massing.id && c.body === 'The design took more days')).toBe(true);
  });

  it('leads: a new lead joins the team and gets the assignment notice; the lead that the team chose stays', async () => {
    const t = world();
    const templateId = await savedTemplate(t, { ...TEMPLATE, tasks: [...TEMPLATE.tasks, extra('t3', 'Plan check', 's2', 15, 'r1')] });
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('tasks.update', { id: byPart(t, alpha, 't3')!.id, patch: { ownerId: 'usr_003' } });
    await t.api.call('projectTemplates.save', changed(templateId, {
      roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_004' }],
      tasks: [...TEMPLATE.tasks, extra('t3', 'Plan check', 's2', 15, 'r1')],
    }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ leads: true }) });
    expect(byPart(t, alpha, 't1')).toMatchObject({ ownerId: 'usr_004' });
    expect(byPart(t, alpha, 't3')).toMatchObject({ ownerId: 'usr_003' });
    expect(t.store.state.members[`${alpha}:usr_004`]).toBeDefined();
    expect(linkOf(t, alpha).rolePeople).toEqual({ r1: 'usr_004' });
    const massing = byPart(t, alpha, 't1')!;
    expect(Object.values(t.store.state.notifications).some((n) => n.userId === 'usr_004' && n.trigger === 'task_assigned' && n.targetId === massing.id)).toBe(true);
  });

  it('removed: delete_unstarted deletes a task that has not started and keeps a started one', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const todo = byPart(t, alpha, 't1')!;
    const started = byPart(t, alpha, 't2')!;
    t.store.state.tasks[started.id].status = 'in_progress';
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [] }));
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ removed: 'delete_unstarted' }) });
    expect(counts).toMatchObject({ removed: 1 });
    expect(t.store.state.tasks[todo.id]).toBeUndefined();
    expect(t.store.state.tasks[started.id]).toBeDefined();
  });

  it('stages: renames a stage that the template renamed, and keeps its part id', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const concept = stageByPart(t, alpha, 's1');
    await t.api.call('projectTemplates.save', changed(templateId, { stages: [{ ...TEMPLATE.stages[0], name: 'Concept design' }, TEMPLATE.stages[1]] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ stages: true }) });
    expect(t.store.state.stages[concept.id]).toMatchObject({ name: 'Concept design', templatePartId: 's1' });
  });

  it('forbids a Member', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    t.as('usr_003');
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ add: true }) })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a project that is not linked, and a project linked to another template', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId: 'prj_001', choices: choose({ add: true }) }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_linked' } });
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const other = await savedTemplate(t, { ...TEMPLATE, name: 'Cottage' });
    await expect(t.api.call('projectTemplates.syncApply', { templateId: other, projectId: alpha, choices: choose({ add: true }) }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'other_template' } });
  });

  it('one Undo of one story takes back the changes of three projects', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const projects = [await madeFrom(t, templateId, 'Alpha villa'), await madeFrom(t, templateId, 'Beta villa'), await madeFrom(t, templateId, 'Gamma villa')];
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [...TEMPLATE.tasks, extra('t3', 'Site visit', 's2', 15)] }));
    for (const projectId of projects) {
      await t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: choose({ add: true }) }, { correlationId: 'cor_sync' });
    }
    for (const projectId of projects) expect(byPart(t, projectId, 't3')).toBeDefined();
    await t.api.call('events.undoStory', { correlationId: 'cor_sync' });
    for (const projectId of projects) {
      expect(byPart(t, projectId, 't3')).toBeUndefined();
      expect(linkOf(t, projectId).syncedAt).toBeNull();
    }
  });

  it('stages: an Undo of the story takes back the stage names of two projects', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const beta = await madeFrom(t, templateId, 'Beta villa');
    await t.api.call('projectTemplates.save', changed(templateId, { stages: [{ ...TEMPLATE.stages[0], name: 'Concept design' }, TEMPLATE.stages[1]] }));
    for (const projectId of [alpha, beta]) {
      await t.api.call('projectTemplates.syncApply', { templateId, projectId, choices: choose({ stages: true }) }, { correlationId: 'cor_rename' });
    }
    expect(stageByPart(t, alpha, 's1').name).toBe('Concept design');
    expect(stageByPart(t, beta, 's1').name).toBe('Concept design');
    await t.api.call('events.undoStory', { correlationId: 'cor_rename' });
    expect(stageByPart(t, alpha, 's1').name).toBe('Concept');
    expect(stageByPart(t, beta, 's1').name).toBe('Concept');
  });

  it('add: an Undo of the story takes back a new stage with its task, and the link is unsynced again', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const handover = { id: 's3', name: 'Handover', startOffset: 20, durationDays: 5 };
    await t.api.call('projectTemplates.save', changed(templateId, { stages: [...TEMPLATE.stages, handover], tasks: [...TEMPLATE.tasks, extra('t3', 'Handover pack', 's3', 20)] }));
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ add: true }) }, { correlationId: 'cor_stage' });
    expect(counts).toMatchObject({ added: 2 });
    expect(stageByPart(t, alpha, 's3')).toMatchObject({ name: 'Handover' });
    expect(byPart(t, alpha, 't3')).toMatchObject({ stageId: stageByPart(t, alpha, 's3').id });
    await t.api.call('events.undoStory', { correlationId: 'cor_stage' });
    expect(Object.values(t.store.state.stages).some((stage) => stage.projectId === alpha && stage.templatePartId === 's3')).toBe(false);
    expect(byPart(t, alpha, 't3')).toBeUndefined();
    expect(linkOf(t, alpha).syncedAt).toBeNull();
  });

  it('bringBack: an Undo of the story puts a brought back stage and its task on the dropped list again', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const concept = stageByPart(t, alpha, 's1');
    await t.api.call('tasks.delete', { id: byPart(t, alpha, 't2')!.id });
    await t.api.call('stages.replace', { projectId: alpha, stages: [{ id: concept.id, name: concept.name, startDate: concept.startDate, endDate: concept.endDate }] });
    expect(linkOf(t, alpha).droppedPartIds).toEqual(['t2', 's2']);
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ bringBack: true }) }, { correlationId: 'cor_back' });
    expect(counts).toMatchObject({ broughtBack: 2 });
    expect(linkOf(t, alpha).droppedPartIds).toEqual([]);
    await t.api.call('events.undoStory', { correlationId: 'cor_back' });
    expect(Object.values(t.store.state.stages).some((stage) => stage.projectId === alpha && stage.templatePartId === 's2')).toBe(false);
    expect(byPart(t, alpha, 't2')).toBeUndefined();
    expect(linkOf(t, alpha).droppedPartIds).toEqual(['t2', 's2']);
  });

  it('the stage tag follows a new task that the update adds to an earlier stage (watchStage)', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const permits = stageByPart(t, alpha, 's2');
    await t.api.call('tasks.complete', { id: byPart(t, alpha, 't1')!.id });
    expect(t.store.state.projects[alpha].currentStageId).toBe(permits.id);
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [...TEMPLATE.tasks, extra('t6', 'Extra concept check', 's1', 3)] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ add: true }) });
    expect(t.store.state.projects[alpha].currentStageId).toBe(stageByPart(t, alpha, 's1').id);
  });

  it('the tag moves to a stage that the same update creates, and one Undo of the story takes the tag back', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const permits = stageByPart(t, alpha, 's2');
    await t.api.call('tasks.complete', { id: byPart(t, alpha, 't1')!.id });
    expect(t.store.state.projects[alpha].currentStageId).toBe(permits.id);
    const survey = { id: 's3', name: 'Survey', startOffset: 0, durationDays: 3 };
    await t.api.call('projectTemplates.save', changed(templateId, { stages: [...TEMPLATE.stages, survey], tasks: [...TEMPLATE.tasks, extra('t3', 'Survey pack', 's3', 0)] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ add: true }) }, { correlationId: 'cor_tag' });
    expect(t.store.state.projects[alpha].currentStageId).toBe(stageByPart(t, alpha, 's3').id);
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_tag' })).resolves.toBeDefined();
    expect(Object.values(t.store.state.stages).some((stage) => stage.projectId === alpha && stage.templatePartId === 's3')).toBe(false);
    expect(byPart(t, alpha, 't3')).toBeUndefined();
    expect(t.store.state.projects[alpha].currentStageId).toBe(permits.id);
  });

  it('the tag moves to a final stage that the update creates after every task is done, and one Undo takes it back', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const permits = stageByPart(t, alpha, 's2');
    await t.api.call('tasks.complete', { id: byPart(t, alpha, 't1')!.id });
    await t.api.call('tasks.take', { taskId: byPart(t, alpha, 't2')!.id });
    await t.api.call('tasks.complete', { id: byPart(t, alpha, 't2')!.id });
    expect(t.store.state.projects[alpha].currentStageId).toBe(permits.id);
    const handover = { id: 's3', name: 'Handover', startOffset: 20, durationDays: 5 };
    await t.api.call('projectTemplates.save', changed(templateId, { stages: [...TEMPLATE.stages, handover], tasks: [...TEMPLATE.tasks, extra('t3', 'Handover pack', 's3', 20)] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ add: true }) }, { correlationId: 'cor_final' });
    expect(t.store.state.projects[alpha].currentStageId).toBe(stageByPart(t, alpha, 's3').id);
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_final' })).resolves.toBeDefined();
    expect(Object.values(t.store.state.stages).some((stage) => stage.projectId === alpha && stage.templatePartId === 's3')).toBe(false);
    expect(t.store.state.projects[alpha].currentStageId).toBe(permits.id);
  });
});

describe('projectTemplates.syncApply: the edits of the team stay (ADM-01)', () => {
  const ALL_ON = { add: true, text: true, dates: true, leads: true, stages: true };

  it('keeps a description that the team wrote when the template did not change, with every default on', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const massing = byPart(t, alpha, 't1')!;
    t.store.state.tasks[massing.id].description = 'Client gate code 4471';
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose(ALL_ON) });
    expect(counts).toMatchObject({ text: 0, dates: 0, edited: 0 });
    expect(byPart(t, alpha, 't1')).toMatchObject({ description: 'Client gate code 4471' });
  });

  it('keeps the title that the team wrote when the template changed it too, unless the Admin picks the template', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    t.store.state.tasks[byPart(t, alpha, 't1')!.id].title = 'Massing (team)';
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] }));
    const plan = await t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [alpha] });
    expect(plan[0].diff.text).toEqual([]);
    expect(plan[0].diff.edited).toEqual([expect.objectContaining({ title: 'Massing (team)', newTitle: 'Massing study v2' })]);
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose(ALL_ON) });
    expect(byPart(t, alpha, 't1')).toMatchObject({ title: 'Massing (team)' });
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ edited: 'use_template' }) });
    expect(counts).toMatchObject({ edited: 0 });
  });

  it('edited: use_template sets the template title and dates, and the date move asks a reason', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const massing = byPart(t, alpha, 't1')!;
    t.store.state.tasks[massing.id].title = 'Massing (team)';
    t.store.state.tasks[massing.id].dueDate = '2026-10-30';
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2', durationDays: 12 }, TEMPLATE.tasks[1]] }));
    await expect(t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ edited: 'use_template' }) }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'date_reason_needed' } });
    const counts = await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ edited: 'use_template' }), dateReason: 'The template changed' });
    expect(counts).toMatchObject({ edited: 1 });
    expect(byPart(t, alpha, 't1')).toMatchObject({ title: 'Massing study v2' });
    expect(byPart(t, alpha, 't1')!.dueDate).not.toBe('2026-10-30');
  });

  it('never replaces a description that has text with an empty one', async () => {
    const t = world();
    const templateId = await savedTemplate(t, { ...TEMPLATE, tasks: [{ ...TEMPLATE.tasks[0], description: 'Three options.' }, TEMPLATE.tasks[1]] });
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], description: '' }, TEMPLATE.tasks[1]] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ ...ALL_ON, edited: 'use_template' }) });
    expect(byPart(t, alpha, 't1')).toMatchObject({ description: 'Three options.' });
  });

  it('moves the copy to the template after an update, so the same change is not offered twice', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ text: true }) });
    expect(linkOf(t, alpha).base?.tasks.t1.title).toBe('Massing study v2');
    const plan = await t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [alpha] });
    expect(plan[0].diff).toMatchObject({ text: [], edited: [], dates: [] });
  });

  it('keeps the old copy of a kind that the Admin left out', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ text: false, stages: true }) });
    const plan = await t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [alpha] });
    expect(plan[0].diff.text).toHaveLength(1);
  });

  it('shows every difference of a link with no copy as edited, and the first update writes the copy', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    const link = t.store.state.projects[alpha].templateLink!;
    delete link.base;
    t.store.state.tasks[byPart(t, alpha, 't1')!.id].title = 'Massing (team)';
    const plan = await t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [alpha] });
    expect(plan[0].diff.text).toEqual([]);
    expect(plan[0].diff.edited).toHaveLength(1);
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose(ALL_ON) });
    expect(byPart(t, alpha, 't1')).toMatchObject({ title: 'Massing (team)' });
    expect(linkOf(t, alpha).base?.tasks.t1.title).toBe('Massing study');
  });

  it('a link made later keeps a copy too, and the first update of an unchanged template offers nothing', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const project = await t.api.call('projects.create', { name: 'Old villa', stages: ['Concept', 'Permits'] });
    const stages = Object.values(t.store.state.stages).filter((stage) => stage.projectId === project.project.id);
    await t.api.call('projectTemplates.link', {
      projectId: project.project.id, templateId, stageMatches: { s1: stages[0].id, s2: stages[1].id }, taskMatches: {}, rolePeople: { r1: null },
    });
    expect(linkOf(t, project.project.id).base?.stages.s1.name).toBe('Concept');
    const plan = await t.api.call('projectTemplates.syncPlan', { templateId, projectIds: [project.project.id] });
    expect(plan[0].diff).toMatchObject({ text: [], dates: [], stages: [], edited: [] });
  });

  it('one Undo of the story brings back the copy of the link', async () => {
    const t = world();
    const templateId = await savedTemplate(t);
    const alpha = await madeFrom(t, templateId, 'Alpha villa');
    await t.api.call('projectTemplates.save', changed(templateId, { tasks: [{ ...TEMPLATE.tasks[0], title: 'Massing study v2' }, TEMPLATE.tasks[1]] }));
    await t.api.call('projectTemplates.syncApply', { templateId, projectId: alpha, choices: choose({ text: true }) }, { correlationId: 'cor_base' });
    await t.api.call('events.undoStory', { correlationId: 'cor_base' });
    expect(linkOf(t, alpha).base?.tasks.t1.title).toBe('Massing study');
    expect(byPart(t, alpha, 't1')).toMatchObject({ title: 'Massing study' });
  });
});
