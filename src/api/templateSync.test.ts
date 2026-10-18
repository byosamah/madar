import { describe, expect, it } from 'vitest';
import type { Project, ProjectTemplate, Stage, Task } from './contract/entities';
import { makeProject, makeStage, makeTask, STAMP } from '../test/factories';
import { planProject } from '../lib/projectPlan';
import { syncDiff, type SyncDiff } from './templateSync';

/** Two stages and two tasks. The role r1 has the person usr_002 by default. */
const TEMPLATE: ProjectTemplate = {
  id: 'ptp_010', name: 'Villa', createdBy: 'usr_001', createdAt: STAMP, updatedAt: STAMP, partSeq: 4,
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

const START = '2026-10-04';
const PLAN = planProject(TEMPLATE, { startDate: START, fixedIds: [] });
if (!PLAN.ok) throw new Error('The test template must fit its own plan.');

/** The planned start and due day of one template task, as the plan of the new project gives them. */
const planned = (partId: string) => PLAN.tasks[partId];

const LINK: NonNullable<Project['templateLink']> = { templateId: 'ptp_010', linkedAt: STAMP, syncedAt: null, rolePeople: { r1: 'usr_002' }, droppedPartIds: [] };

/** A project linked to TEMPLATE, starting on a working day. */
function linked(overrides: Partial<Project> = {}, link: Partial<typeof LINK> = {}): Project {
  return makeProject({ startDate: START, templateLink: { ...LINK, ...link }, ...overrides });
}

/** The stages of the project: Concept (s1) and Permits (s2). */
const STAGES: Stage[] = [
  makeStage({ id: 'stg_1', name: 'Concept', order: 0, templatePartId: 's1' }),
  makeStage({ id: 'stg_2', name: 'Permits', order: 1, templatePartId: 's2' }),
];

/** The task of template part t1, led by the role person, with the planned dates. */
function taskT1(overrides: Partial<Task> = {}): Task {
  return makeTask({
    id: 'tsk_1', projectId: 'prj_001', stageId: 'stg_1', title: 'Massing study', ownerId: 'usr_002', templatePartId: 't1',
    status: 'todo', startDate: planned('t1').startDate, dueDate: planned('t1').dueDate, ...overrides,
  });
}

/** The ids of every item and part that the diff names, in all lists. */
function namedIds(diff: SyncDiff): string[] {
  const items = [...diff.removed, ...diff.text, ...diff.dates, ...diff.leads, ...diff.closed, ...diff.stages].map((item) => item.itemId);
  const parts = [...diff.add, ...diff.dropped].map((part) => part.partId);
  return [...items, ...parts];
}

describe('syncDiff: the template parts that the project lacks', () => {
  it('lists a template task that the project lacks in add', () => {
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1()]);
    expect(diff.add).toEqual([{ partId: 't2', title: 'Balady pack', stagePartId: 's2' }]);
    expect(diff.dropped).toEqual([]);
  });

  it('lists a part in droppedPartIds in dropped, never in add', () => {
    const diff = syncDiff(TEMPLATE, linked({}, { droppedPartIds: ['t2'] }), STAGES, [taskT1()]);
    expect(diff.dropped).toEqual([{ partId: 't2', title: 'Balady pack', stagePartId: 's2' }]);
    expect(diff.add).toEqual([]);
  });

  it('lists a stage that the project lacks in add, and its tasks with it', () => {
    const diff = syncDiff(TEMPLATE, linked(), [STAGES[0]], [taskT1()]);
    expect(diff.add).toEqual([
      { partId: 's2', title: 'Permits', stagePartId: null },
      { partId: 't2', title: 'Balady pack', stagePartId: 's2' },
    ]);
  });

  it('lists a dropped stage in dropped, and its tasks with it', () => {
    const diff = syncDiff(TEMPLATE, linked({}, { droppedPartIds: ['s2'] }), [STAGES[0]], [taskT1()]);
    expect(diff.dropped).toEqual([
      { partId: 's2', title: 'Permits', stagePartId: null },
      { partId: 't2', title: 'Balady pack', stagePartId: 's2' },
    ]);
    expect(diff.add).toEqual([]);
  });
});

