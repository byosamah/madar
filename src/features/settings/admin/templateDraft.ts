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
  /**
   * True for a task that Add task just made and the person has not touched: its days are the days that Add task chose, not a choice of
   * the person (fbk_031). The draft keeps it; the save never sees it. Missing means a saved task or a task whose days the person set.
   */
  fresh?: true;
};
/**
 * "partSeq" is the highest part number that the saved template ever gave (fbk_008 item 4). A new part gets a number above it,
 * so the id of a removed part is never given again. Missing: the template was saved before partSeq existed.
 */
export type TemplateDraft = { name: string; roles: DraftRole[]; stages: DraftStage[]; tasks: DraftTask[]; partSeq?: number };
export type TemplateParts = { name: string; roles: TemplateRole[]; stages: TemplateStage[]; tasks: TemplateTask[] };

const OFFSET_MAX = 2000;
/** The longest length of a task, in working days. The editor, the chart and the server all refuse a longer one. A stage has no length of its own. */
export const DAYS_MAX = 365;
/** The longest name of a template, a role or a stage. The editor and the server both refuse a longer one. */
export const NAME_MAX = 60;
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

/**
 * The highest part number that the ids of a template give, such as r3, s2 or t14. A template saved before partSeq existed has
 * no partSeq, so its ids give the floor. Zero when no id has a number.
 */
