import type { ProjectTemplate, TemplateRole, TemplateStage, TemplateTask } from '../../../api/contract/entities';
import { stageSpan, templateDays, type PlanTemplate } from '../../../lib/projectPlan';

/**
 * The project template editor works on a draft: the text of each field as the person types it. The numbers stay text until
 * the save, so a half-typed number never jumps. An empty person or role is ''.
 */
export type DraftRole = { id: string; name: string; defaultUserId: string };
export type DraftStage = {
  id: string; name: string; start: string; days: string;
  /** The stages that this stage waits for. Missing means none, so a stage without waits keeps its old shape. */
  prerequisiteIds?: string[];
};
export type DraftTask = {
  id: string; stageId: string; title: string; roleId: string; start: string; days: string; flexible: boolean;
  /** Kept as saved: the editor shows only the fields of the owner's list (title, role, start, length, can stretch). */
  description: string; checklist: string[]; needsReview: boolean;
  /** The tasks that this task waits for. Missing means none. */
  prerequisiteIds?: string[];
};
/**
 * "partSeq" is the highest part number that the saved template ever gave (fbk_008 item 4). A new part gets a number above it,
 * so the id of a removed part is never given again. Missing: the template was saved before partSeq existed.
 */
export type TemplateDraft = { name: string; roles: DraftRole[]; stages: DraftStage[]; tasks: DraftTask[]; partSeq?: number };
export type TemplateParts = { name: string; roles: TemplateRole[]; stages: TemplateStage[]; tasks: TemplateTask[] };

const OFFSET_MAX = 2000;
const DAYS_MAX = 365;
const NEW_TASK_DAYS = 5;

export function emptyDraft(): TemplateDraft {
  return { name: '', roles: [], stages: [{ id: 's1', name: '', start: '', days: '' }], tasks: [] };
}

const text = (n: number | null) => (n === null ? '' : String(n));

/** The waits of a part as the draft and the input keep them. The key is there only when the part waits for something. */
const waitsOf = (ids: readonly string[] | undefined): { prerequisiteIds?: string[] } => (ids && ids.length > 0 ? { prerequisiteIds: [...ids] } : {});

/** The part without the waits in `gone`. The key goes when no wait is left, as waitsOf leaves it out. */
function withoutWaits<T extends { prerequisiteIds?: string[] }>(part: T, gone: ReadonlySet<string>): T {
  const waits = part.prerequisiteIds;
  if (!waits || !waits.some((id) => gone.has(id))) return part;
  const rest = waits.filter((id) => !gone.has(id));
  const next: { prerequisiteIds?: string[] } = { ...part };
  delete next.prerequisiteIds;
  if (rest.length > 0) next.prerequisiteIds = rest;
  return next as T;
}

export function draftOf(template: ProjectTemplate): TemplateDraft {
  return {
    name: template.name,
    roles: template.roles.map((role) => ({ id: role.id, name: role.name, defaultUserId: role.defaultUserId ?? '' })),
    stages: template.stages.map((stage) => ({
      id: stage.id, name: stage.name, start: text(stage.startOffset), days: text(stage.durationDays), ...waitsOf(stage.prerequisiteIds),
    })),
    tasks: template.tasks.map((task) => ({
      id: task.id, stageId: task.stageId, title: task.title, roleId: task.roleId ?? '', start: String(task.startOffset), days: String(task.durationDays),
      flexible: task.flexible, description: task.description, checklist: [...task.checklist], needsReview: task.needsReview,
      ...waitsOf(task.prerequisiteIds),
    })),
    ...(template.partSeq === undefined ? {} : { partSeq: template.partSeq }),
  };
}

/** The longest name of a template. The editor and the server both refuse a longer one. */
const NAME_MAX = 60;

/**
 * The name of a copy: the copy word, then " 2", " 3" and so on while the name is in use. A name in use is compared without case
 * and outer spaces. A long name is cut at its end, so the name keeps at most 60 characters and the number stays.
 */