describe('syncDiff: the project items of the template', () => {
  it('lists a project item whose part left the template in removed', () => {
    const old = makeTask({ id: 'tsk_9', projectId: 'prj_001', stageId: 'stg_1', title: 'Old step', ownerId: null, templatePartId: 't9' });
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1(), old]);
    expect(diff.removed).toEqual([{ itemId: 'tsk_9', partId: 't9', title: 'Old step' }]);
  });

  it('sends an open task with a new title to text', () => {
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1({ title: 'Massing (old)' })]);
    expect(diff.text).toEqual([{ itemId: 'tsk_1', partId: 't1', title: 'Massing (old)' }]);
    expect(diff.closed).toEqual([]);
  });

  it('sends a done task with a new title to closed only', () => {
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1({ title: 'Massing (old)', status: 'done' })]);
    expect(diff.closed).toEqual([{ itemId: 'tsk_1', partId: 't1', title: 'Massing (old)' }]);
    expect(diff.text).toEqual([]);
    expect(diff.dates).toEqual([]);
    expect(diff.leads).toEqual([]);
  });

  it('sends an in-review task with a new title to closed only', () => {
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1({ title: 'Massing (old)', status: 'in_review' })]);
    expect(diff.closed.map((item) => item.itemId)).toEqual(['tsk_1']);
    expect(diff.text).toEqual([]);
  });

  it('keeps a task that the project made itself out of every list', () => {
    const own = makeTask({ id: 'tsk_own', projectId: 'prj_001', stageId: 'stg_1', title: 'Own step', ownerId: 'usr_003', dueDate: '2030-01-01' });
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1(), own]);
    expect(namedIds(diff)).not.toContain('tsk_own');
    expect(diff.people).not.toContain('usr_003');
  });

  it('never sends a started task to dates', () => {
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1({ status: 'in_progress', dueDate: '2030-01-01' })]);
    expect(diff.dates).toEqual([]);
  });

  it('sends an open task that has not started and has another date to dates', () => {
    const diff = syncDiff(TEMPLATE, linked(), STAGES, [taskT1({ dueDate: '2030-01-01' })]);
    expect(diff.dates.map((item) => item.itemId)).toEqual(['tsk_1']);
  });

  it('moves the lead that still holds the old person of its role', () => {
    const template = { ...TEMPLATE, roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_004' }] };
    const diff = syncDiff(template, linked(), STAGES, [taskT1()]);
    expect(diff.leads.map((item) => item.itemId)).toEqual(['tsk_1']);
    expect(diff.people).toContain('usr_004');
  });

  it('keeps the lead that the team chose for its task', () => {
    const template = { ...TEMPLATE, roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_004' }] };
    const diff = syncDiff(template, linked(), STAGES, [taskT1({ ownerId: 'usr_003' })]);
    expect(diff.leads).toEqual([]);
  });

  it('gives no new lead to a person who is not active', () => {
    const template = { ...TEMPLATE, roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_004' }] };
    const diff = syncDiff(template, linked(), STAGES, [taskT1()], (id) => id !== 'usr_004');
    expect(diff.leads).toEqual([]);
  });

  it('lists each person of a touched task once in people', () => {
    const template = { ...TEMPLATE, roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_004' }] };
    const first = taskT1({ helperIds: ['usr_003'] });
    const second = makeTask({ id: 'tsk_2', projectId: 'prj_001', stageId: 'stg_2', title: 'Old pack', ownerId: 'usr_003', helperIds: ['usr_004'], templatePartId: 't2' });
    const diff = syncDiff(template, linked(), STAGES, [first, second]);
    expect([...diff.people].sort()).toEqual(['usr_002', 'usr_003', 'usr_004']);
  });
});

describe('syncDiff: a project that is not linked to the template', () => {
  it('has no diff at all', () => {
    const diff = syncDiff(TEMPLATE, makeProject({ templateLink: null }), STAGES, [taskT1({ title: 'Other' })]);
    expect(diff).toEqual({ add: [], dropped: [], removed: [], text: [], dates: [], leads: [], closed: [], stages: [], people: [] });
  });
});
