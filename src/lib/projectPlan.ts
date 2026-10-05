import { planDates, templateLength, warpItems, workingDaysInclusive, type PlanItem } from './templatePlan';
import { firstWorkingDay } from './workdays';

/**
 * The dates of a project made from a project template (owner, 2026-10-05, item 6a). The new-project form and projects.create
 * both use this one function, so the screen shows the same dates that the server makes.
 *
 * A template counts in working days from day 0, the first working day on or after the project start. Each task is one item.
 * A stage with no tasks but with its own numbers is one item too. A stage with tasks spans its tasks. A stage with no tasks
 * and no numbers gets no dates. With an end date, the items stretch or shrink to it (warpItems): a locked item keeps its
 * length. Without an end date, the template keeps its length.
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

/** The items of the plan: every task, and every stage that has no tasks but has its own numbers. */
export function planItems(template: PlanTemplate, fixedIds: Iterable<string>): PlanItem[] {
  const fixed = new Set(fixedIds);
  const withTasks = new Set(template.tasks.map((task) => task.stageId));
  const items: PlanItem[] = template.tasks.map((task) => ({ id: task.id, start: task.startOffset, days: task.durationDays, locked: fixed.has(task.id) }));
  for (const stage of template.stages) {
    if (withTasks.has(stage.id) || stage.startOffset === null || stage.durationDays === null) continue;
    items.push({ id: stage.id, start: stage.startOffset, days: stage.durationDays, locked: fixed.has(stage.id) });
  }
  return items;
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
    const span = stages[task.stageId];
    stages[task.stageId] = span
      ? { startDate: startDate < span.startDate ? startDate : span.startDate, endDate: dueDate > span.endDate ? dueDate : span.endDate }
      : { startDate, endDate: dueDate };
  }
  for (const stage of template.stages) {
    const own = dated.get(stage.id);
    if (own) stages[stage.id] = { startDate: own.startDate, endDate: own.dueDate };
  }
  const endDate = [...dated.values()].reduce((last, item) => (item.dueDate > last ? item.dueDate : last), '');
  return { ok: true, templateDays: length, days: warped.length, endDate: endDate || null, tasks, stages };
}
