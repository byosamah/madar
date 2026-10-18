import { beforeEach, describe, expect, it } from 'vitest';
import { projectCalls } from './projects';
import { projectTemplateCalls } from './projectTemplates';
import { memberKey } from '../store';
import { NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { dueFromDuration } from '../../lib/workdays';

beforeEach(() => setNow(NOW));

const world = () => testApi({ ...projectCalls, ...projectTemplateCalls });

/**
 * An Architect role (default Faisal, usr_002), three stages, two tasks. 15 working days. The second task does not stretch.
 * 2026-10-04 is a Sunday; the office week is Sunday to Thursday.
 */
const TEMPLATE = {
  name: 'Villa',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: null, durationDays: null },
    { id: 's3', name: 'Supervision', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing study', description: 'Three options.', checklist: ['Site model', 'Sun study'], needsReview: true, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's2', title: 'Balady pack', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 10, durationDays: 5, flexible: false },
  ],
};

async function withTemplate() {
  const t = world();
  const { id } = await t.api.call('projectTemplates.save', TEMPLATE);
  return { t, templateId: id };
}

const tasksOf = (t: ReturnType<typeof world>, projectId: string) => Object.values(t.store.state.tasks).filter((task) => task.projectId === projectId);
const stagesOf = (t: ReturnType<typeof world>, projectId: string) =>
  Object.values(t.store.state.stages).filter((stage) => stage.projectId === projectId).sort((a, b) => a.order - b.order);

