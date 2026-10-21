import type { Ctx } from './registry';
import type { DateNote, Project, Stage, Task } from './contract/entities';
import { ApiError, invalid } from './errors';
import { applyPatch } from './events';
import { notifyIn, projectPeople } from './notify';
import { can } from './permissions';
import type { State } from './store';
import { stagesOf } from './views';
import { assertCan, insertComment, roleIn } from './handlers/shared';
import { addTrackerEntry } from './handlers/tracker';
import { formatDay } from '../lib/dates';
import { openPrerequisites, openPrerequisiteStages, stagesChrono, stageTagOf, shiftPlan, tasksChrono } from '../lib/stageFlow';

/**
 * How tasks and stages hold each other up (owner, 2026-10-02). A task may need other tasks first, and a stage may need other stages first.
 * Every rule lives here, so the screens and the agents get the same answer.
 */

export const tasksOfProject = (state: State, projectId: string): Task[] => Object.values(state.tasks).filter((task) => task.projectId === projectId);

/** The stage the project is in: computed from the tasks, never read from the saved value. */
export function stageTag(state: State, projectId: string): Stage | null {
  const stages = stagesOf(state, projectId);
  return stages.length === 0 ? null : stageTagOf(stages, tasksOfProject(state, projectId));
}

const names = (items: { title?: string; name?: string }[]): string => items.map((item) => item.title ?? item.name ?? '').join(', ');

/** A task is finished (done, or sent to review) only when every task and every stage it needs is done. The refusal names what is open. */
/** True when the task has a lead and no task and no stage that the task needs is open. */
export function mayFinish(state: State, task: Task): boolean {
  if (task.ownerId === null) return false;
  // An office task waits for no task and no stage (owner, 2026-10-06).
  if (task.projectId === null) return true;
  const tasks = tasksOfProject(state, task.projectId);
  return openPrerequisites(task, tasks).length === 0 && openPrerequisiteStages(task, stagesOf(state, task.projectId), tasks).length === 0;
}

/** A task with no lead cannot finish or wait for review (owner, 2026-10-05). Somebody must take it first. */
export function assertHasLead(task: Pick<Task, 'ownerId'>): void {
  if (task.ownerId === null) throw invalid('ownerId', 'This task has no lead. Give it a lead first.', 'needs_lead');
}

export function assertMayFinish(state: State, task: Task): void {
  assertHasLead(task);
  if (task.projectId === null) return;
  const tasks = tasksOfProject(state, task.projectId);
  const open = openPrerequisites(task, tasks);
  if (open.length > 0) {
    throw new ApiError('invalid_input', `Finish ${names(open)} first.`, { fields: ['id'], reason: 'prerequisite_open', names: names(open), taskIds: open.map((t) => t.id) });
  }
  const stages = openPrerequisiteStages(task, stagesOf(state, task.projectId), tasks);
  if (stages.length > 0) {
    throw new ApiError('invalid_input', `The stage ${names(stages)} still has open tasks.`, {
      fields: ['id'], reason: 'stage_prerequisite_open', names: names(stages), stageIds: stages.map((s) => s.id),
    });
  }
}

function reaches(start: string[], target: string, next: (id: string) => string[]): boolean {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...next(id));
  }
  return false;
}

/**
 * True when a chain of waits leads back to the part it starts from. "edges" maps a part to the parts it waits for, as the
 * template editor sends them. A part that waits for itself is a cycle too. A part read once is never read again.
 */
export function hasCycle(edges: ReadonlyMap<string, readonly string[]>): boolean {
  const done = new Set<string>();
  const onChain = new Set<string>();
  const visit = (id: string): boolean => {
    if (onChain.has(id)) return true;
    if (done.has(id)) return false;
    onChain.add(id);
    for (const next of edges.get(id) ?? []) if (visit(next)) return true;
    onChain.delete(id);
    done.add(id);
    return false;
  };
  for (const id of edges.keys()) if (visit(id)) return true;
  return false;
}

/** The prerequisites of a task must be other tasks of its project, none twice, and no task may need itself through a chain. */
export function assertTaskPrerequisites(state: State, task: Pick<Task, 'id' | 'projectId'>, ids: string[]): void {
  if (task.projectId === null) throw invalid('prerequisiteIds', 'An office task waits for no other task.', 'office_no_prerequisites');
  if (new Set(ids).size !== ids.length) throw invalid('prerequisiteIds', 'A task is in the list twice.', 'duplicate_prerequisite');
  for (const id of ids) {
    if (state.tasks[id]?.projectId !== task.projectId) throw invalid('prerequisiteIds', 'A prerequisite must be a task of the same project.', 'prerequisite_not_in_project');
  }
  if (reaches(ids, task.id, (id) => state.tasks[id]?.prerequisiteIds ?? [])) {
    throw invalid('prerequisiteIds', 'These tasks would wait for each other.', 'dependency_cycle');
  }
}

