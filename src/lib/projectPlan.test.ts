import { describe, expect, it } from 'vitest';
import { lockedIds, planProject, shiftAdded, stageSpan, targetDays, type PlanTemplate } from './projectPlan';

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

  it('gives a stage with its own numbers and tasks a span that covers both', () => {
    // The own numbers run from day 0 to day 3. The tasks run from day 6 to day 7, and from day 8 to day 13.
    const template: PlanTemplate = {
      stages: [{ id: 's1', startOffset: 0, durationDays: 4 }],
      tasks: [
        { id: 't1', stageId: 's1', startOffset: 6, durationDays: 2, flexible: true },
        { id: 't2', stageId: 's1', startOffset: 8, durationDays: 6, flexible: true },
      ],
    };
    const plan = planProject(template, { startDate: '2026-10-04', fixedIds: [] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.days).toBe(14);
    expect(plan.stages.s1).toEqual({ startDate: '2026-10-04', endDate: '2026-10-21' });
  });

  it('runs the project as long as the own numbers of a stage when they reach past its tasks', () => {
    // The own numbers run from day 0 to day 20. The tasks end on day 14.
    const template: PlanTemplate = {
      stages: [{ id: 's1', startOffset: 0, durationDays: 20 }],
      tasks: [
        { id: 't1', stageId: 's1', startOffset: 0, durationDays: 5, flexible: true },
        { id: 't2', stageId: 's1', startOffset: 8, durationDays: 6, flexible: true },
      ],
    };
    const plan = planProject(template, { startDate: '2026-10-04', fixedIds: [] });
    if (!plan.ok) throw new Error('expected ok');
    expect(plan.days).toBe(20);
    expect(plan.endDate).toBe('2026-10-29');
    expect(plan.stages.s1).toEqual({ startDate: '2026-10-04', endDate: '2026-10-29' });
  });
});

describe('stageSpan', () => {
  it('is null for a stage with no numbers and no tasks', () => {
    expect(stageSpan({ startOffset: null, durationDays: null }, [])).toBeNull();
  });

  it('gives the own numbers of a stage with no tasks', () => {
    expect(stageSpan({ startOffset: 20, durationDays: 10 }, [])).toEqual({ start: 20, end: 30 });
  });

  it('gives the tasks of a stage with no own numbers', () => {
    const tasks = [{ startOffset: 0, durationDays: 10 }, { startOffset: 12, durationDays: 3 }];
    expect(stageSpan({ startOffset: null, durationDays: null }, tasks)).toEqual({ start: 0, end: 15 });
  });

  it('covers the own numbers and the tasks together', () => {
    const tasks = [{ startOffset: 12, durationDays: 3 }, { startOffset: 25, durationDays: 2 }];
    expect(stageSpan({ startOffset: 20, durationDays: 10 }, tasks)).toEqual({ start: 12, end: 30 });
  });
});

