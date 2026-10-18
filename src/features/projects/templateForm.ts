import type { ProjectTemplate, TemplateRole } from '../../api/contract/entities';
import { planProject, targetDays, templateDays, type ProjectPlan } from '../../lib/projectPlan';

/**
 * The template part of the new-project form (owner, 2026-10-05, item 6a): the person of each role, the "Can stretch" ticks, and
 * the plan that the screen shows. The plan comes from the same function as the one projects.create uses, so the screen shows
 * the dates that the server makes.
 */
export type TemplateValues = {
  startDate: string;
  /** The last day of the project. Empty keeps the template length. */
  targetEndDate: string;
  /** The person of a role by role id. '' is "No lead". A role that is not here takes its default person. */
  templateRoles: Record<string, string>;
  /** The "Can stretch" tick of a task, or of a stage with no tasks, by id. One that is not here takes the template value. */
  templateStretch: Record<string, boolean>;
};

type Person = { id: string; active: boolean };

/** The person of a role: the pick of the person, else the default person while active, else '' (No lead). */
export function roleChoice(role: TemplateRole, values: Pick<TemplateValues, 'templateRoles'>, people: readonly Person[]): string {
  const picked = values.templateRoles[role.id];
  if (picked !== undefined) return picked;
  const fallback = people.find((person) => person.id === role.defaultUserId);
  return fallback?.active ? fallback.id : '';
}

/**
 * The tasks whose tick is off, and the stages with their own numbers that keep their length. A stage with no tasks has its own
 * tick. A stage with tasks keeps its length when all its tasks keep theirs.
 */
export function fixedIdsOf(template: ProjectTemplate, stretch: Record<string, boolean>): string[] {
  const tasks = template.tasks.filter((task) => !(stretch[task.id] ?? task.flexible)).map((task) => task.id);
  const locked = new Set(tasks);
  const stages = template.stages
    .filter((stage) => {
      if (stage.startOffset === null) return false;
      const own = template.tasks.filter((task) => task.stageId === stage.id);
      if (own.length === 0) return !(stretch[stage.id] ?? true);
      return own.every((task) => locked.has(task.id));
    })
    .map((stage) => stage.id);
  return [...tasks, ...stages];
}

/** The tick of a stage: all its tasks can stretch, none can, or some can. A stage with no tasks has its own tick. */
export function stageStretch(template: ProjectTemplate, stageId: string, stretch: Record<string, boolean>): 'on' | 'off' | 'mixed' {
  const tasks = template.tasks.filter((task) => task.stageId === stageId);
  if (tasks.length === 0) return (stretch[stageId] ?? true) ? 'on' : 'off';
  const on = tasks.filter((task) => stretch[task.id] ?? task.flexible).length;
  return on === tasks.length ? 'on' : on === 0 ? 'off' : 'mixed';
}

/** A press on the tick of a stage sets every task of the stage, or the stage itself when it has no tasks. */
export function setStageStretch(template: ProjectTemplate, stageId: string, on: boolean, stretch: Record<string, boolean>): Record<string, boolean> {
  const tasks = template.tasks.filter((task) => task.stageId === stageId);
  if (tasks.length === 0) return { ...stretch, [stageId]: on };
  return { ...stretch, ...Object.fromEntries(tasks.map((task) => [task.id, on])) };
}

/** The plan for the form, or null before the person gives a start date. */
export function planOfForm(template: ProjectTemplate, values: TemplateValues): ProjectPlan | null {
  if (!values.startDate) return null;
  return planProject(template, { startDate: values.startDate, endDate: values.targetEndDate || null, fixedIds: fixedIdsOf(template, values.templateStretch) });
}

/** The ticks matter only when the end date gives the project another length than the template. */
export function showStretch(template: ProjectTemplate, values: TemplateValues): boolean {
  if (!values.startDate || !values.targetEndDate) return false;
  return targetDays(values.startDate, values.targetEndDate) !== templateDays(template);
}

/** The template part of projects.create. */
export function templateInput(template: ProjectTemplate, values: TemplateValues, people: readonly Person[]) {
  return {
    templateId: template.id,
    startDate: values.startDate,
    endDate: values.targetEndDate || null,
    roles: Object.fromEntries(template.roles.map((role) => [role.id, roleChoice(role, values, people) || null])),
    fixedTaskIds: fixedIdsOf(template, values.templateStretch),
  };
}
