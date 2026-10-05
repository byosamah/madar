import { describe, expect, it } from 'vitest';
import { lockedIds, planProject, targetDays, type PlanTemplate } from './projectPlan';

// 2026-10-04 is a Sunday. The office week is Sunday to Thursday.
const TEMPLATE: PlanTemplate = {
  stages: [
    { id: 's1', startOffset: null, durationDays: null },
    { id: 's2', startOffset: null, durationDays: null },
    // A stage with no tasks and its own numbers.
    { id: 's3', startOffset: 30, durationDays: 10 },
    // A stage with no tasks and no numbers gets no dates.
    { id: 's4', startOffset: null, durationDays: null },
  ],
  tasks: [
    { id: 't1', stageId: 's1', startOffset: 0, durationDays: 10, flexible: true },
    { id: 't2', stageId: 's1', startOffset: 5, durationDays: 10, flexible: true },
    { id: 't3', stageId: 's2', startOffset: 15, durationDays: 15, flexible: false },
  ],
};

describe('targetDays', () => {
  it('counts the working days from the first working day of the start to the end, both in', () => {
    expect(targetDays('2026-10-04', '2026-10-08')).toBe(5);
    // A Friday start counts from the next Sunday.
    expect(targetDays('2026-10-09', '2026-10-15')).toBe(5);
  });
  it('is 0 when the end comes before the start', () => {
    expect(targetDays('2026-10-08', '2026-10-04')).toBe(0);
  });
});

describe('lockedIds', () => {
  it('gives the tasks that the template does not let stretch', () => {
    expect(lockedIds(TEMPLATE)).toEqual(['t3']);
  });
});

describe('planProject', () => {
  it('keeps the template length when no end date is given', () => {
    const plan = planProject(TEMPLATE, { startDate: '2026-10-04', fixedIds: lockedIds(TEMPLATE) });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.templateDays).toBe(40);
    expect(plan.days).toBe(40);
    expect(plan.tasks.t1).toEqual({ startDate: '2026-10-04', dueDate: '2026-10-15' });
    expect(plan.tasks.t2).toEqual({ startDate: '2026-10-11', dueDate: '2026-10-22' });
    expect(plan.tasks.t3).toEqual({ startDate: '2026-10-25', dueDate: '2026-11-12' });
    // A stage with tasks spans its tasks. A stage with numbers has its own dates. A stage with neither has none.
    expect(plan.stages.s1).toEqual({ startDate: '2026-10-04', endDate: '2026-10-22' });
    expect(plan.stages.s2).toEqual({ startDate: '2026-10-25', endDate: '2026-11-12' });
    expect(plan.stages.s3).toEqual({ startDate: '2026-11-15', endDate: '2026-11-26' });
    expect(plan.stages.s4).toBeNull();
    expect(plan.endDate).toBe('2026-11-26');
  });

  it('gives the template length also for an end date on the last day of the template', () => {
    const plan = planProject(TEMPLATE, { startDate: '2026-10-04', endDate: '2026-11-26', fixedIds: [] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.days).toBe(40);
    expect(plan.tasks.t3).toEqual({ startDate: '2026-10-25', dueDate: '2026-11-12' });
  });

  it('shrinks the free items to the end date and keeps the length of a locked task', () => {
    // 20 working days: Sunday 2026-10-04 to Thursday 2026-10-29.
    const plan = planProject(TEMPLATE, { startDate: '2026-10-04', endDate: '2026-10-29', fixedIds: ['t3'] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.days).toBe(20);
    expect(plan.endDate).toBe('2026-10-29');
    const t3 = plan.tasks.t3;
    // 15 working days, both ends in.
    expect(targetDays(t3.startDate, t3.dueDate)).toBe(15);
    // The order holds: t3 starts after t1 starts.
    expect(t3.startDate >= plan.tasks.t1.startDate).toBe(true);
  });

  it('stretches every item when all can stretch', () => {
    const plan = planProject(TEMPLATE, { startDate: '2026-10-04', endDate: '2027-01-21', fixedIds: [] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.days).toBe(80);
    expect(targetDays(plan.tasks.t1.startDate, plan.tasks.t1.dueDate)).toBe(20);
  });

  it('refuses an end date that the locked tasks do not fit, and says how many days they need', () => {
    const plan = planProject(TEMPLATE, { startDate: '2026-10-04', endDate: '2026-10-15', fixedIds: ['t3'] });
    expect(plan).toEqual({ ok: false, templateDays: 40, targetDays: 10, needs: 15 });
  });

  it('refuses an end date before the start', () => {
    const plan = planProject(TEMPLATE, { startDate: '2026-10-04', endDate: '2026-10-01', fixedIds: [] });
    expect(plan).toMatchObject({ ok: false, needs: 1, targetDays: 0 });
  });

  it('counts day 0 from the first working day on or after the start', () => {
    const plan = planProject(TEMPLATE, { startDate: '2026-10-09', fixedIds: [] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.tasks.t1.startDate).toBe('2026-10-11');
  });

  it('gives no dates for a template with only stages and no numbers', () => {
    const plan = planProject({ stages: [{ id: 's1', startOffset: null, durationDays: null }], tasks: [] }, { startDate: '2026-10-04', fixedIds: [] });
    expect(plan).toEqual({ ok: true, templateDays: 0, days: 0, endDate: null, tasks: {}, stages: { s1: null } });
  });

  it('lets a stage with no tasks stay locked by its id', () => {
    const plan = planProject(TEMPLATE, { startDate: '2026-10-04', endDate: '2026-10-29', fixedIds: ['s3'] });
    if (!plan.ok) throw new Error('expected ok');
    expect(targetDays(plan.stages.s3!.startDate, plan.stages.s3!.endDate)).toBe(10);
  });
});
