import { planDates, templateLength, warpItems, workingDaysInclusive, type PlanItem } from './templatePlan';
import { addWorkingDays, firstWorkingDay } from './workdays';

/**
 * The dates of a project made from a project template (owner, 2026-10-05, item 6a). The new-project form and projects.create
 * both use this one function, so the screen shows the same dates that the server makes.
 *
 * A template counts in working days from day 0, the first working day on or after the project start. Each task is one item.
 * A stage with its own numbers (a start and a length) is one item too, also when it has tasks. The span of a stage covers its
 * own numbers and its tasks. A stage with no numbers and no tasks gets no dates. With an end date, the items stretch or shrink
 * to it (warpItems): a locked item keeps its length. Without an end date, the template keeps its length.
 */

export type PlanTemplate = {
  stages: { id: string; startOffset: number | null; durationDays: number | null }[];
  tasks: { id: string; stageId: string; startOffset: number; durationDays: number; flexible: boolean }[];
};

export type PlanChoice = {
  /** The project start. */
  startDate: string;
  /** The last day of the project. Empty keeps the template length. */
  endDate?: string | null;
  /** The ids of the tasks, and of the stages with no tasks, that keep their length. */
  fixedIds: Iterable<string>;
};

export type DatedTask = { startDate: string; dueDate: string };
export type DatedStage = { startDate: string; endDate: string };

export type ProjectPlan =
  | {
    ok: true;
    /** The length of the template, in working days. */
    templateDays: number;
    /** The length of the new plan, in working days. */
    days: number;
    /** The due day of the last item. Null when no item has dates. */
    endDate: string | null;
    tasks: Record<string, DatedTask>;
    stages: Record<string, DatedStage | null>;
  }
  | { ok: false; templateDays: number; targetDays: number; needs: number };

/** The working days from the first working day of the start to the end, both days in. 0 when the end comes first. */
export function targetDays(startDate: string, endDate: string): number {
  return workingDaysInclusive(firstWorkingDay(startDate), endDate);
}

/** The tasks that the template does not let stretch: the first state of the "Can stretch" ticks. */
export function lockedIds(template: Pick<PlanTemplate, 'tasks'>): string[] {
  return template.tasks.filter((task) => !task.flexible).map((task) => task.id);
}

/** The items of the plan: every task, and every stage that has its own numbers (also a stage with tasks). */
export function planItems(template: PlanTemplate, fixedIds: Iterable<string>): PlanItem[] {
  const fixed = new Set(fixedIds);
  const items: PlanItem[] = template.tasks.map((task) => ({ id: task.id, start: task.startOffset, days: task.durationDays, locked: fixed.has(task.id) }));
  for (const stage of template.stages) {
    if (stage.startOffset === null || stage.durationDays === null) continue;
    items.push({ id: stage.id, start: stage.startOffset, days: stage.durationDays, locked: fixed.has(stage.id) });
  }
  return items;
}

/**
 * The span of a stage in working days from day 0: its own numbers and its tasks together. The end comes after the last
 * working day, as in templateLength. Null when the stage has no numbers and no tasks.
 */
export function stageSpan(
  stage: { startOffset: number | null; durationDays: number | null },
  tasks: { startOffset: number; durationDays: number }[],
): { start: number; end: number } | null {
  const ranges = tasks.map((task) => ({ start: task.startOffset, end: task.startOffset + task.durationDays }));
  if (stage.startOffset !== null && stage.durationDays !== null) ranges.push({ start: stage.startOffset, end: stage.startOffset + stage.durationDays });
  if (ranges.length === 0) return null;
  return { start: Math.min(...ranges.map((range) => range.start)), end: Math.max(...ranges.map((range) => range.end)) };
}

/** A stage span with one more range of dates: the earlier start and the later end. */
function widen(span: DatedStage | null, startDate: string, endDate: string): DatedStage {
  if (!span) return { startDate, endDate };
  return {
    startDate: startDate < span.startDate ? startDate : span.startDate,
    endDate: endDate > span.endDate ? endDate : span.endDate,
  };
}

/** The length of a template in working days: the last end of all its items. */
export function templateDays(template: PlanTemplate): number {
  return templateLength(planItems(template, []));
}