describe('shiftAdded (apply a template to an ongoing project)', () => {
  // The plan from Sunday 2026-10-04: t1 10-04 to 10-15, t2 10-11 to 10-22, t3 10-25 to 11-12, s3 11-15 to 11-26.
  const plan = (() => {
    const result = planProject(TEMPLATE, { startDate: '2026-10-04', fixedIds: [] });
    if (!result.ok) throw new Error('expected ok');
    return result;
  })();

  it('keeps the dates of the template when the earliest added part starts today or later', () => {
    const shifted = shiftAdded(plan, { taskIds: ['t2', 't3'], stageIds: ['s2'] }, '2026-10-11');
    expect(shifted.shiftDays).toBe(0);
    expect(shifted.tasks).toEqual({ t2: plan.tasks.t2, t3: plan.tasks.t3 });
    expect(shifted.stages).toEqual({ s2: plan.stages.s2 });
    expect(shifted.startDate).toBe('2026-10-11');
    expect(shifted.endDate).toBe('2026-11-12');
  });

  it('moves every added part forward by the same working days so the earliest one starts today', () => {
    // Today is Sunday 2026-10-18. The earliest added part, t2, starts on 10-11: 5 working days earlier.
    const shifted = shiftAdded(plan, { taskIds: ['t2', 't3'], stageIds: ['s2'] }, '2026-10-18');
    expect(shifted.shiftDays).toBe(5);
    expect(shifted.tasks.t2).toEqual({ startDate: '2026-10-18', dueDate: '2026-10-29' });
    expect(shifted.tasks.t3).toEqual({ startDate: '2026-11-01', dueDate: '2026-11-19' });
    expect(shifted.stages.s2).toEqual({ startDate: '2026-11-01', endDate: '2026-11-19' });
    expect(shifted.startDate).toBe('2026-10-18');
    expect(shifted.endDate).toBe('2026-11-19');
  });

  it('keeps the order, the length and the wait between the added parts', () => {
    const shifted = shiftAdded(plan, { taskIds: ['t1', 't2', 't3'], stageIds: ['s1', 's2'] }, '2026-12-06');
    for (const id of ['t1', 't2', 't3']) {
      expect(targetDays(shifted.tasks[id].startDate, shifted.tasks[id].dueDate)).toBe(targetDays(plan.tasks[id].startDate, plan.tasks[id].dueDate));
    }
    // t2 starts 5 working days after t1 in the template, and still does.
    expect(targetDays(shifted.tasks.t1.startDate, shifted.tasks.t2.startDate)).toBe(targetDays(plan.tasks.t1.startDate, plan.tasks.t2.startDate));
    expect(shifted.tasks.t1.startDate).toBe('2026-12-06');
    expect(shifted.tasks.t1.startDate < shifted.tasks.t3.startDate).toBe(true);
  });

  it('starts on the next working day when today is Friday or Saturday', () => {
    // Friday 2026-10-16: the first working day on or after it is Sunday 10-18.
    expect(shiftAdded(plan, { taskIds: ['t2'], stageIds: [] }, '2026-10-16').tasks.t2.startDate).toBe('2026-10-18');
    expect(shiftAdded(plan, { taskIds: ['t2'], stageIds: [] }, '2026-10-17').tasks.t2.startDate).toBe('2026-10-18');
  });

  it('reads only the added parts: a part that is not added, and starts early, does not force a shift', () => {
    // t1 starts on 10-04, before today, but only t3 is added and it starts on 10-25.
    const shifted = shiftAdded(plan, { taskIds: ['t3'], stageIds: [] }, '2026-10-18');
    expect(shifted.shiftDays).toBe(0);
    expect(shifted.tasks).toEqual({ t3: plan.tasks.t3 });
  });

  it('shifts a stage with its own numbers as well, by the same days', () => {
    const shifted = shiftAdded(plan, { taskIds: ['t3'], stageIds: ['s3'] }, '2026-12-06');
    // s3 and t3 move together: the earliest of them is t3 on 10-25.
    expect(shifted.tasks.t3.startDate).toBe('2026-12-06');
    expect(shifted.stages.s3).toEqual({ startDate: '2026-12-27', endDate: '2027-01-07' });
  });

  it('gives no dates and no shift when nothing is added or a part has no dates', () => {
    expect(shiftAdded(plan, { taskIds: [], stageIds: [] }, '2026-10-18')).toEqual({ shiftDays: 0, tasks: {}, stages: {}, startDate: null, endDate: null });
    const none = shiftAdded(plan, { taskIds: [], stageIds: ['s4'] }, '2026-10-18');
    expect(none.stages).toEqual({ s4: null });
    expect(none.startDate).toBeNull();
  });

  it('never moves a part back', () => {
    expect(shiftAdded(plan, { taskIds: ['t1'], stageIds: [] }, '2026-09-01').shiftDays).toBe(0);
  });
});
