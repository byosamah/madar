import type { HealthValue, Project, Stage, Task } from './contract/entities';
import { diffDays } from '../lib/dates';
import { stageTagOf } from '../lib/stageFlow';

export type HealthResult = {
  value: HealthValue;
  computed: HealthValue;
  overridden: boolean;
  reason: string | null;
  setBy: string | null;
};

/** A task in review is not overdue: the owner finished it. */
export function isOverdue(task: Task, today: string): boolean {
  return task.dueDate !== null && task.dueDate < today && (task.status === 'todo' || task.status === 'in_progress');
}

/**
 * A past-due task marks its project At risk only from this many calendar days past due (owner, 2026-10-06). A task 1 or 2 days
 * past due still counts as past due everywhere else, for example in the "Past-due tasks" number of the Dashboard.
 */
export const AT_RISK_DAYS_PAST_DUE = 3;

/** A task that puts its project at risk: past due by AT_RISK_DAYS_PAST_DUE calendar days or more. */
export function putsAtRisk(task: Task, today: string): boolean {
  return isOverdue(task, today) && diffDays(task.dueDate as string, today) >= AT_RISK_DAYS_PAST_DUE;
}

function computeRaw(project: Project, stages: Stage[], tasks: Task[], today: string): HealthValue {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  // The stage the project is in follows the tasks (owner, 2026-10-02), so it is computed and never read from the saved value.
  const current = stages.length > 0 ? stageTagOf(stages, projectTasks) : null;
  // A continuous project has no end (fbk_069): no stage end date makes it Late or At risk. A to-do past due still marks it At risk.
  const ending = project.continuous ? null : current;
  if (ending?.endDate && today > ending.endDate) return 'late';
  if (projectTasks.some((task) => putsAtRisk(task, today))) return 'at_risk';
  if (ending?.endDate && diffDays(today, ending.endDate) <= 7) {
    const stageTasks = projectTasks.filter((task) => task.stageId === ending.id);
    const done = stageTasks.filter((task) => task.status === 'done').length;
    if (stageTasks.length > 0 && done / stageTasks.length < 0.7) return 'at_risk';
  }
  return 'on_track';
}

/** The health rule from spec section 4.2, with the 3-day rule for past-due tasks (owner, 2026-10-06). Null for a project that is not active. */
export function computeHealth(input: { project: Project; stages: Stage[]; tasks: Task[] }, today: string): HealthResult | null {
  const { project, stages, tasks } = input;
  if (project.status !== 'active') return null;
  const computed = computeRaw(project, stages, tasks, today);
  const override = project.healthOverride;
  if (override) return { value: override.value, computed, overridden: true, reason: override.reason, setBy: override.setBy };
  return { value: computed, computed, overridden: false, reason: null, setBy: null };
}
