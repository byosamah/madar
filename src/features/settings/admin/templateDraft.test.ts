import { describe, expect, it } from 'vitest';
import type { ProjectTemplate } from '../../../api/contract/entities';
import {
  addRole, addStage, addTask, draftError, draftInput, draftOf, draftPlanTemplate, duplicateDraft, emptyDraft, moveStage, moveStageStart, removeRole,
  importStages, removeStage, removeTask, reorderStages, startsBeforeStageAbove, tasksEndDay, type TemplateDraft,
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

describe('reorderStages', () => {
  it('moves a stage to a new place, and the other stages keep their order', () => {
    const draft = draftOf(SAVED);
    expect(reorderStages(draft, 0, 1).stages.map((stage) => stage.id)).toEqual(['s2', 's1']);
    expect(reorderStages(draft, 1, 0).stages.map((stage) => stage.id)).toEqual(['s2', 's1']);
    const three = addStage(draft);
    expect(reorderStages(three, 0, 2).stages.map((stage) => stage.id)).toEqual(['s2', 's3', 's1']);
    expect(reorderStages(three, 2, 0).stages.map((stage) => stage.id)).toEqual(['s3', 's1', 's2']);
  });

  it('gives the draft back for the same place or for a place outside the list', () => {
    const draft = draftOf(SAVED);
    expect(reorderStages(draft, 1, 1)).toBe(draft);
    expect(reorderStages(draft, 0, 2)).toBe(draft);
    expect(reorderStages(draft, -1, 0)).toBe(draft);
  });

  it('keeps the tasks of each stage as they are', () => {
    expect(reorderStages(draftOf(SAVED), 0, 1).tasks).toEqual(draftOf(SAVED).tasks);
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
    expect(startsBeforeStageAbove(reorderStages(draftOf(SAVED), 0, 1), 1)).toBe(true);
  });

  it('is false when the stage has no days and no task to compare', () => {
    const draft = draftOf(SAVED);
    const withoutConcept = { ...draft, tasks: draft.tasks.filter((task) => task.stageId !== 's1') };
    expect(startsBeforeStageAbove(reorderStages(withoutConcept, 0, 1), 1)).toBe(false);
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
      { id: 's3', name: 'Concept 2', start: '0', days: '10' },
      { id: 's4', name: 'Design', start: '', days: '', prerequisiteIds: ['s3'] },
    ]);
    // Architect matches the role Architect of the draft by name. Engineer is new, so it gets the next free role id.
    expect(draft.tasks.slice(2)).toEqual([
      { id: 't3', stageId: 's3', title: 'Massing', roleId: 'r1', start: '0', days: '5', flexible: true, description: '', checklist: [], needsReview: false },
      { id: 't4', stageId: 's4', title: 'Plans', roleId: 'r3', start: '5', days: '5', flexible: false, description: '', checklist: ['Ground floor'], needsReview: true, prerequisiteIds: ['t3'] },
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
      { id: 's3', name: 'Concept 2', start: '0', days: '10' },
      { id: 's4', name: 'Design', start: '', days: '', prerequisiteIds: ['s3'] },
    ]);
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
    expect(importStages(crowded, OTHER, ['s1'], false).stages.at(-1)).toEqual({ id: 's4', name: 'Concept 3', start: '0', days: '10' });
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