describe('projects.create from a project template', () => {
  it('makes the stages with dates, the tasks with dates and leads, and the project start and end', async () => {
    const { t, templateId } = await withTemplate();
    const detail = await t.api.call('projects.create', { name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    const id = detail.project.id;
    expect(detail.project).toMatchObject({ startDate: '2026-10-04', targetEndDate: '2026-10-22' });
    expect(stagesOf(t, id).map((s) => [s.name, s.order, s.startDate, s.endDate])).toEqual([
      ['Concept', 0, '2026-10-04', '2026-10-15'],
      ['Permits', 1, '2026-10-18', '2026-10-22'],
      ['Supervision', 2, null, null],
    ]);
    expect(detail.project.currentStageId).toBe(stagesOf(t, id)[0].id);
    const tasks = tasksOf(t, id);
    expect(tasks.map((task) => [task.title, task.ownerId, task.startDate, task.dueDate, task.schedule, task.status])).toEqual([
      ['Massing study', 'usr_002', '2026-10-04', '2026-10-15', 'static', 'todo'],
      ['Balady pack', null, '2026-10-18', '2026-10-22', 'static', 'todo'],
    ]);
    expect(tasks[0]).toMatchObject({ description: 'Three options.', stageId: stagesOf(t, id)[0].id, flagged: false, completedAt: null });
    expect(tasks[0].checklist.map((item) => [item.text, item.done])).toEqual([['Site model', false], ['Sun study', false]]);
    expect(new Set(tasks[0].checklist.map((item) => item.id)).size).toBe(2);
  });

  it('puts the person of a role on the team and tells them once', async () => {
    const { t, templateId } = await withTemplate();
    const before = Object.keys(t.store.state.notifications).length;
    const { project } = await t.api.call('projects.create', { name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', roles: { r1: 'usr_004' }, fixedTaskIds: [] } });
    expect(t.store.state.members[memberKey(project.id, 'usr_004')]).toBeDefined();
    // The default person is not on the team: the project named another person for the role.
    expect(t.store.state.members[memberKey(project.id, 'usr_002')]).toBeUndefined();
    expect(tasksOf(t, project.id)[0].ownerId).toBe('usr_004');
    const notices = Object.values(t.store.state.notifications).slice(before).filter((n) => n.userId === 'usr_004');
    expect(notices.map((n) => n.trigger)).toEqual(['added_to_project']);
  });

  it('gives the tasks of a role with no person no lead', async () => {
    const { t, templateId } = await withTemplate();
    const { project } = await t.api.call('projects.create', { name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', roles: { r1: null }, fixedTaskIds: [] } });
    expect(tasksOf(t, project.id).map((task) => task.ownerId)).toEqual([null, null]);
  });

  it('shrinks the plan to the end date and keeps the length of a locked task', async () => {
    const { t, templateId } = await withTemplate();
    const { project } = await t.api.call('projects.create', {
      name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', endDate: '2026-10-15', roles: {}, fixedTaskIds: ['t2'] },
    });
    expect(project.targetEndDate).toBe('2026-10-15');
    expect(tasksOf(t, project.id).map((task) => [task.startDate, task.dueDate])).toEqual([
      ['2026-10-04', '2026-10-08'],
      ['2026-10-11', '2026-10-15'],
    ]);
  });

  it('refuses an end date that the locked tasks do not fit, says how many days they need, and makes nothing', async () => {
    const { t, templateId } = await withTemplate();
    const projects = Object.keys(t.store.state.projects).length;
    await expect(t.api.call('projects.create', {
      name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', endDate: '2026-10-06', roles: {}, fixedTaskIds: ['t2'] },
    })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['template.endDate'], reason: 'template_too_short', names: '5' } });
    expect(Object.keys(t.store.state.projects)).toHaveLength(projects);
  });

  it('refuses an end date that is not after the start date', async () => {
    const { t, templateId } = await withTemplate();
    await expect(t.api.call('projects.create', {
      name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', endDate: '2026-10-04', roles: {}, fixedTaskIds: [] },
    })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['template.endDate'] } });
  });

  it('refuses a template that does not exist, a stage list or dates beside the template, and parts that the template does not have', async () => {
    const { t, templateId } = await withTemplate();
    const base = { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] };
    await expect(t.api.call('projects.create', { name: 'X', template: { ...base, templateId: 'ptp_404' } })).rejects.toMatchObject({ details: { fields: ['template.templateId'] } });
    await expect(t.api.call('projects.create', { name: 'X', stages: ['A'], template: base })).rejects.toMatchObject({ details: { fields: ['template'] } });
    await expect(t.api.call('projects.create', { name: 'X', startDate: '2026-10-04', template: base })).rejects.toMatchObject({ details: { fields: ['template'] } });
    await expect(t.api.call('projects.create', { name: 'X', template: { ...base, roles: { r9: 'usr_002' } } })).rejects.toMatchObject({ details: { fields: ['template.roles'] } });
    await expect(t.api.call('projects.create', { name: 'X', template: { ...base, fixedTaskIds: ['t9'] } })).rejects.toMatchObject({ details: { fields: ['template.fixedTaskIds'] } });
  });

  it('refuses a role person who left the office or an agent, and skips a default person who left', async () => {
    const { t, templateId } = await withTemplate();
    t.store.state.users.usr_004.active = false;
    const base = { templateId, startDate: '2026-10-04', fixedTaskIds: [] };
    await expect(t.api.call('projects.create', { name: 'X', template: { ...base, roles: { r1: 'usr_004' } } })).rejects.toMatchObject({ details: { reason: 'person_inactive' } });
    await expect(t.api.call('projects.create', { name: 'X', template: { ...base, roles: { r1: 'usr_005' } } })).rejects.toMatchObject({ details: { fields: ['template.roles'] } });
    t.store.state.users.usr_002.active = false;
    const { project } = await t.api.call('projects.create', { name: 'X', template: { ...base, roles: {} } });
    expect(tasksOf(t, project.id)[0].ownerId).toBeNull();
  });

  it('keeps "no review" of a template for a creator who leads the project, and asks for review when another person leads', async () => {
    const { t, templateId } = await withTemplate();
    const own = await t.api.call('projects.create', { name: 'Mine', template: { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    expect(tasksOf(t, own.project.id).map((task) => task.needsReview)).toEqual([true, false]);
    t.as('usr_003');
    const other = await t.api.call('projects.create', { name: 'Theirs', leader: 'usr_002', template: { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    expect(tasksOf(t, other.project.id).map((task) => task.needsReview)).toEqual([true, true]);
  });

  it('records each new task in the History of the project', async () => {
    const { t, templateId } = await withTemplate();
    const { project } = await t.api.call('projects.create', { name: 'Villa Noor', template: { templateId, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    const created = Object.values(t.store.state.events).filter((e) => e.projectId === project.id && e.verb === 'task.created');
    expect(created.map((e) => e.targetId).sort()).toEqual(tasksOf(t, project.id).map((task) => task.id).sort());
  });

  it('leaves the end of the project empty when the template has no dates and no end date is given', async () => {
    const t = world();
    const { id } = await t.api.call('projectTemplates.save', { name: 'Only stages', roles: [], stages: [{ id: 's1', name: 'Brief', startOffset: null, durationDays: null }], tasks: [] });
    const { project } = await t.api.call('projects.create', { name: 'X', template: { templateId: id, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    expect(project).toMatchObject({ startDate: '2026-10-04', targetEndDate: null });
    expect(stagesOf(t, project.id).map((s) => s.name)).toEqual(['Brief']);
  });

  it('makes a task that waits for another task dynamic, and links the new tasks and stages', async () => {
    const t = world();
    const linked = {
      ...TEMPLATE,
      stages: [TEMPLATE.stages[0], TEMPLATE.stages[1], { ...TEMPLATE.stages[2], prerequisiteIds: ['s1'] }],
      tasks: [TEMPLATE.tasks[0], { ...TEMPLATE.tasks[1], prerequisiteIds: ['t1'] }],
    };
    const { id } = await t.api.call('projectTemplates.save', linked);
    const { project } = await t.api.call('projects.create', { name: 'Villa Noor', template: { templateId: id, startDate: '2026-10-04', roles: {}, fixedTaskIds: [] } });
    const [massing, pack] = tasksOf(t, project.id);
    expect(massing.schedule).toBe('static');
    expect(massing.prerequisiteIds).toBeUndefined();
    expect(pack).toMatchObject({ schedule: 'dynamic', durationDays: 5, startDate: '2026-10-18', dueDate: '2026-10-22', prerequisiteIds: [massing.id] });
    const stages = stagesOf(t, project.id);
    expect(stages[2].prerequisiteIds).toEqual([stages[0].id]);
    expect(stages[1].prerequisiteIds).toBeUndefined();
  });

  it('keeps the due date of a dynamic task from its start and its length, also when the plan stretches the task', async () => {
    const t = world();
    const linked = { ...TEMPLATE, tasks: [TEMPLATE.tasks[0], { ...TEMPLATE.tasks[1], flexible: true, prerequisiteIds: ['t1'] }] };
    const { id } = await t.api.call('projectTemplates.save', linked);
    const { project } = await t.api.call('projects.create', { name: 'Villa Noor', template: { templateId: id, startDate: '2026-10-04', endDate: '2026-10-08', roles: {}, fixedTaskIds: [] } });
    const pack = tasksOf(t, project.id)[1];
    expect(pack.schedule).toBe('dynamic');
    expect(dueFromDuration(pack.startDate!, pack.durationDays!)).toBe(pack.dueDate);
  });
});
