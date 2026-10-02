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

function computeRaw(project: Project, stages: Stage[], tasks: Task[], today: string): HealthValue {
  const projectTasks = tasks.filter((task) => task.projectId === project.id);
  // The stage the project is in follows the tasks (owner, 2026-10-02), so it is computed and never read from the saved value.
  const current = stages.length > 0 ? stageTagOf(stages, projectTasks) : null;
  if (current?.endDate && today > current.endDate) return 'late';
  if (projectTasks.some((task) => isOverdue(task, today))) return 'at_risk';
  if (current?.endDate && diffDays(today, current.endDate) <= 7) {
    const stageTasks = projectTasks.filter((task) => task.stageId === current.id);
    const done = stageTasks.filter((task) => task.status === 'done').length;
    if (stageTasks.length > 0 && done / stageTasks.length < 0.7) return 'at_risk';
  }
  return 'on_track';
}

/** The health rule from spec section 4.2. Returns null for projects that are not active. */
export function computeHealth(input: { project: Project; stages: Stage[]; tasks: Task[] }, today: string): HealthResult | null {
  const { project, stages, tasks } = input;
  if (project.status !== 'active') return null;
  const computed = computeRaw(project, stages, tasks, today);
  const override = project.healthOverride;
  if (override) return { value: override.value, computed, overridden: true, reason: override.reason, setBy: override.setBy };
  return { value: computed, computed, overridden: false, reason: null, setBy: null };
}
