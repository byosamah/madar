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
