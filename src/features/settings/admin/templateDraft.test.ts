import { describe, expect, it } from 'vitest';
import type { ProjectTemplate } from '../../../api/contract/entities';
import {
  addRole, addStage, addTask, draftError, draftInput, draftOf, draftPlanTemplate, emptyDraft, moveStage, moveStageStart, removeRole, removeStage,
  tasksEndDay, type TemplateDraft,
} from './templateDraft';

const SAVED: ProjectTemplate = {
  id: 'ptp_003', name: 'Villa', createdBy: 'usr_001', createdAt: '2026-09-20T09:00:00.000+03:00', updatedAt: '2026-09-20T09:00:00.000+03:00',
  roles: [{ id: 'r1', name: 'Architect', defaultUserId: 'usr_002' }, { id: 'r2', name: 'Permits', defaultUserId: null }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: null, durationDays: null },
    { id: 's2', name: 'Permits', startOffset: 20, durationDays: 10 },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing', description: 'Three options.', checklist: ['Model'], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's1', title: 'Presentation', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 10, durationDays: 2, flexible: false },
  ],
};

describe('the template draft', () => {
  it('starts with one empty stage and no roles or tasks', () => {
    expect(emptyDraft()).toEqual({ name: '', roles: [], stages: [{ id: 's1', name: '', start: '', days: '' }], tasks: [] });
  });

  it('turns a saved template into a draft and back into the same parts', () => {
    const draft = draftOf(SAVED);
    expect(draft.stages[1]).toEqual({ id: 's2', name: 'Permits', start: '20', days: '10' });
    expect(draft.tasks[1]).toMatchObject({ roleId: '', start: '10', days: '2', flexible: false });
    const { name, roles, stages, tasks } = SAVED;
    expect(draftInput(draft)).toEqual({ name, roles, stages, tasks });
  });

  it('gives each new part the next free id of its kind', () => {
    let draft = draftOf(SAVED);
    draft = addRole(draft);
    draft = addStage(draft);
    draft = addTask(draft, 's1');
    expect(draft.roles.at(-1)).toEqual({ id: 'r3', name: '', defaultUserId: '' });
    expect(draft.stages.at(-1)).toEqual({ id: 's3', name: '', start: '', days: '' });
    // A new task starts where the last task of its stage ends, for 5 days, and can stretch.
    expect(draft.tasks.at(-1)).toMatchObject({ id: 't3', stageId: 's1', title: '', roleId: '', start: '12', days: '5', flexible: true, needsReview: true });
  });

  it('starts the first task of an empty stage where the template ends', () => {
    const draft = addTask(addStage(draftOf(SAVED)), 's3');
    expect(draft.tasks.at(-1)).toMatchObject({ stageId: 's3', start: '30' });
  });

  it('removes a stage with its tasks, and a role from its tasks', () => {
    const draft = draftOf(SAVED);
    expect(removeStage(draft, 's1').tasks).toEqual([]);
    expect(removeRole(draft, 'r1').tasks.map((task) => task.roleId)).toEqual(['', '']);
  });

  it('moves a stage up or down, and not past the ends', () => {
    const draft = draftOf(SAVED);
    expect(moveStage(draft, 's2', -1).stages.map((stage) => stage.id)).toEqual(['s2', 's1']);
    expect(moveStage(draft, 's2', 1).stages.map((stage) => stage.id)).toEqual(['s1', 's2']);
  });

  it('names the first problem of a draft with a word key', () => {
    const ok = draftOf(SAVED);
    expect(draftError(ok)).toBeNull();
    const set = (change: Partial<TemplateDraft>) => draftError({ ...ok, ...change });
    expect(set({ name: '  ' })).toBe('projectTemplates.errors.name');
    expect(set({ stages: [], tasks: [] })).toBe('projectTemplates.errors.noStage');
    expect(set({ stages: [{ ...ok.stages[0], name: '' }, ok.stages[1]] })).toBe('projectTemplates.errors.stageName');
    expect(set({ stages: [ok.stages[0], { ...ok.stages[1], name: ' concept ' }] })).toBe('projectTemplates.errors.stageTwice');
    expect(set({ roles: [{ ...ok.roles[0], name: '' }, ok.roles[1]] })).toBe('projectTemplates.errors.roleName');
    expect(set({ roles: [ok.roles[0], { ...ok.roles[1], name: 'architect' }] })).toBe('projectTemplates.errors.roleTwice');
    expect(set({ tasks: [{ ...ok.tasks[0], title: ' ' }] })).toBe('projectTemplates.errors.taskTitle');
    expect(set({ tasks: [{ ...ok.tasks[0], days: '0' }] })).toBe('projectTemplates.errors.numbers');
    expect(set({ tasks: [{ ...ok.tasks[0], start: '2.5' }] })).toBe('projectTemplates.errors.numbers');
    expect(set({ stages: [ok.stages[0], { ...ok.stages[1], days: '' }] })).toBe('projectTemplates.errors.stageNumbers');
  });

  it('reads Arabic digits as numbers', () => {
    const draft = draftOf(SAVED);
    const arabic = { ...draft, tasks: [{ ...draft.tasks[0], start: '٣', days: '١٢' }] };
    expect(draftError(arabic)).toBeNull();
    expect(draftInput(arabic).tasks[0]).toMatchObject({ startOffset: 3, durationDays: 12 });
  });

  it('gives the preview only the parts with whole numbers', () => {
    const draft = draftOf(SAVED);
    const plan = draftPlanTemplate({ ...draft, tasks: [draft.tasks[0], { ...draft.tasks[1], days: '' }] });
    expect(plan.tasks.map((task) => task.id)).toEqual(['t1']);
    expect(plan.stages[1]).toEqual({ id: 's2', startOffset: 20, durationDays: 10 });
  });
});