/** The same rules for the stages of one project. */
export function assertStagePrerequisites(state: State, stage: Pick<Stage, 'id' | 'projectId'>, ids: string[]): void {
  if (new Set(ids).size !== ids.length) throw invalid('prerequisiteIds', 'A stage is in the list twice.', 'duplicate_prerequisite');
  for (const id of ids) {
    if (state.stages[id]?.projectId !== stage.projectId) throw invalid('prerequisiteIds', 'A prerequisite must be a stage of the same project.', 'prerequisite_not_in_project');
  }
  if (reaches(ids, stage.id, (id) => state.stages[id]?.prerequisiteIds ?? [])) {
    throw invalid('prerequisiteIds', 'These stages would wait for each other.', 'dependency_cycle');
  }
}

/** The tasks that need this one first, in time order. */
export function dependentsOf(state: State, task: Task): Task[] {
  if (task.projectId === null) return [];
  const found = tasksOfProject(state, task.projectId).filter((other) => (other.prerequisiteIds ?? []).includes(task.id));
  return tasksChrono(found, stagesOf(state, task.projectId));
}

/**
 * A task that was done opens again, so every done task that needs it (and every done task that needs those) opens again too.
 * Each one is its own change in the same story, so one Undo brings them all back. "causeEventId" is the change that opened the
 * task: each reopen names it, so a story Undo can check that the cause is in the story (audit 2026-10-03, V-2).
 */
export function reopenDependents(ctx: Ctx, task: Task, causeEventId: string): Task[] {
  const queue = [task];
  const seen = new Set([task.id]);
  const reopened: Task[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as Task;
    for (const dependent of dependentsOf(ctx.state, current)) {
      if (seen.has(dependent.id)) continue;
      seen.add(dependent.id);
      queue.push(dependent);
      if (dependent.status === 'done') reopened.push(dependent);
    }
  }
  for (const dependent of reopened) {
    applyPatch(ctx, dependent, { status: 'todo', completedAt: null }, { projectId: dependent.projectId, verb: 'task.reopened', targetType: 'task', targetId: dependent.id, causeEventId });
  }
  return reopened;
}

const when = (day: string | null): string => (day ? formatDay(day, 'en', 'withWeekday') : 'no date');
const workingDays = (n: number): string => `${n} working ${n === 1 ? 'day' : 'days'}`;

/**
 * A task is done after its due day. Every dynamic task that needs it, and is not done, moves later by the working days it was late.
 * A static task never moves. Each move is written in the task and logged in the Tracker, in the same story as the finish.
 * "finishDay" is the day the owner finished, which is earlier than today for a task that waited in review.
 * "causeEventId" is the finish: each move names it (audit 2026-10-03, V-2).
 */
export function shiftDependents(ctx: Ctx, task: Task, causeEventId: string, finishDay = ctx.today): Task[] {
  // Only a task of a project has dependents: they are tasks of the same project.
  const projectId = task.projectId;
  if (projectId === null) return [];
  const dependents = dependentsOf(ctx.state, task);
  const byId = new Map(dependents.map((dependent) => [dependent.id, dependent]));
  const moved: Task[] = [];
  for (const move of shiftPlan(task, dependents, finishDay)) {
    const dependent = byId.get(move.id)!;
    const late = move.taskLateDays;
    const { startDate, dueDate } = move.to;
    const reason = `${task.title} finished ${workingDays(late)} late`;
    const note: DateNote = {
      from: move.from, to: move.to, reason, at: ctx.stamp, byTaskId: task.id, lateDays: late, forDueDate: task.dueDate ?? undefined,
    };
    const from = dependent.dueDate;
    applyPatch(ctx, dependent, { startDate, dueDate, dateNotes: [...(dependent.dateNotes ?? []), note].slice(-20) }, {
      projectId: dependent.projectId, verb: 'task.dates_shifted', targetType: 'task', targetId: dependent.id, causeEventId,
    });
    insertComment(ctx, 'task', dependent.id, dependent.projectId, reason, [], {
      from: note.from, to: note.to, byTaskId: task.id, byTaskTitle: task.title.slice(0, 200), lateDays: late,
    });
    addTrackerEntry(ctx, {
      projectId, type: 'other', direction: 'none', auto: 'shift',
      title: `${dependent.title.slice(0, 160)} moved ${workingDays(move.lateDays)}`,
      note: `It needs "${task.title.slice(0, 160)}", which finished ${workingDays(late)} late. Due date moved from ${when(from)} to ${when(dueDate)}.`,
    });
    moved.push(dependent);
  }
  return moved;
}

