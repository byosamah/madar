import type { Ctx } from './registry';
import type { DateNote, Project, Stage, Task } from './contract/entities';
import { ApiError, invalid } from './errors';
import { applyPatch } from './events';
import { notify, projectPeople } from './notify';
import type { State } from './store';
import { stagesOf } from './views';
import { insertComment } from './handlers/shared';
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
export function assertMayFinish(state: State, task: Task): void {
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

/** The prerequisites of a task must be other tasks of its project, none twice, and no task may need itself through a chain. */
export function assertTaskPrerequisites(state: State, task: Pick<Task, 'id' | 'projectId'>, ids: string[]): void {
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
  const dependents = dependentsOf(ctx.state, task);
  const byId = new Map(dependents.map((dependent) => [dependent.id, dependent]));
  const moved: Task[] = [];
  for (const move of shiftPlan(task, dependents, finishDay)) {
    const dependent = byId.get(move.id)!;
    const late = move.taskLateDays;
    const { startDate, dueDate } = move.to;
    const reason = `${task.title} finished ${workingDays(late)} late`;
    const note: DateNote = {
      from: move.from, to: move.to, reason, at: ctx.stamp, byTaskId: task.id, lateDays: late,
    };
    const from = dependent.dueDate;
    applyPatch(ctx, dependent, { startDate, dueDate, dateNotes: [...(dependent.dateNotes ?? []), note].slice(-20) }, {
      projectId: dependent.projectId, verb: 'task.dates_shifted', targetType: 'task', targetId: dependent.id, causeEventId,
    });
    insertComment(ctx, 'task', dependent.id, dependent.projectId, reason, [], {
      from: note.from, to: note.to, byTaskId: task.id, byTaskTitle: task.title.slice(0, 200), lateDays: late,
    });
    addTrackerEntry(ctx, {
      projectId: dependent.projectId, type: 'other', direction: 'none', auto: 'shift',
      title: `${dependent.title.slice(0, 160)} moved ${workingDays(move.lateDays)}`,
      note: `It needs "${task.title.slice(0, 160)}", which finished ${workingDays(late)} late. Due date moved from ${when(from)} to ${when(dueDate)}.`,
    });
    moved.push(dependent);
  }
  return moved;
}

/** "This moves the project back to X. Why?" The refusal carries the stage, so the screen can ask. */
function stageBackError(to: Stage): ApiError {
  return new ApiError('invalid_input', 'Write why the project moves back.', { fields: ['reason'], reason: 'stage_back_reason', stageId: to.id, stageName: to.name });
}

/**
 * Watches the stage tag of a project across one call. Take it before the call changes anything, and call "finish" after.
 * The tag follows the tasks. When it moves to an earlier stage, the call needs a reason (ask is true), which the Overview shows
 * until the tag moves forward again. A call that cannot move the tag back, or a change by Undo, passes ask false.
 */
export function watchStage(ctx: Ctx, projectId: string): { finish(options?: { reason?: string; ask?: boolean }): void } {
  const before = stageTag(ctx.state, projectId);
  return {
    finish({ reason, ask = true } = {}) {
      const project = ctx.state.projects[projectId];
      const after = stageTag(ctx.state, projectId);
      if (!project || !after) return;
      const order = stagesChrono(stagesOf(ctx.state, projectId)).map((stage) => stage.id);
      const moved = before !== null && before.id !== after.id;
      const back = moved && order.indexOf(after.id) < order.indexOf(before.id);
      const why = reason?.trim() ?? '';
      if (back && ask && !why) throw stageBackError(after);
      const stageBack = back && ask && before ? { fromStageId: before.id, toStageId: after.id, reason: why, by: ctx.actor.id, at: ctx.stamp } : moved ? null : (project.stageBack ?? null);
      // An older office can hold a saved stage behind the tag. The saved stage first takes the tag the call found, so the event
      // holds the stage the project moved from, and an Undo can bring back what this move cleared (audit 2026-10-03, API-5).
      if (moved && before) project.currentStageId = before.id;
      const changes: Partial<Project> = { currentStageId: after.id };
      // Only a real change is written, so a project saved before the Overview note is not marked changed for a null it never had.
      if (JSON.stringify(stageBack) !== JSON.stringify(project.stageBack ?? null)) changes.stageBack = stageBack;
      if (moved) changes.healthOverride = null;
      applyPatch(ctx, project, changes, { projectId, verb: 'project.stage_changed', targetType: 'project', targetId: projectId });
      // Only a move forward tells the team. A move back follows a person's own change, which says why (audit 2026-10-03, API-15).
      if (moved && !back) notify(ctx.state, ctx.actor, ctx.stamp, { userIds: projectPeople(ctx.state, projectId), trigger: 'stage_changed', targetType: 'project', targetId: projectId, correlationId: ctx.correlationId });
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
