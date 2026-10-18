import type { Project, ProjectTemplate, Stage, Task } from './contract/entities';
import { planProject, type ProjectPlan } from '../lib/projectPlan';

/**
 * The update of a project from its template (fbk_008 item 4). syncDiff names what a template update would change in one
 * project. projectTemplates.syncApply makes only the changes that the Admin picks. A project that is not linked to the
 * template has no diff. A closed task (done or in review) only gets its text changed, never its dates or its lead.
 */

/** A template part that the project lacks. stagePartId is the stage part of a task, and null for a stage. */
export type PartRef = { partId: string; title: string; stagePartId: string | null };

/** A project item (a stage or a task) and the template part it came from. title is the title that the item has now. */
export type ItemRef = { itemId: string; partId: string; title: string };

export type SyncDiff = {
  /** Template parts that the project has never had, or that the template added since. */
  add: PartRef[];
  /** Template parts that the team dropped. They come back only when the Admin picks "bringBack". */
  dropped: PartRef[];
  /** Project tasks whose template part left the template. */
  removed: ItemRef[];
  /** Open tasks whose title or description differs from the template. */
  text: ItemRef[];
  /** Open tasks that have not started and have other planned dates. */
  dates: ItemRef[];
  /** Open tasks still led by the old person of their role, when the template names another person for the role. */
  leads: ItemRef[];
  /** Done or in-review tasks whose title or description differs from the template. */
  closed: ItemRef[];
  /** Project stages whose name differs from the template part. */
  stages: ItemRef[];
  /** The lead and the helpers of each touched task, and each new lead, once. */
  people: string[];
};

/** The Admin's picks of one update. Each pick changes only its own kind of record. */
export type SyncChoices = {
  add: boolean;
  bringBack: boolean;
  removed: 'keep' | 'delete_unstarted';
  text: boolean;
  dates: boolean;
  leads: boolean;
  closed: 'leave' | 'text_only';
  stages: boolean;
};

/** A task that is done or in review. Its dates and its lead do not move. */
export const isClosed = (task: Pick<Task, 'status'>): boolean => task.status === 'done' || task.status === 'in_review';

/**
 * The planned dates of the template for one project: from the project start, in the template's own length, so a team that
 * stretched the project keeps its own end date (the dates pick says so). Null when the project has no start date or no plan.
 */
export function planOf(template: ProjectTemplate, project: Project): Extract<ProjectPlan, { ok: true }> | null {
  if (!project.startDate) return null;
  const plan = planProject(template, { startDate: project.startDate, fixedIds: [] });
  return plan.ok ? plan : null;
}

/** The part of the diff that concerns one project: its lists, and the people who must hear of the change. */
export function syncDiff(
  template: ProjectTemplate,
  project: Project,
  stages: Stage[],
  tasks: Task[],
  isActive: (userId: string) => boolean = () => true,
): SyncDiff {
  const diff: SyncDiff = { add: [], dropped: [], removed: [], text: [], dates: [], leads: [], closed: [], stages: [], people: [] };
  const link = project.templateLink;
  if (!link || link.templateId !== template.id) return diff;
  const dropped = new Set(link.droppedPartIds);
  const plan = planOf(template, project);
  const stagePart = new Map(template.stages.map((part) => [part.id, part]));
  const taskPart = new Map(template.tasks.map((part) => [part.id, part]));
  const rolePart = new Map(template.roles.map((role) => [role.id, role]));
  const stageOf = new Map(stages.flatMap((stage) => (stage.templatePartId ? [[stage.templatePartId, stage] as const] : [])));
  const taskOf = new Map(tasks.flatMap((task) => (task.templatePartId ? [[task.templatePartId, task] as const] : [])));
  const people = new Set<string>();
  const touched = (task: Task) => {
    if (task.ownerId) people.add(task.ownerId);
    for (const helperId of task.helperIds ?? []) people.add(helperId);
  };

  for (const part of template.stages) {
    if (stageOf.has(part.id)) continue;
    (dropped.has(part.id) ? diff.dropped : diff.add).push({ partId: part.id, title: part.name, stagePartId: null });
  }
  for (const stage of stages) {
    const part = stage.templatePartId ? stagePart.get(stage.templatePartId) : undefined;
    if (part && part.name !== stage.name) diff.stages.push({ itemId: stage.id, partId: part.id, title: stage.name });
  }
  // A task of a stage that the team dropped goes with that stage (dropped), so a bring back of the stage brings its tasks too.
  for (const part of template.tasks) {
    if (taskOf.has(part.id)) continue;
    const stageDropped = !stageOf.has(part.stageId) && dropped.has(part.stageId);
    (dropped.has(part.id) || stageDropped ? diff.dropped : diff.add).push({ partId: part.id, title: part.title, stagePartId: part.stageId });
  }

  for (const task of tasks) {
    if (!task.templatePartId) continue;
    const part = taskPart.get(task.templatePartId);
    if (!part) {
      diff.removed.push({ itemId: task.id, partId: task.templatePartId, title: task.title });
      touched(task);
      continue;
    }
    const item: ItemRef = { itemId: task.id, partId: part.id, title: task.title };
    const closed = isClosed(task);
    const text = task.title !== part.title || task.description !== part.description;
    const planned = plan?.tasks[part.id];
    const dates = task.status === 'todo' && planned !== undefined && ((task.startDate ?? null) !== planned.startDate || task.dueDate !== planned.dueDate);
    const role = part.roleId === null ? undefined : rolePart.get(part.roleId);
    const oldLead = role ? link.rolePeople[role.id] ?? null : null;
    const newLead = role ? role.defaultUserId : null;
    const leads = !closed && role !== undefined && task.ownerId === oldLead && newLead !== oldLead && (newLead === null || isActive(newLead));
    if (text) (closed ? diff.closed : diff.text).push(item);
    if (dates) diff.dates.push(item);
    if (leads) diff.leads.push(item);
    if (text || dates || leads) {
      touched(task);
      if (leads && newLead !== null) people.add(newLead);
    }
  }

  diff.people = [...people];
  return diff;
}
