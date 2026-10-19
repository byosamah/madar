import type { Project, ProjectTemplate, Stage, Task, TemplateBase, TemplateStage, TemplateTask } from './contract/entities';
import { planProject, type ProjectPlan } from '../lib/projectPlan';

/**
 * The update of a project from its template (fbk_008 item 4). syncDiff names what a template update would change in one
 * project. projectTemplates.syncApply makes only the changes that the Admin picks. A project that is not linked to the
 * template has no diff. A closed task (done or in review) only gets its text changed, never its dates or its lead.
 *
 * A part counts as changed only when the template differs from the copy that the link keeps (link.base, ADM-01). When the
 * project item also differs from that copy, the team edited it. Such an item is "edited": the update keeps the team's version
 * unless the Admin picks the template. A link with no copy (made before ADM-01) shows every difference as edited.
 */

/** A template part that the project lacks. stagePartId is the stage part of a task, and null for a stage. */
export type PartRef = { partId: string; title: string; stagePartId: string | null };

/** Two days of a task: its start and its due day. */
export type Span = { start: string | null; due: string | null };

/**
 * A project item (a stage or a task) and the template part it came from. title is the title that the item has now. The other
 * fields say what a change would do, so the screen can name it: the title the template gives, a new description, the dates
 * now and the dates the template gives, or the lead now and the lead the template gives.
 */
export type ItemRef = {
  itemId: string; partId: string; title: string;
  newTitle?: string;
  description?: boolean;
  dates?: { from: Span; to: Span };
  lead?: { from: string | null; to: string | null };
  /** True for a stage of the project. */
  stage?: boolean;
};

export type SyncDiff = {
  /** Template parts that the project has never had, or that the template added since. */
  add: PartRef[];
  /** Template parts that the team dropped. They come back only when the Admin picks "bringBack". */
  dropped: PartRef[];
  /** Project tasks whose template part left the template. */
  removed: ItemRef[];
  /** Open tasks whose title or description the template changed, where the team did not edit it. */
  text: ItemRef[];
  /** Open tasks that have not started, where the template moved the dates and the team did not. */
  dates: ItemRef[];
  /** Open tasks still led by the old person of their role, when the template names another person for the role. */
  leads: ItemRef[];
  /** Done or in-review tasks whose title or description the template changed. */
  closed: ItemRef[];
  /** Project stages whose name the template changed, where the team did not rename them. */
  stages: ItemRef[];
  /** Tasks and stages that the template changed and the team edited too. The update keeps the team's version unless the Admin picks the template. */
  edited: ItemRef[];
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
  edited: 'keep' | 'use_template';
};

/** A task that is done or in review. Its dates and its lead do not move. */
export const isClosed = (task: Pick<Task, 'status'>): boolean => task.status === 'done' || task.status === 'in_review';

/**
 * The planned dates of the template for one project, from the project start, in the template's own lengths. A project that the
 * team stretched moves back to these lengths when the Admin picks dates. Null when the project has no start date or no plan.
 */
export function planOf(template: ProjectTemplate, project: Project): Extract<ProjectPlan, { ok: true }> | null {
  if (!project.startDate) return null;
  const plan = planProject(template, { startDate: project.startDate, fixedIds: [] });
  return plan.ok ? plan : null;
}

type DatedPlan = { tasks: Record<string, { startDate: string; dueDate: string }> } | null;

/** The copy that a link keeps: every part as the template says it now, with the dates that the plan gives each task. */
export function baseOf(template: Pick<ProjectTemplate, 'stages' | 'tasks'>, plan: DatedPlan): TemplateBase {
  return {
    stages: Object.fromEntries(template.stages.map((part) => [part.id, { name: part.name, startOffset: part.startOffset, durationDays: part.durationDays }])),
    tasks: Object.fromEntries(template.tasks.map((part) => [part.id, {
      title: part.title, description: part.description, roleId: part.roleId, startOffset: part.startOffset, durationDays: part.durationDays,
      startDate: plan?.tasks[part.id]?.startDate ?? null, dueDate: plan?.tasks[part.id]?.dueDate ?? null,
    }])),
  };
}

type TaskBase = TemplateBase['tasks'][string];
type TextFields = Partial<Pick<Task, 'title' | 'description'>>;

/**
 * The text changes of one task. "apply" holds the fields that the template changed and the team left alone. "edited" holds the
 * fields that the template changed and the team edited too. A description is never replaced with an empty one. Without a copy
 * of the template, an open task shows every difference as edited, and a closed task shows it as apply (the Admin picks it).
 */
export function textChanges(task: Pick<Task, 'title' | 'description' | 'status'>, part: TemplateTask, base: TaskBase | undefined): { apply: TextFields; edited: TextFields } {
  const apply: TextFields = {};
  const edited: TextFields = {};
  const closed = isClosed(task);
  const route = (field: 'title' | 'description') => {
    if (task[field] === part[field]) return;
    if (field === 'description' && part.description === '') return;
    if (base !== undefined && part[field] === base[field]) return;
    const team = base !== undefined && task[field] !== base[field];
    if (base === undefined ? closed : !team) apply[field] = part[field];
    else edited[field] = part[field];
  };
  route('title');
  route('description');
  return { apply, edited };
}

