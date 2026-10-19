import { describe, expect, it } from 'vitest';
import type { ProjectTemplate } from '../../../api/contract/entities';
import {
  addRole, addStage, addTask, addWait, draftError, draftInput, draftProblem, draftOf, draftPlanTemplate, duplicateDraft, emptyDraft, moveStage, moveStageStart, removeRole,
  importStages, moveTaskToStage, removeStage, removeTask, startsBeforeStageAbove, tasksEndDay, touchTask, type TemplateDraft,
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

  it('starts the first task of a stage at the own start day of the stage (ADM-18)', () => {
    const base = addStage(draftOf(SAVED));
    const draft = addTask({ ...base, stages: base.stages.map((stage) => (stage.id === 's3' ? { ...stage, start: '3', days: '8' } : stage)) }, 's3');
    expect(draft.tasks.at(-1)).toMatchObject({ stageId: 's3', start: '3' });
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
    expect(set({ tasks: [{ ...ok.tasks[0], days: '0' }] })).toBe('projectTemplates.problem.numbers');
    expect(set({ tasks: [{ ...ok.tasks[0], start: '2.5' }] })).toBe('projectTemplates.problem.numbers');
    expect(set({ stages: [ok.stages[0], { ...ok.stages[1], days: '' }] })).toBe('projectTemplates.problem.stageDays');
  });

  it('names the part and the field of the first problem (ADM-10)', () => {
    const ok = draftOf(SAVED);
    expect(draftProblem(ok)).toBeNull();
    expect(draftProblem({ ...ok, stages: [ok.stages[0], { ...ok.stages[1], days: '' }] })).toEqual({
      key: 'projectTemplates.problem.stageDays', vars: { name: 'Permits' }, part: { kind: 'stage', id: 's2' }, field: 'days',
    });
    expect(draftProblem({ ...ok, stages: [ok.stages[0], { ...ok.stages[1], start: '' }] })).toMatchObject({
      key: 'projectTemplates.problem.stageStart', part: { kind: 'stage', id: 's2' }, field: 'start',
    });
    expect(draftProblem({ ...ok, tasks: [ok.tasks[0], { ...ok.tasks[1], days: '0' }] })).toMatchObject({
      key: 'projectTemplates.problem.numbers', vars: { name: 'Presentation' }, part: { kind: 'task', id: 't2' }, field: 'days',
    });
    expect(draftProblem({ ...ok, tasks: [{ ...ok.tasks[0], title: ' ' }, ok.tasks[1]] })).toMatchObject({ part: { kind: 'task', id: 't1' }, field: 'title' });
    expect(draftProblem({ ...ok, name: '' })).toMatchObject({ part: null, field: 'name' });
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

describe('startsBeforeStageAbove', () => {
  it('is false for the first stage and for a stage that starts after the stage above it', () => {
    const draft = draftOf(SAVED);
    expect(startsBeforeStageAbove(draft, 0)).toBe(false);
    // Permits starts on day 20, after Concept, which starts on day 0.
    expect(startsBeforeStageAbove(draft, 1)).toBe(false);
  });

  it('is true when a stage that starts earlier comes after a stage that starts later', () => {
    expect(startsBeforeStageAbove(moveStage(draftOf(SAVED), 's1', 1), 1)).toBe(true);
  });

  it('is false when the stage has no days and no task to compare', () => {
    const draft = draftOf(SAVED);
    const withoutConcept = { ...draft, tasks: draft.tasks.filter((task) => task.stageId !== 's1') };
    expect(startsBeforeStageAbove(moveStage(withoutConcept, 's1', 1), 1)).toBe(false);
  });
});

describe('the waits of a template part', () => {
  const LINKED: ProjectTemplate = {
    ...SAVED,
    stages: [SAVED.stages[0], { ...SAVED.stages[1], prerequisiteIds: ['s1'] }],
    tasks: [SAVED.tasks[0], { ...SAVED.tasks[1], prerequisiteIds: ['t1'] }],
  };

  it('keeps the waits of a saved task and stage in the draft and in the input', () => {
    const draft = draftOf(LINKED);
    expect(draft.tasks[1].prerequisiteIds).toEqual(['t1']);
    expect(draft.stages[1].prerequisiteIds).toEqual(['s1']);
    const input = draftInput(draft);
    expect(input.tasks[1]).toMatchObject({ prerequisiteIds: ['t1'] });
    expect(input.stages[1]).toMatchObject({ prerequisiteIds: ['s1'] });
  });

  it('leaves the key out of a part that waits for nothing', () => {
    const input = draftInput(draftOf(LINKED));
    expect(input.tasks[0]).not.toHaveProperty('prerequisiteIds');
    expect(input.stages[0]).not.toHaveProperty('prerequisiteIds');
  });

  it('drops a wait on a part that the draft no longer has', () => {
    const draft = draftOf(LINKED);
    expect(draft.tasks[1].prerequisiteIds).toEqual(['t1']);
    expect(draft.stages[1].prerequisiteIds).toEqual(['s1']);
    const withoutMassing = { ...draft, tasks: draft.tasks.filter((task) => task.id !== 't1') };
    expect(draftInput(withoutMassing).tasks[0]).not.toHaveProperty('prerequisiteIds');
    const withoutConcept = { ...draft, stages: draft.stages.filter((stage) => stage.id !== 's1'), tasks: [] };
    expect(draftInput(withoutConcept).stages[0]).not.toHaveProperty('prerequisiteIds');
  });
});

describe('duplicateDraft', () => {
  const copyWord = (name: string) => `Copy of ${name}`;

  it('makes a draft with no id, a copy name, and the same parts as the template', () => {
    const copy = duplicateDraft(SAVED, ['Villa'], new Set(['usr_002']), copyWord);
    expect(copy).not.toHaveProperty('id');
    expect(copy.name).toBe('Copy of Villa');
    expect(draftInput(copy)).toEqual({ ...draftInput(draftOf(SAVED)), name: 'Copy of Villa' });
    expect(draftError(copy)).toBeNull();
  });

  it('adds " 2", then " 3", to the copy name while that name is in use, without case', () => {
    expect(duplicateDraft(SAVED, ['Copy of Villa'], new Set(), copyWord).name).toBe('Copy of Villa 2');
    expect(duplicateDraft(SAVED, ['copy of villa', 'Copy of Villa 2'], new Set(), copyWord).name).toBe('Copy of Villa 3');
  });

  it('keeps the copy name within the 60 characters of a template name', () => {
    const long = { ...SAVED, name: 'x'.repeat(60) };
    expect(duplicateDraft(long, [], new Set(), copyWord).name).toBe(`Copy of ${'x'.repeat(52)}`);
    expect(duplicateDraft(long, [`Copy of ${'x'.repeat(52)}`], new Set(), copyWord).name).toBe(`Copy of ${'x'.repeat(50)} 2`);
  });

  it('empties the default person who is not active, so the save never refuses it', () => {
    const copy = duplicateDraft(SAVED, [], new Set<string>(), copyWord);
    expect(copy.roles[0].defaultUserId).toBe('');
    expect(draftInput(copy).roles[0].defaultUserId).toBeNull();
    expect(draftError(copy)).toBeNull();
  });
});

describe('the waits on a removed part', () => {
  it('takes the removed task out of the waits of the other tasks, so a new task does not inherit them', () => {
    const draft = draftOf(SAVED);
    const waiting = { ...draft, tasks: [{ ...draft.tasks[0], prerequisiteIds: ['t2'] }, draft.tasks[1]] };
    const cut = removeTask(waiting, 't2');
    expect(cut.tasks).toHaveLength(1);
    expect(cut.tasks[0]).not.toHaveProperty('prerequisiteIds');
    // The next free id is t3. The id t2 is not given again, so the new task does not get the old wait.
    const next = addTask(cut, 's1');
    expect(next.tasks.at(-1)?.id).toBe('t3');
    expect(next.tasks[0]).not.toHaveProperty('prerequisiteIds');
    expect(draftInput(next).tasks[0]).not.toHaveProperty('prerequisiteIds');
  });

  it('keeps the other waits of a task when only one of them is removed', () => {
    const draft = addTask(draftOf(SAVED), 's1');
    const waiting = { ...draft, tasks: draft.tasks.map((task) => (task.id === 't1' ? { ...task, prerequisiteIds: ['t2', 't3'] } : task)) };
    expect(removeTask(waiting, 't2').tasks[0].prerequisiteIds).toEqual(['t3']);
  });

  it('takes the removed stage out of the waits of the other stages, so a new stage does not inherit them', () => {
    const draft = draftOf(SAVED);
    const waiting = { ...draft, stages: [{ ...draft.stages[0], prerequisiteIds: ['s2'] }, draft.stages[1]] };
    const next = addStage(removeStage(waiting, 's2'));
    expect(next.stages.at(-1)?.id).toBe('s3');
    expect(next.stages[0]).not.toHaveProperty('prerequisiteIds');
    expect(draftInput(next).stages[0]).not.toHaveProperty('prerequisiteIds');
  });

  it('clears the waits of the other tasks on the tasks of a removed stage', () => {
    const draft = addTask(draftOf(SAVED), 's2');
    const waiting = { ...draft, tasks: draft.tasks.map((task) => (task.id === 't3' ? { ...task, prerequisiteIds: ['t1'] } : task)) };
    const cut = removeStage(waiting, 's1');
    expect(cut.tasks.map((task) => task.id)).toEqual(['t3']);
    expect(cut.tasks[0]).not.toHaveProperty('prerequisiteIds');
  });
});

/** Another template: two stages that wait in turn, and tasks that wait for each other. The role name differs in case. */
const OTHER: ProjectTemplate = {
  id: 'ptp_004', name: 'Tower', createdBy: 'usr_001', createdAt: '2026-09-21T09:00:00.000+03:00', updatedAt: '2026-09-21T09:00:00.000+03:00',
  roles: [{ id: 'r1', name: 'architect', defaultUserId: 'usr_003' }, { id: 'r2', name: 'Engineer', defaultUserId: null }],
  stages: [
    { id: 's1', name: 'Concept', startOffset: 0, durationDays: 10 },
    { id: 's2', name: 'Design', startOffset: null, durationDays: null, prerequisiteIds: ['s1'] },
    { id: 's3', name: 'Permits', startOffset: 30, durationDays: 5, prerequisiteIds: ['s2'] },
  ],
  tasks: [
    { id: 't1', stageId: 's1', title: 'Massing', description: '', checklist: [], needsReview: false, roleId: 'r1', startOffset: 0, durationDays: 5, flexible: true },
    { id: 't2', stageId: 's2', title: 'Plans', description: '', checklist: ['Ground floor'], needsReview: true, roleId: 'r2', startOffset: 5, durationDays: 5, flexible: false, prerequisiteIds: ['t1'] },
    { id: 't3', stageId: 's3', title: 'Submit', description: '', checklist: [], needsReview: true, roleId: null, startOffset: 30, durationDays: 2, flexible: false, prerequisiteIds: ['t2'] },
  ],
};

describe('importStages', () => {
  it('copies two stages with their tasks under new ids, and keeps their links', () => {
    const draft = importStages(draftOf(SAVED), OTHER, ['s1', 's2'], true);
    // "Concept" is in use, so the copy gets " 2". Design keeps its name and its wait on the copy of Concept.
    expect(draft.stages.slice(2)).toEqual([
      { id: 's3', name: 'Concept 2', start: '30', days: '10' },
      { id: 's4', name: 'Design', start: '', days: '', prerequisiteIds: ['s3'] },
    ]);
    // Architect matches the role Architect of the draft by name. Engineer is new, so it gets the next free role id.
    expect(draft.tasks.slice(2)).toEqual([
      { id: 't3', stageId: 's3', title: 'Massing', roleId: 'r1', start: '30', days: '5', flexible: true, description: '', checklist: [], needsReview: false },
      { id: 't4', stageId: 's4', title: 'Plans', roleId: 'r3', start: '35', days: '5', flexible: false, description: '', checklist: ['Ground floor'], needsReview: true, prerequisiteIds: ['t3'] },
    ]);
    expect(draft.roles).toEqual([...draftOf(SAVED).roles, { id: 'r3', name: 'Engineer', defaultUserId: '' }]);
    expect(draftError(draft)).toBeNull();
  });

  it('copies only the stages when the tasks stay behind', () => {
    const before = draftOf(SAVED);
    const draft = importStages(before, OTHER, ['s1', 's2'], false);
    expect(draft.tasks).toEqual(before.tasks);
    expect(draft.roles).toEqual(before.roles);
    expect(draft.stages.slice(2)).toEqual([
      { id: 's3', name: 'Concept 2', start: '30', days: '10' },
      { id: 's4', name: 'Design', start: '', days: '', prerequisiteIds: ['s3'] },
    ]);
  });

  it('puts the copies right after the last stage, with the gaps between them kept (ADM-17)', () => {
    const draft = importStages(draftOf(SAVED), OTHER, ['s1', 's2'], true);
    // SAVED ends on day 30. The first copied day, 0, becomes 30, so Massing starts on 30 and Plans on 35.
    expect(draft.tasks.slice(2).map((task) => task.start)).toEqual(['30', '35']);
  });

  it('keeps the days of the other template when asked (ADM-17)', () => {
    const draft = importStages(draftOf(SAVED), OTHER, ['s1', 's2'], true, true);
    expect(draft.stages[2]).toMatchObject({ start: '0' });
    expect(draft.tasks.slice(2).map((task) => task.start)).toEqual(['0', '5']);
  });

  it('drops a link to a stage or a task that was not copied', () => {
    const draft = importStages(draftOf(SAVED), OTHER, ['s2'], true);
    // Design waits for Concept, and Plans waits for Massing. Neither was copied, so both waits go.
    expect(draft.stages.at(-1)).toEqual({ id: 's3', name: 'Design', start: '', days: '' });
    expect(draft.stages.at(-1)).not.toHaveProperty('prerequisiteIds');
    expect(draft.tasks.at(-1)).toMatchObject({ id: 't3', stageId: 's3', title: 'Plans' });
    expect(draft.tasks.at(-1)).not.toHaveProperty('prerequisiteIds');
    expect(draftError(draft)).toBeNull();
  });

  it('gives a name in use the next number when " 2" is in use too', () => {
    const before = draftOf(SAVED);
    const crowded = { ...before, stages: [...before.stages, { id: 's3', name: 'Concept 2', start: '', days: '' }] };
    expect(importStages(crowded, OTHER, ['s1'], false).stages.at(-1)).toEqual({ id: 's4', name: 'Concept 3', start: '30', days: '10' });
  });

  it('keeps the order of the source template, whatever the order of the ticks', () => {
    const draft = importStages(draftOf(SAVED), OTHER, ['s2', 's1'], false);
    expect(draft.stages.slice(2).map((stage) => stage.name)).toEqual(['Concept 2', 'Design']);
  });
});

describe('part ids are never given twice (partSeq)', () => {
  // SAVED has t1 and t2. This template had a third task, and the highest part number it ever gave is 3.
  const GAVE_THREE: ProjectTemplate = {
    ...SAVED,
    tasks: [...SAVED.tasks, { id: 't3', stageId: 's2', title: 'Site visit', description: '', checklist: [], needsReview: false, roleId: null, startOffset: 20, durationDays: 2, flexible: false }],
    partSeq: 3,
  };

  it('keeps the highest part number of the template in the draft', () => {
    expect(draftOf(GAVE_THREE).partSeq).toBe(3);
    expect(draftOf(SAVED).partSeq).toBe(2);
  });

  it('gives the next task a new number after the highest task is removed, so the removed number is not given again', () => {
    const draft = removeTask(draftOf(GAVE_THREE), 't3');
    expect(addTask(draft, 's1').tasks.at(-1)?.id).toBe('t4');
  });

  it('gives a copied stage and its copied tasks numbers above the highest part number', () => {
    const draft = importStages(removeTask(draftOf(GAVE_THREE), 't3'), SAVED, ['s1'], true);
    expect(draft.stages.at(-1)?.id).toBe('s4');
    expect(draft.tasks.slice(-2).map((task) => task.id)).toEqual(['t4', 't5']);
  });

  it('gives a new task a number above t2 when the template was saved before partSeq existed', () => {
    // SAVED has no partSeq. Its highest part number is 2, so the removed t2 is not given again.
    const draft = removeTask(draftOf(SAVED), 't2');
    expect(addTask(draft, 's1').tasks.at(-1)?.id).toBe('t3');
  });

  it('gives an imported stage and task numbers above 2 when the template was saved before partSeq existed', () => {
    // Stage s2 and task t2 are removed. The copies must not reuse s2 or t2.
    const draft = importStages(removeTask(removeStage(draftOf(SAVED), 's2'), 't2'), OTHER, ['s1'], true);
    expect(draft.stages.at(-1)?.id).toBe('s3');
    expect(draft.tasks.at(-1)?.id).toBe('t3');
  });
});

describe('addWait: a link that points back moves the waiting part (ADM-08)', () => {
  const two = (): TemplateDraft => ({
    name: 'Two', roles: [], stages: [{ id: 's1', name: 'Concept', start: '', days: '' }],
    tasks: [
      { id: 't1', stageId: 's1', title: 'Concept presentation', roleId: '', start: '10', days: '1', flexible: true, description: '', checklist: [], needsReview: false },
      { id: 't2', stageId: 's1', title: 'Massing options', roleId: '', start: '10', days: '5', flexible: true, description: '', checklist: [], needsReview: false },
      { id: 't3', stageId: 's1', title: 'Review', roleId: '', start: '11', days: '2', flexible: true, description: '', checklist: [], needsReview: false, prerequisiteIds: ['t1'] },
    ],
  });

  it('moves the waiting task to the day after the needed task ends, and says which task moved', () => {
    const { draft, moved } = addWait(two(), 'task', 't1', 't2');
    expect(draft.tasks.find((task) => task.id === 't1')).toMatchObject({ start: '15', prerequisiteIds: ['t2'] });
    expect(moved[0]).toEqual({ kind: 'task', id: 't1', name: 'Concept presentation', start: 15 });
  });

  it('moves the tasks that wait for the moved task, one after the other', () => {
    const { draft, moved } = addWait(two(), 'task', 't1', 't2');
    // Review waits for the presentation, which now ends on day 16, so Review starts on day 16.
    expect(draft.tasks.find((task) => task.id === 't3')).toMatchObject({ start: '16' });
    expect(moved.map((part) => part.id)).toEqual(['t1', 't3']);
  });

  it('moves nothing when the waiting task starts late enough already', () => {
    const late = two();
    const { draft, moved } = addWait({ ...late, tasks: late.tasks.map((task) => (task.id === 't3' ? { ...task, start: '20' } : task)) }, 'task', 't3', 't2');
    expect(moved).toEqual([]);
    expect(draft.tasks.find((task) => task.id === 't3')).toMatchObject({ start: '20', prerequisiteIds: ['t1', 't2'] });
  });

  it('moves the tasks of a stage with the stage', () => {
    const base = two();
    const draft: TemplateDraft = {
      ...base,
      stages: [...base.stages, { id: 's2', name: 'Permits', start: '2', days: '4' }],
      tasks: [...base.tasks, { id: 't4', stageId: 's2', title: 'Submit', roleId: '', start: '3', days: '2', flexible: true, description: '', checklist: [], needsReview: false }],
    };
    const result = addWait(draft, 'stage', 's2', 's1');
    // Concept ends on day 16 (Review runs 11 to 13 and Massing 10 to 15, so the span ends on 15). Permits starts on 15: a shift of 13.
    const permits = result.draft.stages.find((stage) => stage.id === 's2')!;
    expect(permits.prerequisiteIds).toEqual(['s1']);
    expect(Number(permits.start)).toBeGreaterThanOrEqual(15);
    expect(Number(result.draft.tasks.find((task) => task.id === 't4')!.start)).toBe(Number(permits.start) + 1);
    expect(result.moved[0]).toMatchObject({ kind: 'stage', id: 's2' });
  });

  it('gives the draft back when the wait exists or a part is missing', () => {
    const draft = two();
    expect(addWait(draft, 'task', 't3', 't1')).toEqual({ draft, moved: [] });
    expect(addWait(draft, 'task', 't1', 'tX')).toEqual({ draft, moved: [] });
  });
});

describe('moveTaskToStage: a task goes to another stage (fbk_031)', () => {
  // s1 Concept: t1 (day 0, 10 days), t2 (day 10, 2 days). s2 Permits: own days 20 to 30, t3 (day 20, 10 days).
  const base = (): TemplateDraft => {
    const draft = draftOf(SAVED);
    return { ...draft, tasks: [...draft.tasks, { ...draft.tasks[0], id: 't3', stageId: 's2', title: 'Balady pack', start: '20', days: '10' }], partSeq: 3 };
  };

  it('changes only the stage of a saved task: its days stay where they are', () => {
    const moved = moveTaskToStage(base(), 't1', 's2');
    expect(moved.tasks.find((task) => task.id === 't1')).toMatchObject({ stageId: 's2', start: '0', days: '10' });
    // Nothing else changed: the other tasks, the stages and the waits are the same.
    expect(moved.tasks.find((task) => task.id === 't2')).toEqual(base().tasks[1]);
    expect(moved.stages).toEqual(base().stages);
  });

  it('keeps the list grouped by stage: the task goes after the last task of its new stage', () => {
    const moved = moveTaskToStage(base(), 't1', 's2');
    expect(moved.tasks.map((task) => task.id)).toEqual(['t2', 't3', 't1']);
    // A stage with no task yet takes the task at the end of the list.
    const lonely = moveTaskToStage(addStage(base()), 't2', 's4');
    expect(lonely.tasks.map((task) => task.id)).toEqual(['t1', 't3', 't2']);
    expect(lonely.tasks.at(-1)?.stageId).toBe('s4');
  });

  it('gives the draft back for the same stage, a stage that is not there, and a task that is not there', () => {
    const draft = base();
    expect(moveTaskToStage(draft, 't1', 's1')).toBe(draft);
    expect(moveTaskToStage(draft, 't1', 's9')).toBe(draft);
    expect(moveTaskToStage(draft, 't9', 's2')).toBe(draft);
  });

  it('puts a task that was just added, and not touched, where Add task would put it in the new stage', () => {
    // The person adds a task to Concept (it starts at day 12, where t2 ends), then picks Permits for it: it starts after t3, at day 30.
    const added = addTask(base(), 's1');
    const fresh = added.tasks.find((task) => task.id === 't4')!;
    expect(fresh).toMatchObject({ stageId: 's1', start: '12', days: '5' });
    const moved = moveTaskToStage(added, 't4', 's2');
    expect(moved.tasks.find((task) => task.id === 't4')).toMatchObject({ stageId: 's2', start: '30', days: '5' });
    // Into an empty stage with its own start day: the task starts at that day.
    const stage = addStage(added);
    const own = { ...stage, stages: stage.stages.map((part) => (part.id === 's4' ? { ...part, start: '40', days: '8' } : part)) };
    expect(moveTaskToStage(own, 't4', 's4').tasks.find((task) => task.id === 't4')).toMatchObject({ stageId: 's4', start: '40' });
  });

  it('keeps the days of a new task that the person already set (touchTask): the days are the choice of the person', () => {
    const added = addTask(base(), 's1');
    const touched = { ...added, tasks: added.tasks.map((task) => (task.id === 't4' ? touchTask({ ...task, start: '15' }) : task)) };
    expect(touched.tasks.find((task) => task.id === 't4')).not.toHaveProperty('fresh');
    expect(moveTaskToStage(touched, 't4', 's2').tasks.find((task) => task.id === 't4')).toMatchObject({ stageId: 's2', start: '15' });
  });

  it('keeps the days of a new task that waits for another task: the wait set its place', () => {
    const added = addWait(addTask(base(), 's1'), 'task', 't4', 't3').draft;
    const waiting = added.tasks.find((task) => task.id === 't4')!;
    expect(waiting.start).toBe('30');
    expect(moveTaskToStage(added, 't4', 's2').tasks.find((task) => task.id === 't4')).toMatchObject({ stageId: 's2', start: '30' });
  });

  it('writes nothing about a new task into the saved parts, and a saved task is never new', () => {
    const added = addTask(base(), 's1');
    expect(added.tasks.find((task) => task.id === 't4')).toMatchObject({ fresh: true });
    expect(draftInput(added).tasks.find((task) => task.id === 't4')).not.toHaveProperty('fresh');
    expect(draftOf(SAVED).tasks.some((task) => 'fresh' in task)).toBe(false);
    expect(draftOf(SAVED).tasks).toEqual(draftOf(SAVED).tasks.map((task) => ({ ...task })));
  });

  it('shows the note that the tasks of the new stage end after its own days, when the move makes them so', () => {
    // Permits has own days 20 to 30. Moving t1 (day 0, 10 days) there keeps day 0 to 10: it ends before the stage, so the span starts early.
    const moved = moveTaskToStage(base(), 't2', 's2');
    expect(tasksEndDay(moved, 's2')).toBeNull();
    const late = moveTaskToStage({ ...base(), tasks: base().tasks.map((task) => (task.id === 't1' ? { ...task, start: '28', days: '9' } : task)) }, 't1', 's2');
    expect(tasksEndDay(late, 's2')).toBe(36);
  });

  it('keeps a task that waits for others, and the tasks that wait for it, linked after the move', () => {
    const linked = addWait(base(), 'task', 't3', 't1').draft;
    const moved = moveTaskToStage(linked, 't1', 's2');
    expect(moved.tasks.find((task) => task.id === 't3')?.prerequisiteIds).toEqual(['t1']);
    expect(moved.tasks.find((task) => task.id === 't1')).toMatchObject({ stageId: 's2' });
  });

  it('is accepted by the save: the input holds the task under its new stage', () => {
    const moved = moveTaskToStage(base(), 't1', 's2');
    expect(draftError(moved)).toBeNull();
    expect(draftInput(moved).tasks.find((task) => task.id === 't1')).toMatchObject({ stageId: 's2', startOffset: 0, durationDays: 10 });
  });
});
