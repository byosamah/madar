import { describe, expect, it } from 'vitest';
import { addWorkingDays, compareStages, compareTasks, openPrerequisites, openPrerequisiteStages, stageOverlaps, stagesChrono, shiftPlan, stageTagOf, workingDaysLate } from './stageFlow';

const stage = (id: string, order: number, startDate: string | null, endDate: string | null, prerequisiteIds?: string[]) => ({ id, order, startDate, endDate, prerequisiteIds });
const task = (id: string, stageId: string, status = 'todo', extra: Record<string, unknown> = {}) => ({ id, stageId, title: id, status, dueDate: null, ...extra });

describe('stage and task order', () => {
  it('puts stages in time order: start, end, then the order the office gave, undated last', () => {
    const list = [stage('d', 3, null, null), stage('c', 2, '2026-09-01', '2026-09-30'), stage('b', 1, '2026-09-01', '2026-09-10'), stage('a', 0, '2026-10-01', '2026-10-31')];
    expect(stagesChrono(list).map((s) => s.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(compareStages(stage('x', 5, '2026-09-01', '2026-09-10'), stage('y', 4, '2026-09-01', '2026-09-10'))).toBeGreaterThan(0);
  });

  it('puts tasks in time order: start, due, stage, title; an unset date comes last', () => {
    const rank = (id: string) => (id === 's1' ? 0 : 1);
    const a = task('a', 's2', 'todo', { startDate: '2026-10-01', dueDate: '2026-10-05', title: 'Zeta' });
    const b = task('b', 's1', 'todo', { startDate: '2026-10-01', dueDate: '2026-10-05', title: 'Alpha' });
    const c = task('c', 's1', 'todo', { startDate: null, dueDate: '2026-09-01' });
    const d = task('d', 's1', 'todo', { startDate: '2026-10-01', dueDate: null });
    expect([a, b, c, d].sort((x, y) => compareTasks(x, y, rank)).map((t) => t.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('the stage tag', () => {
  const stages = [stage('s1', 0, '2026-08-01', '2026-08-31'), stage('s2', 1, '2026-09-01', '2026-09-30'), stage('s3', 2, '2026-10-01', '2026-10-31')];
  it('is the earliest stage with an open task', () => {
    expect(stageTagOf(stages, [task('a', 's1', 'done'), task('b', 's2', 'in_review'), task('c', 's3')]).id).toBe('s2');
  });
  it('is the last stage with any task when none is open, and the first stage with no task', () => {
    expect(stageTagOf(stages, [task('a', 's1', 'done'), task('b', 's2', 'done')]).id).toBe('s2');
    expect(stageTagOf(stages, []).id).toBe('s1');
  });
});

describe('waiting', () => {
  it('names the open prerequisites, and the prerequisite stages with an open task', () => {
    const tasks = [task('a', 's1', 'done'), task('b', 's1'), { ...task('c', 's2'), prerequisiteIds: ['a', 'b', 'gone'] }];
    expect(openPrerequisites(tasks[2], tasks).map((t) => t.id)).toEqual(['b']);
    const stages = [stage('s1', 0, null, null), stage('s2', 1, null, null, ['s1'])];
    expect(openPrerequisiteStages(tasks[2], stages, tasks).map((s) => s.id)).toEqual(['s1']);
    expect(openPrerequisiteStages(tasks[2], stages, [task('a', 's1', 'done')])).toEqual([]);
  });
});

describe('working days', () => {
  it('counts the working days after the due day, up to the finish day', () => {
    // Fri 25 Sep to Wed 30 Sep: Sun 27, Mon 28, Tue 29, Wed 30.
    expect(workingDaysLate('2026-09-25', '2026-09-30')).toBe(4);
    expect(workingDaysLate('2026-09-30', '2026-09-30')).toBe(0);
    expect(workingDaysLate('2026-09-30', '2026-09-25')).toBe(0);
    expect(workingDaysLate('2026-09-24', '2026-09-26')).toBe(0);
  });
  it('adds working days and skips Friday and Saturday', () => {
    expect(addWorkingDays('2026-10-01', 4)).toBe('2026-10-07');
    expect(addWorkingDays('2026-10-02', 1)).toBe('2026-10-05');
    expect(addWorkingDays('2026-10-01', 0)).toBe('2026-10-01');
  });
});

describe('the shift plan', () => {
  const dep = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'todo', schedule: 'dynamic', startDate: '2026-10-04', dueDate: '2026-10-08', durationDays: 4, ...extra });
  it('moves a dynamic dependent by the working days the task is late', () => {
    // Due Fri 25 Sep, finished Wed 30 Sep: 4 working days late.
    const plan = shiftPlan({ dueDate: '2026-09-25' }, [dep('a')], '2026-09-30');
    expect(plan).toEqual([{ id: 'a', lateDays: 4, taskLateDays: 4, from: { startDate: '2026-10-04', dueDate: '2026-10-08' }, to: { startDate: '2026-10-08', dueDate: '2026-10-13' } }]);
  });
  it('does not move a static, done, or undated dependent', () => {
    const list = [dep('s', { schedule: 'static' }), dep('u', { schedule: undefined }), dep('d', { status: 'done' }), dep('n', { startDate: null }), dep('z', { durationDays: null }), dep('ok')];
    expect(shiftPlan({ dueDate: '2026-09-25' }, list, '2026-09-30').map((move) => move.id)).toEqual(['ok']);
  });
  it('gives an empty list when the task finishes on or before its due day, or has no due day', () => {
    expect(shiftPlan({ dueDate: '2026-09-30' }, [dep('a')], '2026-09-30')).toEqual([]);
    expect(shiftPlan({ dueDate: '2026-09-30' }, [dep('a')], '2026-09-28')).toEqual([]);
    expect(shiftPlan({ dueDate: null }, [dep('a')], '2026-09-30')).toEqual([]);
  });
});

describe('stage overlaps', () => {
  it('finds the shared days of two stages that run at the same time', () => {
    const list = [stage('a', 0, '2026-09-01', '2026-09-30'), stage('b', 1, '2026-09-20', '2026-10-20'), stage('c', 2, '2026-10-21', '2026-11-20')];
    expect(stageOverlaps(list)).toEqual([{ start: '2026-09-20', end: '2026-09-30', stageIds: ['a', 'b'] }]);
  });
  it('does not count days that only share a weekend, or stages with no dates', () => {
    // The first stage ends on Fri 2 Oct and the next starts the same Friday: no working day is shared.
    expect(stageOverlaps([stage('a', 0, '2026-09-01', '2026-10-02'), stage('b', 1, '2026-10-02', '2026-10-31')])).toEqual([]);
    expect(stageOverlaps([stage('a', 0, null, null), stage('b', 1, '2026-10-02', '2026-10-31')])).toEqual([]);
  });
});