/** The date change of one task that has not started: the planned dates, and whether the team moved the dates away from the copy. */
function dateChange(task: Task, part: TemplateTask, base: TaskBase | undefined, planned: { startDate: string; dueDate: string } | undefined): 'apply' | 'edited' | null {
  if (task.status !== 'todo' || planned === undefined) return null;
  if ((task.startDate ?? null) === planned.startDate && task.dueDate === planned.dueDate) return null;
  if (base === undefined) return 'edited';
  if (part.startOffset === base.startOffset && part.durationDays === base.durationDays) return null;
  return (task.startDate ?? null) === base.startDate && task.dueDate === base.dueDate ? 'apply' : 'edited';
}

/** The name change of one stage: the template renamed it and the team did not (apply), or both did (edited). */
function stageChange(stage: Stage, part: TemplateStage, base: TemplateBase['stages'][string] | undefined): 'apply' | 'edited' | null {
  if (part.name === stage.name) return null;
  if (base === undefined) return 'edited';
  if (part.name === base.name) return null;
  return stage.name === base.name ? 'apply' : 'edited';
}

/** The part of the diff that concerns one project: its lists, and the people who must hear of the change. */
export function syncDiff(
  template: ProjectTemplate,
  project: Project,
  stages: Stage[],
  tasks: Task[],
  isActive: (userId: string) => boolean = () => true,
): SyncDiff {
  const diff: SyncDiff = { add: [], dropped: [], removed: [], text: [], dates: [], leads: [], closed: [], stages: [], edited: [], people: [] };
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
    if (!part) continue;
    const change = stageChange(stage, part, link.base?.stages[part.id]);
    if (change === null) continue;
    (change === 'apply' ? diff.stages : diff.edited).push({ itemId: stage.id, partId: part.id, title: stage.name, newTitle: part.name, stage: true });
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
    const base = link.base?.tasks[part.id];
    const closed = isClosed(task);
    const text = textChanges(task, part, base);
    const planned = plan?.tasks[part.id];
    const dateKind = dateChange(task, part, base, planned);
    const role = part.roleId === null ? undefined : rolePart.get(part.roleId);
    const oldLead = role ? link.rolePeople[role.id] ?? null : null;
    const newLead = role ? role.defaultUserId : null;
    const leads = !closed && role !== undefined && task.ownerId === oldLead && newLead !== oldLead && (newLead === null || isActive(newLead));

    const textRef = (fields: TextFields): ItemRef => ({
      itemId: task.id, partId: part.id, title: task.title,
      ...(fields.title !== undefined ? { newTitle: fields.title } : {}),
      ...(fields.description !== undefined ? { description: true } : {}),
    });
    const datesRef = (): NonNullable<ItemRef['dates']> => ({
      from: { start: task.startDate ?? null, due: task.dueDate }, to: { start: planned!.startDate, due: planned!.dueDate },
    });
    const textApplies = Object.keys(text.apply).length > 0;
    if (textApplies) (closed ? diff.closed : diff.text).push(textRef(text.apply));
    if (dateKind === 'apply') diff.dates.push({ itemId: task.id, partId: part.id, title: task.title, dates: datesRef() });
    // One edited item holds the text and the dates that the team changed, so the screen names the task once.
    if (!closed && (Object.keys(text.edited).length > 0 || dateKind === 'edited')) {
      diff.edited.push({ ...textRef(text.edited), ...(dateKind === 'edited' ? { dates: datesRef() } : {}) });
    }
    if (leads) diff.leads.push({ itemId: task.id, partId: part.id, title: task.title, lead: { from: task.ownerId, to: newLead } });
    if (textApplies || dateKind === 'apply' || leads) {
      touched(task);
      if (leads && newLead !== null) people.add(newLead);
    }
  }

  diff.people = [...people];
  return diff;
}

/**
 * The copy that a link keeps after an update: what the template says now. A kind that the Admin did not pick keeps its old copy,
 * so the next update offers it again. A kept team edit takes the new copy: the Admin has seen it and chose the team's version.
 */
export function nextBase(template: ProjectTemplate, plan: DatedPlan, previous: TemplateBase | undefined, diff: SyncDiff, choices: SyncChoices): TemplateBase {
  const next = baseOf(template, plan);
  if (!previous) return next;
  const keepText = (items: ItemRef[]) => {
    for (const item of items) {
      const old = previous.tasks[item.partId];
      if (old && next.tasks[item.partId]) next.tasks[item.partId] = { ...next.tasks[item.partId], title: old.title, description: old.description };
    }
  };
  if (!choices.text) keepText(diff.text);
  if (choices.closed === 'leave') keepText(diff.closed);
  if (!choices.dates) {
    for (const item of diff.dates) {
      const old = previous.tasks[item.partId];
      if (old && next.tasks[item.partId]) {
        next.tasks[item.partId] = { ...next.tasks[item.partId], startOffset: old.startOffset, durationDays: old.durationDays, startDate: old.startDate, dueDate: old.dueDate };
      }
    }
  }
  if (!choices.stages) {
    for (const item of diff.stages) {
      const old = previous.stages[item.partId];
      if (old && next.stages[item.partId]) next.stages[item.partId] = { ...next.stages[item.partId], name: old.name };
    }
  }
  return next;
}
