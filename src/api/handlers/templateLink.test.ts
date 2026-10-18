import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { projectCalls } from './projects';
import { projectTemplateCalls } from './projectTemplates';
import { taskCalls } from './tasks';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { projectTemplatesOf } from '../store';

beforeEach(() => setNow(NOW));

const world = () => testApi({ ...projectCalls, ...projectTemplateCalls, ...taskCalls, ...historyCalls });

/** Three stages and two tasks. Stage s3 has no task, so a project can drop it without a stage_has_tasks refusal. */
const TEMPLATE = {
  name: 'Villa',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
    { id: 's3', name: 'Supervision', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing study', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 10, durationDays: 5, flexible: false },
  ],
};

async function linkedProject() {
  const t = world();
  const { id: templateId } = await t.api.call('projectTemplates.save', TEMPLATE);
  const { project } = await t.api.call('projects.create', { name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
  return { t, projectId: project.id };
}

const stagesOf = (t: ReturnType<typeof world>, projectId: string) =>
  Object.values(t.store.state.stages).filter((stage) => stage.projectId === projectId).sort((a, b) => a.order - b.order);

describe('a template part that a project drops', () => {
  it('adds the part id of a deleted template task to the link, and its Undo takes the part id back', async () => {
    const { t, projectId } = await linkedProject();
    const massing = Object.values(t.store.state.tasks).find((task) => task.projectId === projectId && task.templatePartId === 't1')!;
    await t.api.call('tasks.delete', { id: massing.id });
    expect(t.store.state.projects[projectId].templateLink?.droppedPartIds).toEqual(['t1']);
    const deleted = Object.values(t.store.state.events).find((e) => e.verb === 'task.deleted' && e.targetId === massing.id)!;
    await t.api.call('events.undo', { eventId: deleted.id });
    expect(t.store.state.tasks[massing.id]).toMatchObject({ templatePartId: 't1' });
    expect(t.store.state.projects[projectId].templateLink?.droppedPartIds).toEqual([]);
  });

  it('keeps the part id of each stage that stays, and adds the part id of a removed stage', async () => {
    const { t, projectId } = await linkedProject();
    const [concept, permits, supervision] = stagesOf(t, projectId);
    await t.api.call('stages.replace', {
      projectId,
      stages: [concept, permits].map((stage) => ({ id: stage.id, name: stage.name, startDate: null, endDate: null })),
    });
    expect(t.store.state.stages[concept.id]).toMatchObject({ templatePartId: 's1' });
    expect(t.store.state.stages[permits.id]).toMatchObject({ templatePartId: 's2' });
    expect(t.store.state.stages[supervision.id]).toBeUndefined();
    expect(t.store.state.projects[projectId].templateLink?.droppedPartIds).toEqual(['s3']);
  });

  it('adds no part id when a task of a project made without a template is deleted', async () => {
    const t = world();
    const { project } = await t.api.call('projects.create', { name: 'Plain', stages: ['Brief'] });
    const task = await t.api.call('tasks.create', { projectId: project.id, stageId: stagesOf(t, project.id)[0].id, title: 'Sketch', ownerId: 'usr_001' });
    await t.api.call('tasks.delete', { id: task.task.id });
    expect(t.store.state.projects[project.id].templateLink).toBeUndefined();
  });
});

describe('the highest part number of a template (partSeq)', () => {
  it('gives the highest number of its part ids, and keeps it when a part is removed', async () => {
    const t = world();
    const saved = await t.api.call('projectTemplates.save', TEMPLATE);
    expect(saved.partSeq).toBe(3);
    const cut = await t.api.call('projectTemplates.save', { ...TEMPLATE, id: saved.id, tasks: [TEMPLATE.tasks[0]] });
    expect(cut.partSeq).toBe(3);
    const grown = await t.api.call('projectTemplates.save', { ...TEMPLATE, id: saved.id, stages: [...TEMPLATE.stages, { id: 's9', name: 'Handover', startOffset: null, durationDays: null }] });
    expect(grown.partSeq).toBe(9);
  });

  it('gives a template saved before this change its highest number from its ids, at its next save', async () => {
    const t = world();
    const saved = await t.api.call('projectTemplates.save', TEMPLATE);
    delete projectTemplatesOf(t.store.state)[saved.id].partSeq;
    await t.api.call('projectTemplates.save', { ...TEMPLATE, id: saved.id, tasks: [TEMPLATE.tasks[0]] });
    expect(projectTemplatesOf(t.store.state)[saved.id].partSeq).toBe(3);
  });
});

/** A project made by hand: stages Concept, Permits and Site, a task "massing study" in Concept and "Balady pack" in Permits. */
async function handMadeProject() {
  const t = world();
  const { id: templateId } = await t.api.call('projectTemplates.save', TEMPLATE);
  const { project } = await t.api.call('projects.create', { name: 'Villa Noor', stages: ['Concept', 'Permits', 'Site'] });
  const stages = stagesOf(t, project.id);
  const massing = await t.api.call('tasks.create', { projectId: project.id, stageId: stages[0].id, title: 'massing study', ownerId: 'usr_001' });
  const pack = await t.api.call('tasks.create', { projectId: project.id, stageId: stages[1].id, title: 'Balady pack', ownerId: 'usr_001' });
  return { t, templateId, projectId: project.id, stages, massingId: massing.task.id, packId: pack.task.id };
}

describe('projectTemplates.matchPlan', () => {
  it('names the item of the project that matches each template part, by name', async () => {
    const { t, templateId, projectId, stages, massingId, packId } = await handMadeProject();
    expect(await t.api.call('projectTemplates.matchPlan', { projectId, templateId })).toEqual({
      stages: { s1: stages[0].id, s2: stages[1].id, s3: null },
      tasks: { t1: massingId, t2: packId },
    });
  });

  it('forbids a Member', async () => {
    const { t, templateId, projectId } = await handMadeProject();
    t.as('usr_003');
    await expect(t.api.call('projectTemplates.matchPlan', { projectId, templateId })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('projectTemplates.link', () => {
  it('writes the link, the part ids of the matches, and the parts with no match as dropped', async () => {
    const { t, templateId, projectId, stages, massingId, packId } = await handMadeProject();
    const plan = await t.api.call('projectTemplates.matchPlan', { projectId, templateId });
    await t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: plan.stages, taskMatches: plan.tasks, rolePeople: { r1: 'usr_002' } });
    expect(t.store.state.projects[projectId].templateLink).toMatchObject({ templateId, syncedAt: null, rolePeople: { r1: 'usr_002' }, droppedPartIds: ['s3'] });
    expect(t.store.state.stages[stages[0].id]).toMatchObject({ templatePartId: 's1' });
    expect(t.store.state.stages[stages[1].id]).toMatchObject({ templatePartId: 's2' });
    expect(t.store.state.tasks[massingId]).toMatchObject({ templatePartId: 't1' });
    expect(t.store.state.tasks[packId]).toMatchObject({ templatePartId: 't2' });
  });

  it('writes one story, and one Undo of that story takes the link and the part ids back', async () => {
    const { t, templateId, projectId, stages, massingId } = await handMadeProject();
    const plan = await t.api.call('projectTemplates.matchPlan', { projectId, templateId });
    await t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: plan.stages, taskMatches: plan.tasks, rolePeople: {} });
    const linked = Object.values(t.store.state.events).find((e) => e.verb === 'project.template_linked')!;
    await t.api.call('events.undoStory', { correlationId: linked.correlationId });
    expect(t.store.state.projects[projectId].templateLink).toBeFalsy();
    expect(t.store.state.stages[stages[0].id].templatePartId).toBeUndefined();
    expect(t.store.state.tasks[massingId].templatePartId).toBeUndefined();
  });

  it('refuses a task of another project', async () => {
    const { t, templateId, projectId } = await handMadeProject();
    const { project: other } = await t.api.call('projects.create', { name: 'Other office', stages: ['Concept'] });
    const otherStage = Object.values(t.store.state.stages).find((stage) => stage.projectId === other.id)!;
    const foreign = await t.api.call('tasks.create', { projectId: other.id, stageId: otherStage.id, title: 'Massing study', ownerId: 'usr_001' });
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: { t1: foreign.task.id }, rolePeople: {} }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'item_not_in_project' } });
    expect(t.store.state.projects[projectId].templateLink).toBeFalsy();
  });

  it('refuses a part id that the template does not have', async () => {
    const { t, templateId, projectId, stages } = await handMadeProject();
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: { s9: stages[0].id }, taskMatches: {}, rolePeople: {} }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'part_not_in_template' } });
  });

  it('refuses one project item that two template parts take', async () => {
    const { t, templateId, projectId, stages } = await handMadeProject();
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: { s1: stages[0].id, s2: stages[0].id }, taskMatches: {}, rolePeople: {} }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'duplicate_match' } });
  });

  it('refuses a role that the template does not have', async () => {
    const { t, templateId, projectId } = await handMadeProject();
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: { r9: 'usr_002' } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'part_not_in_template' } });
  });

  it('refuses a project that has a link already', async () => {
    const { t, projectId } = await linkedProject();
    const templateId = t.store.state.projects[projectId].templateLink!.templateId;
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: {}, taskMatches: {}, rolePeople: {} }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'already_linked' } });
  });

  it('forbids a Member to link', async () => {
    const { t, templateId, projectId, stages } = await handMadeProject();
    t.as('usr_003');
    await expect(t.api.call('projectTemplates.link', { projectId, templateId, stageMatches: { s1: stages[0].id }, taskMatches: {}, rolePeople: {} }))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});