function copyName(copy: string, names: readonly string[]): string {
  const used = new Set(names.map((name) => name.trim().toLowerCase()));
  for (let n = 1; ; n += 1) {
    const suffix = n === 1 ? '' : ` ${n}`;
    const name = `${copy.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(name.trim().toLowerCase())) return name;
  }
}

/**
 * A copy of a template, as a draft with no id, so the save makes a new template. The parts keep their ids: an id is unique in
 * one template only. A default person who is not active becomes empty, so the save never refuses that person.
 */
export function duplicateDraft(
  template: ProjectTemplate, names: readonly string[], activeIds: ReadonlySet<string>, copyWord: (name: string) => string,
): TemplateDraft {
  const draft = draftOf(template);
  return {
    ...draft,
    name: copyName(copyWord(template.name), names),
    roles: draft.roles.map((role) => ({ ...role, defaultUserId: activeIds.has(role.defaultUserId) ? role.defaultUserId : '' })),
  };
}

/** A whole number from the text of a field, also with Arabic-Indic or Persian digits. Null when it is not one. */
export function wholeNumber(value: string): number | null {
  const western = value.trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  return /^\d{1,5}$/.test(western) ? Number(western) : null;
}

const offsetOk = (value: string) => { const n = wholeNumber(value); return n !== null && n <= OFFSET_MAX; };
const daysOk = (value: string) => { const n = wholeNumber(value); return n !== null && n >= 1 && n <= DAYS_MAX; };

/**
 * The next free id of a kind after the ids in `taken`: r for a role, s for a stage, t for a task. The number is above `floor`,
 * the highest part number the template ever gave, so a removed id is not given again.
 */
function freeIdAfter(taken: readonly string[], prefix: 'r' | 's' | 't', floor: number): string {
  const used = taken
    .map((id) => (id.startsWith(prefix) ? Number(id.slice(prefix.length)) : 0))
    .filter((n) => Number.isInteger(n));
  return `${prefix}${Math.max(floor, ...used) + 1}`;
}

/** The next free id of a kind: r for a role, s for a stage, t for a task. */
function freeId(draft: TemplateDraft, prefix: 'r' | 's' | 't'): string {
  return freeIdAfter([...draft.roles, ...draft.stages, ...draft.tasks].map((part) => part.id), prefix, draft.partSeq ?? 0);
}

/** The waits of copied parts, in their new ids. A wait on a part that was not copied is dropped. */
const keptWaits = (ids: readonly string[] | undefined, newIds: ReadonlyMap<string, string>): string[] => (ids ?? []).flatMap((id) => {
  const next = newIds.get(id);
  return next === undefined ? [] : [next];
});

/**
 * Adds stages of another template to the draft (fbk_008 item 7). Every copy gets a new id. With `withTasks`, the tasks of those
 * stages come too. The copies keep their order in the source template. A link between two copies follows the new ids, and a link
 * to a part that was not copied is dropped. A copied task takes the role of the draft with the same name. Case does not count.
 * When the draft has no such role, the task gets a copy of the role with no default person. A stage name in use gets " 2", or the next number.
 */
export function importStages(draft: TemplateDraft, source: ProjectTemplate, stageIds: readonly string[], withTasks: boolean): TemplateDraft {
  const from = draftOf(source);
  const picked = from.stages.filter((stage) => stageIds.includes(stage.id));
  const pickedIds = new Set(picked.map((stage) => stage.id));
  const tasks = withTasks ? from.tasks.filter((task) => pickedIds.has(task.stageId)) : [];
  const taken = [...draft.roles, ...draft.stages, ...draft.tasks].map((part) => part.id);
  const newId = (prefix: 'r' | 's' | 't'): string => {
    const id = freeIdAfter(taken, prefix, draft.partSeq ?? 0);
    taken.push(id);
    return id;
  };
  // Every copy gets its new id first, so a link can name a part that comes later in the list.
  const stageNew = new Map(picked.map((stage) => [stage.id, newId('s')] as const));
  const taskNew = new Map(tasks.map((task) => [task.id, newId('t')] as const));
  const roles = [...draft.roles];
  const roleOf = (sourceId: string): string => {
    const role = from.roles.find((part) => part.id === sourceId);
    if (!role) return '';
    const name = role.name.trim().toLowerCase();
    const same = roles.find((part) => part.name.trim().toLowerCase() === name);
    if (same) return same.id;
    const added: DraftRole = { id: newId('r'), name: role.name, defaultUserId: '' };
    roles.push(added);
    return added.id;
  };
  const names = draft.stages.map((stage) => stage.name);
  const stages: DraftStage[] = picked.map((stage) => {
    const name = copyName(stage.name, names);
    names.push(name);
    return { id: stageNew.get(stage.id)!, name, start: stage.start, days: stage.days, ...waitsOf(keptWaits(stage.prerequisiteIds, stageNew)) };
  });
  const copies: DraftTask[] = tasks.map((task) => ({
    id: taskNew.get(task.id)!, stageId: stageNew.get(task.stageId)!, title: task.title, roleId: roleOf(task.roleId), start: task.start, days: task.days,
    flexible: task.flexible, description: task.description, checklist: [...task.checklist], needsReview: task.needsReview,
    ...waitsOf(keptWaits(task.prerequisiteIds, taskNew)),
  }));
  return { ...draft, roles, stages: [...draft.stages, ...stages], tasks: [...draft.tasks, ...copies] };
}

export function addRole(draft: TemplateDraft): TemplateDraft {
  return { ...draft, roles: [...draft.roles, { id: freeId(draft, 'r'), name: '', defaultUserId: '' }] };
}

export function addStage(draft: TemplateDraft): TemplateDraft {
  return { ...draft, stages: [...draft.stages, { id: freeId(draft, 's'), name: '', start: '', days: '' }] };
}

/** A new task starts where the last task of its stage ends, or where the template ends when the stage has no task yet. */
export function addTask(draft: TemplateDraft, stageId: string): TemplateDraft {
  const own = draftPlanTemplate({ ...draft, tasks: draft.tasks.filter((task) => task.stageId === stageId) });
  const start = own.tasks.length > 0
    ? Math.max(...own.tasks.map((task) => task.startOffset + task.durationDays))
    : templateDays(draftPlanTemplate(draft));
  const task: DraftTask = {
    id: freeId(draft, 't'), stageId, title: '', roleId: '', start: String(start), days: String(NEW_TASK_DAYS), flexible: true,
    description: '', checklist: [], needsReview: true,
  };
  // The task goes after the last task of its stage, so the list stays grouped by stage.
  const last = draft.tasks.map((t) => t.stageId).lastIndexOf(stageId);
  const tasks = [...draft.tasks];
  tasks.splice(last === -1 ? tasks.length : last + 1, 0, task);
  return { ...draft, tasks };
}

/** Removes a task. The other tasks no longer wait for it, so a new task with the same id does not inherit the wait. */
export function removeTask(draft: TemplateDraft, taskId: string): TemplateDraft {
  const gone = new Set([taskId]);
  return { ...draft, tasks: draft.tasks.filter((task) => task.id !== taskId).map((task) => withoutWaits(task, gone)) };
}

/**
 * Removes a stage with its tasks. The other stages and tasks no longer wait for the removed parts, so a new part with the same id
 * does not inherit a wait.
 */
export function removeStage(draft: TemplateDraft, stageId: string): TemplateDraft {
  const goneTasks = new Set(draft.tasks.filter((task) => task.stageId === stageId).map((task) => task.id));
  const goneStages = new Set([stageId]);
  return {
    ...draft,
    stages: draft.stages.filter((stage) => stage.id !== stageId).map((stage) => withoutWaits(stage, goneStages)),
    tasks: draft.tasks.filter((task) => task.stageId !== stageId).map((task) => withoutWaits(task, goneTasks)),
  };
}

export function removeRole(draft: TemplateDraft, roleId: string): TemplateDraft {
  return {
    ...draft,
    roles: draft.roles.filter((role) => role.id !== roleId),
    tasks: draft.tasks.map((task) => (task.roleId === roleId ? { ...task, roleId: '' } : task)),
  };
}

export function moveStage(draft: TemplateDraft, stageId: string, delta: -1 | 1): TemplateDraft {
  const from = draft.stages.findIndex((stage) => stage.id === stageId);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= draft.stages.length) return draft;
  const stages = [...draft.stages];
  [stages[from], stages[to]] = [stages[to], stages[from]];
  return { ...draft, stages };
}

/**
 * Moves the stage at place `from` to place `to`. The other stages keep their order, and each stage keeps its tasks. The same
 * place, or a place outside the list, gives the draft back.
 */
export function reorderStages(draft: TemplateDraft, from: number, to: number): TemplateDraft {
  const count = draft.stages.length;
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return draft;
  const stages = [...draft.stages];
  const [moved] = stages.splice(from, 1);
  stages.splice(to, 0, moved);
  return { ...draft, stages };
}

const clampOffset = (n: number) => Math.min(OFFSET_MAX, Math.max(0, Math.round(n)));

/**
 * Moves a stage to a new start day, in working days from day 0. The own start of the stage becomes the new start, when it has
 * one. Each task of the stage moves by the same number of days, and never before day 0. A stage with no own start moves by
 * the earliest start of its tasks. A stage with neither has nothing to move.
 */
export function moveStageStart(draft: TemplateDraft, stageId: string, start: number): TemplateDraft {
  const stage = draft.stages.find((part) => part.id === stageId);
  if (!stage) return draft;
  const own = wholeNumber(stage.start);
  const taskStarts = draft.tasks.flatMap((task) => {
    const n = task.stageId === stageId ? wholeNumber(task.start) : null;
    return n === null ? [] : [n];
  });
  const from = own ?? (taskStarts.length > 0 ? Math.min(...taskStarts) : null);
  if (from === null) return draft;
  const to = clampOffset(start);
  const shift = to - from;
  return {
    ...draft,
    stages: draft.stages.map((part) => (part.id === stageId && own !== null ? { ...part, start: String(to) } : part)),
    tasks: draft.tasks.map((task) => {
      const n = task.stageId === stageId ? wholeNumber(task.start) : null;
      return n === null ? task : { ...task, start: String(clampOffset(n + shift)) };
    }),
  };
}

/**
 * The last working day of the tasks of a stage, as a day from day 0, when the tasks end after the own days of the stage.
 * Null when the stage has no own days, or when its own days cover its tasks: then the editor shows no note.
 */
export function tasksEndDay(draft: TemplateDraft, stageId: string): number | null {
  const plan = draftPlanTemplate(draft);
  const stage = plan.stages.find((part) => part.id === stageId);
  if (!stage || stage.startOffset === null || stage.durationDays === null) return null;
  const span = stageSpan(stage, plan.tasks.filter((task) => task.stageId === stageId));
  // The span end comes after the last working day, so the last day is one less.
  return span && span.end > stage.startOffset + stage.durationDays ? span.end - 1 : null;
}

/**
 * True when the stage at `index` starts before the stage above it, the stage at `index - 1`. A start is the span of the own days
 * and the tasks of a stage, as a project shows it. A stage with no span gives false, and so does the first stage.
 */
export function startsBeforeStageAbove(draft: TemplateDraft, index: number): boolean {
  if (index <= 0 || index >= draft.stages.length) return false;
  const plan = draftPlanTemplate(draft);
  const startOf = (stageId: string): number | null => {
    const stage = plan.stages.find((part) => part.id === stageId);
    if (!stage) return null;
    return stageSpan(stage, plan.tasks.filter((task) => task.stageId === stageId))?.start ?? null;
  };
  const here = startOf(draft.stages[index].id);
  const above = startOf(draft.stages[index - 1].id);
  return here !== null && above !== null && here < above;
}

function twice(names: string[]): boolean {
  const seen = new Set<string>();
  for (const name of names.map((n) => n.trim().toLowerCase())) {
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}

/** The first problem of a draft as a word key, or null. The same rules as projectTemplates.save, in the order of the editor. */
export function draftError(draft: TemplateDraft): string | null {
  if (!draft.name.trim()) return 'projectTemplates.errors.name';
  if (draft.roles.some((role) => !role.name.trim())) return 'projectTemplates.errors.roleName';
  if (twice(draft.roles.map((role) => role.name))) return 'projectTemplates.errors.roleTwice';
  if (draft.stages.length === 0) return 'projectTemplates.errors.noStage';
  if (draft.stages.some((stage) => !stage.name.trim())) return 'projectTemplates.errors.stageName';
  if (twice(draft.stages.map((stage) => stage.name))) return 'projectTemplates.errors.stageTwice';
  for (const stage of draft.stages) {
    const hasStart = stage.start.trim() !== '';
    const hasDays = stage.days.trim() !== '';
    if (hasStart !== hasDays) return 'projectTemplates.errors.stageNumbers';
    if (hasStart && (!offsetOk(stage.start) || !daysOk(stage.days))) return 'projectTemplates.errors.numbers';
  }
  if (draft.tasks.some((task) => !task.title.trim())) return 'projectTemplates.errors.taskTitle';
  if (draft.tasks.some((task) => !offsetOk(task.start) || !daysOk(task.days))) return 'projectTemplates.errors.numbers';
  return null;
}

/**
 * The input of projectTemplates.save. Call it only when draftError gives null. A wait on a part that the draft no longer has
 * (a removed task or stage) is dropped here, so the server never sees a wait on a missing part.
 */
export function draftInput(draft: TemplateDraft): TemplateParts {
  const stageIds = new Set(draft.stages.map((stage) => stage.id));
  const tasks = draft.tasks.filter((task) => stageIds.has(task.stageId));
  const taskIds = new Set(tasks.map((task) => task.id));
  return {
    name: draft.name.trim(),
    roles: draft.roles.map((role) => ({ id: role.id, name: role.name.trim(), defaultUserId: role.defaultUserId || null })),
    stages: draft.stages.map((stage) => ({
      id: stage.id, name: stage.name.trim(), startOffset: stage.start.trim() ? wholeNumber(stage.start) : null, durationDays: stage.days.trim() ? wholeNumber(stage.days) : null,
      ...waitsOf((stage.prerequisiteIds ?? []).filter((id) => stageIds.has(id))),
    })),
    tasks: tasks.map((task) => ({
      id: task.id, stageId: task.stageId, title: task.title.trim(), description: task.description, checklist: task.checklist, needsReview: task.needsReview,
      roleId: task.roleId || null, startOffset: wholeNumber(task.start)!, durationDays: wholeNumber(task.days)!, flexible: task.flexible,
      ...waitsOf((task.prerequisiteIds ?? []).filter((id) => taskIds.has(id))),
    })),
  };
}

/** The parts of a draft that the timeline can draw: only whole numbers in range. */
export function draftPlanTemplate(draft: TemplateDraft): PlanTemplate {
  return {
    stages: draft.stages.map((stage) => ({
      id: stage.id,
      startOffset: offsetOk(stage.start) && daysOk(stage.days) ? wholeNumber(stage.start) : null,
      durationDays: offsetOk(stage.start) && daysOk(stage.days) ? wholeNumber(stage.days) : null,
    })),
    tasks: draft.tasks
      .filter((task) => offsetOk(task.start) && daysOk(task.days))
      .map((task) => ({ id: task.id, stageId: task.stageId, startOffset: wholeNumber(task.start)!, durationDays: wholeNumber(task.days)!, flexible: task.flexible })),
  };
}