/** SAVED, where stage 1 has its own start (day 10) and 12 working days. Its tasks start on day 2 and day 12. */
function withOwnNumbers(): TemplateDraft {
  const draft = draftOf(SAVED);
  return {
    ...draft,
    stages: draft.stages.map((stage) => (stage.id === 's1' ? { ...stage, start: '10', days: '12' } : stage)),
    tasks: draft.tasks.map((task) => ({ ...task, start: task.id === 't1' ? '2' : '12' })),
  };
}

describe('moveStageStart', () => {
  it('moves the own start and each task of the stage by the same days', () => {
    const moved = moveStageStart(withOwnNumbers(), 's1', 15);
    expect(moved.stages[0]).toEqual({ id: 's1', name: 'Concept', start: '15', days: '12' });
    expect(moved.tasks.map((task) => task.start)).toEqual(['7', '17']);
    expect(moved.stages[1]).toEqual(withOwnNumbers().stages[1]);
  });

  it('stops the tasks and the stage at day 0', () => {
    const earlier = moveStageStart(withOwnNumbers(), 's1', 4);
    expect(earlier.stages[0].start).toBe('4');
    expect(earlier.tasks.map((task) => task.start)).toEqual(['0', '6']);
    const below = moveStageStart(withOwnNumbers(), 's1', -3);
    expect(below.stages[0].start).toBe('0');
    expect(below.tasks.map((task) => task.start)).toEqual(['0', '2']);
  });

  it('moves the tasks by their earliest start when the stage has no own start', () => {
    const moved = moveStageStart(draftOf(SAVED), 's1', 3);
    expect(moved.stages[0].start).toBe('');
    expect(moved.tasks.map((task) => task.start)).toEqual(['3', '13']);
  });
});

describe('the end of the tasks of a stage', () => {
  it('gives the day the tasks end on when that is after the own days of the stage', () => {
    const draft = draftOf(SAVED);
    const short = { ...draft, stages: draft.stages.map((stage) => (stage.id === 's1' ? { ...stage, start: '0', days: '8' } : stage)) };
    // The tasks of stage 1 end on day 11: the second task starts on day 10 and lasts 2 days, so day 11 is its last day.
    expect(tasksEndDay(short, 's1')).toBe(11);
  });

  it('gives nothing when the own days cover the tasks, or when the stage has no own days', () => {
    const draft = draftOf(SAVED);
    expect(tasksEndDay(draft, 's1')).toBeNull();
    const long = { ...draft, stages: draft.stages.map((stage) => (stage.id === 's1' ? { ...stage, start: '0', days: '20' } : stage)) };
    expect(tasksEndDay(long, 's1')).toBeNull();
  });
});