function highestPartNumber(template: ProjectTemplate): number {
  const numbers = [...template.roles, ...template.stages, ...template.tasks].map((part) => {
    const match = /^[a-z](\d+)$/.exec(part.id);
    return match ? Number(match[1]) : 0;
  });
  return Math.max(0, ...numbers);
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
    partSeq: Math.max(template.partSeq ?? 0, highestPartNumber(template)),
  };
}

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
export function importStages(draft: TemplateDraft, source: ProjectTemplate, stageIds: readonly string[], withTasks: boolean, keepDays = false): TemplateDraft {
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
  // The copies go right after the last stage of the draft (ADM-17): every copied day moves by one number, so the gaps between the
  // copies stay. With `keepDays`, the copies keep the days of the other template.
  const copiedStarts = [...picked.map((stage) => wholeNumber(stage.start)), ...tasks.map((task) => wholeNumber(task.start))].filter((n): n is number => n !== null);
  const shift = keepDays || copiedStarts.length === 0 ? 0 : templateDays(draftPlanTemplate(draft)) - Math.min(...copiedStarts);
  const moved = (value: string): string => {
    const n = wholeNumber(value);
    return n === null ? value : String(clampOffset(n + shift));
  };
  const stages: DraftStage[] = picked.map((stage) => {
    const name = copyName(stage.name, names);
    names.push(name);
    return { id: stageNew.get(stage.id)!, name, start: moved(stage.start), days: stage.days, ...waitsOf(keptWaits(stage.prerequisiteIds, stageNew)) };
  });
  const copies: DraftTask[] = tasks.map((task) => ({
    id: taskNew.get(task.id)!, stageId: stageNew.get(task.stageId)!, title: task.title, roleId: roleOf(task.roleId), start: moved(task.start), days: task.days,
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

/**
 * The start day of a task that is added to a stage: where the last task of the stage ends. The first task of a stage starts at the own
 * start day of the stage when the stage has one (ADM-18), else where the template ends.
 */
function newTaskStart(draft: TemplateDraft, stageId: string): number {
  const own = draftPlanTemplate({ ...draft, tasks: draft.tasks.filter((task) => task.stageId === stageId) });
  const stageStart = wholeNumber(draft.stages.find((stage) => stage.id === stageId)?.start ?? '');
  return own.tasks.length > 0
    ? Math.max(...own.tasks.map((task) => task.startOffset + task.durationDays))
    : stageStart ?? templateDays(draftPlanTemplate(draft));
}

/** The tasks with `task` after the last task of its stage, or at the end when that stage has none. The list stays grouped by stage. */
function insertInStage(tasks: readonly DraftTask[], task: DraftTask): DraftTask[] {
  const last = tasks.map((part) => part.stageId).lastIndexOf(task.stageId);
  const next = [...tasks];
  next.splice(last === -1 ? next.length : last + 1, 0, task);
  return next;
}

/** A new task starts where the last task of its stage ends (newTaskStart), for 5 days. It is "fresh" until the person sets its days. */
export function addTask(draft: TemplateDraft, stageId: string): TemplateDraft {
  const start = newTaskStart(draft, stageId);
  const task: DraftTask = {
    id: freeId(draft, 't'), stageId, title: '', roleId: '', start: String(start), days: String(NEW_TASK_DAYS), flexible: true,
    description: '', checklist: [], needsReview: true, fresh: true,
  };
  return { ...draft, tasks: insertInStage(draft.tasks, task) };
}

/** The task after the person set its days (start or length): it is no longer fresh, so a move to another stage keeps its days. */
export function touchTask(task: DraftTask): DraftTask {
  const { fresh: _fresh, ...rest } = task;
  return rest;
}

/**
 * Moves a task to another stage (fbk_031: "adding a task to an existing template does not let you change which stage it's added in").
 * One rule, with the fewest surprises: the move changes the stage and nothing else, so the days of a task stay where they are, and the
 * notes that the editor shows today say when they no longer fit the stage (tasksEndDay, startsBeforeStageAbove). The waits stay true,
 * because the days do not move. One exception: a task that Add task just made and the person has not touched ("fresh", no wait) never
 * had days of its own, so it goes where Add task would put it in the new stage. The list stays grouped by stage: the task goes after the
 * last task of its new stage, or at the end when that stage has none. The draft comes back as it was for the same stage, a missing stage
 * or a missing task.
 */
export function moveTaskToStage(draft: TemplateDraft, taskId: string, stageId: string): TemplateDraft {
  const task = draft.tasks.find((part) => part.id === taskId);
  if (!task || task.stageId === stageId || !draft.stages.some((stage) => stage.id === stageId)) return draft;
  const rest = draft.tasks.filter((part) => part.id !== taskId);
  const placed = task.fresh && (task.prerequisiteIds ?? []).length === 0;
  const moved: DraftTask = { ...task, stageId, ...(placed ? { start: String(newTaskStart({ ...draft, tasks: rest }, stageId)) } : {}) };
  return { ...draft, tasks: insertInStage(rest, moved) };
}

/**
 * True when the stage of the task has its own days and the days of the task are not inside them (fbk_031). The editor says so under the
 * Stage field, because a move to another stage keeps the days of the task. A stage with no own days, or a task with no valid numbers,
 * has no such problem.
 */
export function taskOutsideStage(draft: TemplateDraft, taskId: string): boolean {
  const task = draft.tasks.find((part) => part.id === taskId);
  const stage = task && draft.stages.find((part) => part.id === task.stageId);
  if (!task || !stage) return false;
  const [from, days] = [wholeNumber(stage.start), wholeNumber(stage.days)];
  const [start, length] = [wholeNumber(task.start), wholeNumber(task.days)];
  if (from === null || days === null || start === null || length === null) return false;
  return start < from || start + length > from + days;
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
  return shiftStage(draft, stageId, to - from, own === null ? null : to);
}

/**
 * Moves a stage and its tasks by `shift` working days (a task never goes before day 0). `ownStart` is the new own start of the
 * stage, or null when the stage has none.
 */
function shiftStage(draft: TemplateDraft, stageId: string, shift: number, ownStart: number | null): TemplateDraft {
  return {
    ...draft,
    stages: draft.stages.map((part) => (part.id === stageId && ownStart !== null ? { ...part, start: String(ownStart) } : part)),
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

/** The place of the first name that an earlier name repeated, ignoring case and outer spaces. -1 when no name repeats. */
function firstTwice(names: string[]): number {
  const seen = new Set<string>();
  const list = names.map((n) => n.trim().toLowerCase());
  for (const [index, name] of list.entries()) {
    if (seen.has(name)) return index;
    seen.add(name);
  }
  return -1;
}

/**
 * The first problem of a draft (ADM-10). `key` is the word key of the message and `vars` are its values. `part` names the part that
 * holds the problem, so the editor can open it, mark the field and show the message under it. `field` is the field of that part.
 * A problem of the whole template, or of a role, has no part.
 */
export type DraftProblem = {
  key: string;
  vars: Record<string, string | number>;
  part: { kind: 'stage' | 'task' | 'role'; id: string } | null;
  field: 'name' | 'start' | 'days' | 'title' | null;
};

/** The first problem of a draft, or null. The same rules as projectTemplates.save, in the order of the editor. */
export function draftProblem(draft: TemplateDraft): DraftProblem | null {
  const E = 'projectTemplates.errors.';
  if (!draft.name.trim()) return { key: `${E}name`, vars: {}, part: null, field: 'name' };
  const unnamedRole = draft.roles.findIndex((role) => !role.name.trim());
  if (unnamedRole !== -1) return { key: `${E}roleName`, vars: { n: unnamedRole + 1 }, part: { kind: 'role', id: draft.roles[unnamedRole].id }, field: 'name' };
  const roleTwice = firstTwice(draft.roles.map((role) => role.name));
  if (roleTwice !== -1) return { key: `${E}roleTwice`, vars: { n: roleTwice + 1 }, part: { kind: 'role', id: draft.roles[roleTwice].id }, field: 'name' };
  if (draft.stages.length === 0) return { key: `${E}noStage`, vars: {}, part: null, field: null };
  const unnamedStage = draft.stages.findIndex((stage) => !stage.name.trim());
  if (unnamedStage !== -1) return { key: `${E}stageName`, vars: { n: unnamedStage + 1 }, part: { kind: 'stage', id: draft.stages[unnamedStage].id }, field: 'name' };
  const stageTwice = firstTwice(draft.stages.map((stage) => stage.name));
  if (stageTwice !== -1) return { key: `${E}stageTwice`, vars: { name: draft.stages[stageTwice].name.trim() }, part: { kind: 'stage', id: draft.stages[stageTwice].id }, field: 'name' };
  for (const [index, stage] of draft.stages.entries()) {
    const name = stage.name.trim() || String(index + 1);
    const hasStart = stage.start.trim() !== '';
    const hasDays = stage.days.trim() !== '';
    const part = { kind: 'stage' as const, id: stage.id };
    if (hasStart && !hasDays) return { key: 'projectTemplates.problem.stageDays', vars: { name }, part, field: 'days' };
    if (hasDays && !hasStart) return { key: 'projectTemplates.problem.stageStart', vars: { name }, part, field: 'start' };
    if (hasStart && !offsetOk(stage.start)) return { key: 'projectTemplates.problem.numbers', vars: { name }, part, field: 'start' };
    if (hasDays && !daysOk(stage.days)) return { key: 'projectTemplates.problem.numbers', vars: { name }, part, field: 'days' };
  }
  const untitled = draft.tasks.findIndex((task) => !task.title.trim());
  if (untitled !== -1) return { key: `${E}taskTitle`, vars: { n: untitled + 1 }, part: { kind: 'task', id: draft.tasks[untitled].id }, field: 'title' };
  for (const [index, task] of draft.tasks.entries()) {
    const part = { kind: 'task' as const, id: task.id };
    const name = task.title.trim() || String(index + 1);
    if (!offsetOk(task.start)) return { key: 'projectTemplates.problem.numbers', vars: { name }, part, field: 'start' };
    if (!daysOk(task.days)) return { key: 'projectTemplates.problem.numbers', vars: { name }, part, field: 'days' };
  }
  return null;
}

/** The first problem of a draft as a word key, or null. */
export function draftError(draft: TemplateDraft): string | null {
  return draftProblem(draft)?.key ?? null;
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

/** A part that moved later because of a new wait (ADM-08): its kind, id and name, and the day it starts on now. */
export type MovedPart = { kind: 'stage' | 'task'; id: string; name: string; start: number };

/**
 * The first working day on which a part may start, and its start now, from the numbers of the draft. A stage uses its span (its
 * own days and its tasks). A part with no valid numbers has no place, so it gives null.
 */
function placeOf(draft: TemplateDraft, kind: 'stage' | 'task', id: string): { start: number; end: number } | null {
  const plan = draftPlanTemplate(draft);
  if (kind === 'task') {
    const task = plan.tasks.find((part) => part.id === id);
    return task ? { start: task.startOffset, end: task.startOffset + task.durationDays } : null;
  }
  const stage = plan.stages.find((part) => part.id === id);
  return stage ? stageSpan(stage, plan.tasks.filter((task) => task.stageId === id)) : null;
}

/**
 * Makes `waitingId` wait for `neededId` (ADM-08). The waiting part then starts on the working day after the needed part ends, when
 * it started earlier, and the parts that wait for it move the same way. Each moved part is in `moved`, so the screen can say so
 * and offer Undo. A wait that exists already, or a part that does not exist, gives the draft back. The caller checks the limit
 * and the loops (waitsThrough).
 */
export function addWait(draft: TemplateDraft, kind: 'stage' | 'task', waitingId: string, neededId: string): { draft: TemplateDraft; moved: MovedPart[] } {
  const list = kind === 'task' ? draft.tasks : draft.stages;
  const waiting = list.find((part) => part.id === waitingId);
  if (!waiting || !list.some((part) => part.id === neededId) || (waiting.prerequisiteIds ?? []).includes(neededId)) return { draft, moved: [] };
  const linkPart = <T extends { id: string; prerequisiteIds?: string[] }>(part: T): T => (
    part.id === waitingId ? { ...part, prerequisiteIds: [...(part.prerequisiteIds ?? []), neededId] } : part
  );
  let next: TemplateDraft = kind === 'task' ? { ...draft, tasks: draft.tasks.map(linkPart) } : { ...draft, stages: draft.stages.map(linkPart) };
  const moved: MovedPart[] = [];
  // The queue holds the parts to check. A part that moves adds the parts that wait for it. No chain loops (the caller refused it).
  const queue = [waitingId];
  for (let guard = 0; queue.length > 0 && guard < 500; guard += 1) {
    const id = queue.shift()!;
    const part = (kind === 'task' ? next.tasks : next.stages).find((item) => item.id === id);
    if (!part) continue;
    const here = placeOf(next, kind, id);
    const needs = Math.max(-1, ...(part.prerequisiteIds ?? []).map((otherId) => placeOf(next, kind, otherId)?.end ?? -1));
    if (here && needs > here.start) {
      if (kind === 'task') {
        next = { ...next, tasks: next.tasks.map((task) => (task.id === id ? { ...task, start: String(clampOffset(needs)) } : task)) };
      } else {
        const shift = needs - here.start;
        const own = wholeNumber(next.stages.find((stage) => stage.id === id)?.start ?? '');
        next = shiftStage(next, id, shift, own === null ? null : clampOffset(own + shift));
      }
      const name = kind === 'task' ? next.tasks.find((task) => task.id === id)?.title : next.stages.find((stage) => stage.id === id)?.name;
      moved.push({ kind, id, name: (name ?? '').trim(), start: placeOf(next, kind, id)?.start ?? needs });
    }
    for (const other of kind === 'task' ? next.tasks : next.stages) {
      if ((other.prerequisiteIds ?? []).includes(id)) queue.push(other.id);
    }
  }
  return { draft: next, moved };
}

/**
 * Ends the wait of `waitingId` for `neededId`. The other waits of the part stay, and the key goes when no wait is left, as waitsOf
 * leaves it out. The part keeps its days: the days that the wait moved stay where they are.
 */
export function removeWait(draft: TemplateDraft, kind: 'stage' | 'task', waitingId: string, neededId: string): TemplateDraft {
  const gone = new Set([neededId]);
  const strip = <T extends { id: string; prerequisiteIds?: string[] }>(part: T): T => (part.id === waitingId ? withoutWaits(part, gone) : part);
  return kind === 'task' ? { ...draft, tasks: draft.tasks.map(strip) } : { ...draft, stages: draft.stages.map(strip) };
}