export function planProject(template: PlanTemplate, choice: PlanChoice): ProjectPlan {
  const items = planItems(template, choice.fixedIds);
  const length = templateLength(items);
  const target = choice.endDate ? targetDays(choice.startDate, choice.endDate) : length;
  const stages: Record<string, DatedStage | null> = Object.fromEntries(template.stages.map((stage) => [stage.id, null]));
  if (items.length === 0) return { ok: true, templateDays: 0, days: 0, endDate: null, tasks: {}, stages };
  const warped = warpItems(items, target);
  if (!warped.ok) return { ok: false, templateDays: length, targetDays: target, needs: warped.needs };
  const dated = new Map(planDates(choice.startDate, warped.items).map((item) => [item.id, item]));
  const tasks: Record<string, DatedTask> = {};
  for (const task of template.tasks) {
    const { startDate, dueDate } = dated.get(task.id)!;
    tasks[task.id] = { startDate, dueDate };
    stages[task.stageId] = widen(stages[task.stageId], startDate, dueDate);
  }
  for (const stage of template.stages) {
    const own = dated.get(stage.id);
    if (own) stages[stage.id] = widen(stages[stage.id], own.startDate, own.dueDate);
  }
  const endDate = [...dated.values()].reduce((last, item) => (item.dueDate > last ? item.dueDate : last), '');
  return { ok: true, templateDays: length, days: warped.length, endDate: endDate || null, tasks, stages };
}

export type AddedPlan = {
  /** The working days that the added parts moved forward. 0: they keep the dates of the template. */
  shiftDays: number;
  /** The dates of the added tasks only. */
  tasks: Record<string, DatedTask>;
  /** The dates of the added stages only. Null: a stage with no dates. */
  stages: Record<string, DatedStage | null>;
  /** The first start and the last end of the added parts. Null when no added part has dates. */
  startDate: string | null;
  endDate: string | null;
};

/**
 * The dates of the template parts that join an ongoing project (owner, 2026-10-19, fbk_020). The plan counts day 0 from the project
 * start, so a project that started long ago would get dates in the past. When the earliest added part starts before today, all added
 * parts move forward by the same number of working days, so the earliest one starts today (the next working day when today is a
 * Friday or a Saturday). The order, the lengths and the waits between the added parts stay, because all dates are working days.
 * A part that is not added never counts and never moves. The server and the apply sheet both use this function.
 */
export function shiftAdded(
  plan: Extract<ProjectPlan, { ok: true }>,
  added: { taskIds: Iterable<string>; stageIds: Iterable<string> },
  today: string,
): AddedPlan {
  const tasks: Record<string, DatedTask> = {};
  const stages: Record<string, DatedStage | null> = {};
  for (const id of added.taskIds) if (plan.tasks[id]) tasks[id] = plan.tasks[id];
  for (const id of added.stageIds) if (id in plan.stages) stages[id] = plan.stages[id];
  const first = (days: string[]) => days.reduce((best, day) => (day < best ? day : best));
  const last = (days: string[]) => days.reduce((best, day) => (day > best ? day : best));
  const startsOf = () => [...Object.values(tasks).map((task) => task.startDate), ...Object.values(stages).flatMap((stage) => (stage ? [stage.startDate] : []))];
  const endsOf = () => [...Object.values(tasks).map((task) => task.dueDate), ...Object.values(stages).flatMap((stage) => (stage ? [stage.endDate] : []))];
  if (startsOf().length === 0) return { shiftDays: 0, tasks, stages, startDate: null, endDate: null };
  const shiftDays = first(startsOf()) < today ? workingDaysInclusive(first(startsOf()), firstWorkingDay(today)) - 1 : 0;
  const move = (day: string) => (shiftDays > 0 ? addWorkingDays(day, shiftDays) : day);
  for (const [id, task] of Object.entries(tasks)) tasks[id] = { startDate: move(task.startDate), dueDate: move(task.dueDate) };
  for (const [id, stage] of Object.entries(stages)) stages[id] = stage ? { startDate: move(stage.startDate), endDate: move(stage.endDate) } : null;
  return { shiftDays, tasks, stages, startDate: first(startsOf()), endDate: last(endsOf()) };
}
