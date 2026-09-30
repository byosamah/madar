import { describe, expect, it } from 'vitest';
import { computeHealth, isOverdue } from './health';
import { makeProject, makeStage, makeTask, STAMP, TODAY } from '../test/factories';

const past = makeStage();
const current = makeStage({ id: 'stg_002', name: 'Schematic Design', order: 1, startDate: '2026-09-01', endDate: '2026-10-31' });
const withEnd = (endDate: string) => [past, { ...current, endDate }];
const base = { project: makeProject(), stages: [past, current], tasks: [] as ReturnType<typeof makeTask>[] };

describe('computeHealth (spec 4.2)', () => {
  it('is on track with no problems', () => {
    expect(computeHealth(base, TODAY)?.value).toBe('on_track');
  });

  it('is late after the current stage end date', () => {
    expect(computeHealth({ ...base, stages: withEnd('2026-09-29') }, TODAY)?.value).toBe('late');
  });

  it('is not late on the end date itself', () => {
    expect(computeHealth({ ...base, stages: withEnd(TODAY) }, TODAY)?.value).toBe('on_track');
  });

  it('is at risk with an overdue task', () => {
    const tasks = [makeTask({ dueDate: '2026-09-29', status: 'in_progress' })];
    expect(computeHealth({ ...base, tasks }, TODAY)?.value).toBe('at_risk');
  });

  it('does not count tasks in review or done as overdue', () => {
    const inReview = makeTask({ dueDate: '2026-09-29', status: 'in_review' });
    const done = makeTask({ id: 'tsk_002', dueDate: '2026-09-29', status: 'done' });
    expect(isOverdue(inReview, TODAY)).toBe(false);
    expect(isOverdue(done, TODAY)).toBe(false);
    expect(computeHealth({ ...base, tasks: [inReview, done] }, TODAY)?.value).toBe('on_track');
  });

  it('is at risk when the stage ends within 7 days and less than 70% is done', () => {
    const tasks = [
      makeTask({ id: 'tsk_001', status: 'done' }),
      makeTask({ id: 'tsk_002', status: 'done' }),
      makeTask({ id: 'tsk_003', dueDate: '2026-10-05' }),
      makeTask({ id: 'tsk_004', dueDate: '2026-10-06' }),
    ];
    expect(computeHealth({ ...base, stages: withEnd('2026-10-07'), tasks }, TODAY)?.value).toBe('at_risk');
  });

  it('stays on track at 70% or more done', () => {
    const tasks = [
      makeTask({ id: 'tsk_001', status: 'done' }),
      makeTask({ id: 'tsk_002', status: 'done' }),
      makeTask({ id: 'tsk_003', status: 'done' }),
      makeTask({ id: 'tsk_004', dueDate: '2026-10-06' }),
    ];
    expect(computeHealth({ ...base, stages: withEnd('2026-10-07'), tasks }, TODAY)?.value).toBe('on_track');
  });

  it('ignores the 70% rule 8 days before the end', () => {
    const tasks = [makeTask({ id: 'tsk_001', dueDate: '2026-10-07' }), makeTask({ id: 'tsk_002', dueDate: '2026-10-07' })];
    expect(computeHealth({ ...base, stages: withEnd('2026-10-08'), tasks }, TODAY)?.value).toBe('on_track');
  });

  it('ignores the 70% rule for a stage with no tasks', () => {
    expect(computeHealth({ ...base, stages: withEnd('2026-10-03') }, TODAY)?.value).toBe('on_track');
  });

  it('uses the override and keeps the computed value', () => {
    const project = makeProject({ healthOverride: { value: 'at_risk', reason: 'Client delay', setBy: 'usr_002', setAt: STAMP } });
    expect(computeHealth({ ...base, project }, TODAY)).toEqual({
      value: 'at_risk', computed: 'on_track', overridden: true, reason: 'Client delay', setBy: 'usr_002',
    });
  });

  it('has no health for a project that is not active', () => {
    expect(computeHealth({ ...base, project: makeProject({ status: 'on_hold' }) }, TODAY)).toBeNull();
  });
});