/**
 * "This moves the project back to X. Why?" The refusal carries the stage, so the screen can ask. It also says if the person may
 * log the move in the Tracker (tracker.log), so the screen shows the Balady tick box only to a person who may log.
 */
function stageBackError(ctx: Ctx, projectId: string, to: Stage): ApiError {
  const canLog = can(ctx.authority, 'tracker.log', { projectRole: roleIn(ctx, projectId) });
  return new ApiError('invalid_input', 'Write why the project moves back.', { fields: ['reason'], reason: 'stage_back_reason', stageId: to.id, stageName: to.name, canLog });
}

/**
 * The person ticked "Also log this in the Tracker as a Balady update" (owner, 2026-10-03, API-14): one Balady entry from a third
 * party, with the reason, in the story of the move, so one Undo takes back both. The Tracker rule for logging applies. A title
 * holds 200 characters at most, so a longer reason also goes whole into the note.
 */
function logStageBack(ctx: Ctx, projectId: string, reason: string): void {
  assertCan(ctx, 'tracker.log', { projectRole: roleIn(ctx, projectId) });
  const long = reason.length > 200;
  addTrackerEntry(ctx, {
    projectId, type: 'balady', direction: 'third_party', title: long ? `${reason.slice(0, 199).trimEnd()}…` : reason, note: long ? reason : '',
  });
}

/**
 * Watches the stage tag of a project across one call. Take it before the call changes anything, and call "finish" after.
 * The tag follows the tasks. When it moves to an earlier stage, the call needs a reason (ask is true), which the Overview shows
 * until the tag moves forward again. A call that cannot move the tag back, or a change by Undo, passes ask false.
 * "logInTracker" also logs a move back in the Tracker. It does nothing when the tag does not move back.
 */
export function watchStage(ctx: Ctx, projectId: string | null): { finish(options?: { reason?: string; ask?: boolean; logInTracker?: boolean }): void } {
  // An office task has no project, so it never moves a stage tag (owner, 2026-10-06).
  if (projectId === null) return { finish: () => undefined };
  const before = stageTag(ctx.state, projectId);
  return {
    finish({ reason, ask = true, logInTracker = false } = {}) {
      const project = ctx.state.projects[projectId];
      const after = stageTag(ctx.state, projectId);
      if (!project || !after) return;
      const order = stagesChrono(stagesOf(ctx.state, projectId)).map((stage) => stage.id);
      const moved = before !== null && before.id !== after.id;
      const back = moved && order.indexOf(after.id) < order.indexOf(before.id);
      const why = reason?.trim() ?? '';
      if (back && ask && !why) throw stageBackError(ctx, projectId, after);
      // A move back made by this call. A call that does not move the tag keeps the older note, which is not logged again (audit 2026-10-03, API-14 repair).
      const movedBack = back && ask;
      const stageBack = movedBack && before ? { fromStageId: before.id, toStageId: after.id, reason: why, by: ctx.actor.id, at: ctx.stamp } : moved ? null : (project.stageBack ?? null);
      // An older office can hold a saved stage behind the tag. The saved stage first takes the tag the call found. Then the event
      // holds the stage the project moved from, and an Undo brings back what this move cleared (audit 2026-10-03, API-5).
      if (moved && before) project.currentStageId = before.id;
      const changes: Partial<Project> = { currentStageId: after.id };
      // Only a real change is written, so a project saved before the Overview note is not marked changed for a null it never had.
      if (JSON.stringify(stageBack) !== JSON.stringify(project.stageBack ?? null)) changes.stageBack = stageBack;
      if (moved) changes.healthOverride = null;
      applyPatch(ctx, project, changes, { projectId, verb: 'project.stage_changed', targetType: 'project', targetId: projectId });
      if (movedBack && logInTracker) logStageBack(ctx, projectId, why);
      // Only a move forward tells the team. A move back follows a person's own change, which says why (audit 2026-10-03, API-15).
      if (moved && !back) notifyIn(ctx, { userIds: projectPeople(ctx.state, projectId), trigger: 'stage_changed', targetType: 'project', targetId: projectId });
    },
  };
}

/** The tag again after an Undo, with no question asked: Undo may move the project back. */
export function resyncStage(ctx: Ctx, projectId: string): void {
  const project = ctx.state.projects[projectId];
  const after = stageTag(ctx.state, projectId);
  if (!project || !after || project.currentStageId === after.id) return;
  const changes: Partial<Project> = { currentStageId: after.id, healthOverride: null };
  if (project.stageBack) changes.stageBack = null;
  applyPatch(ctx, project, changes, { projectId, verb: 'project.stage_changed', targetType: 'project', targetId: projectId });
}
