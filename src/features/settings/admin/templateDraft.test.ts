import { describe, expect, it } from 'vitest';
import type { ProjectTemplate } from '../../../api/contract/entities';
import {
  addRole, addStage, addTask, draftError, draftInput, draftOf, draftPlanTemplate, emptyDraft, moveStage, removeRole, removeStage, type TemplateDraft,
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
