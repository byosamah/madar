import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ChecklistItem, Day, DurationDays, ProjectId, StageId, TaskId, TaskSchedule, TaskStatus, UserId, type Task } from '../contract/entities';
import { TaskDetail, TaskRow } from '../contract/views';
import { invalid } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { isOverdue } from '../health';
import { notify, reviewersOf } from '../notify';
import { can, projectRoleOf } from '../permissions';
import { nextId } from '../store';
import { taskDetailOf, taskRowOf } from '../views';
import { stampDay } from '../../lib/dates';
import { dueFromDuration } from '../../lib/workdays';
import { assertCan, insertComment, requireProject, requireStage, requireTask, roleIn, touch } from './shared';

const Title = z.string().trim().min(1).max(200);
const Moved = z.object({ result: TaskStatus, task: TaskDetail });

type When = Pick<Task, 'startDate' | 'schedule' | 'durationDays' | 'dueDate'>;
type WhenInput = { startDate?: string | null; schedule?: Task['schedule']; durationDays?: number | null; dueDate?: string | null };

/**
 * The start, mode, duration and due date a task ends with, from what it has now and what the caller sends.
 * A static task keeps the two dates people set. A dynamic task gets its due date from the start and the working days.
 * A task saved before start dates reads as no start, static, no duration.
 */
function resolveWhen(current: When, input: WhenInput): When {
  const schedule = input.schedule ?? current.schedule ?? 'static';
  const startDate = input.startDate !== undefined ? input.startDate : current.startDate ?? null;
  if (schedule === 'static') {
    const dueDate = input.dueDate !== undefined ? input.dueDate : current.dueDate;
    if (startDate && dueDate && dueDate < startDate) {
      throw invalid(input.dueDate !== undefined ? 'dueDate' : 'startDate', 'The due date cannot be before the start date.', 'due_before_start');
    }
    return { startDate, schedule, durationDays: null, dueDate };
  }
  const durationDays = input.durationDays !== undefined ? input.durationDays : current.durationDays ?? null;
  if (input.dueDate !== undefined) throw invalid('dueDate', 'A dynamic task gets its due date from the start and the duration.', 'dynamic_due_date');
  if (!startDate) throw invalid('startDate', 'A dynamic task needs a start date.', 'dynamic_needs_start');
  if (!durationDays) throw invalid('durationDays', 'A dynamic task needs a duration in working days.', 'dynamic_needs_duration');
  return { startDate, schedule, durationDays, dueDate: dueFromDuration(startDate, durationDays) };
}

const detail = (ctx: Ctx, task: Task) => taskDetailOf(ctx.state, task, ctx.today, ctx.authority);
const onProject = (ctx: Ctx, projectId: string, userId: string) => projectRoleOf(ctx.state, projectId, userId) !== 'other';

/** Spec 5.5, with clarification 2: the leader and the Admin are the reviewers, so their tick lands on Done. */
function landingStatus(ctx: Ctx, task: Task): 'done' | 'in_review' {
  const reviewer = can(ctx.authority, 'task.review', { projectRole: roleIn(ctx, task.projectId) });
  return !task.needsReview || reviewer ? 'done' : 'in_review';
}

function changeStatus(ctx: Ctx, task: Task, status: TaskStatus, verb = 'task.status_changed'): void {
  if (task.status === status) return;
  applyPatch(ctx, task, { status, completedAt: status === 'done' ? ctx.stamp : null }, {
    projectId: task.projectId, verb, targetType: 'task', targetId: task.id,
  });
  if (status === 'in_review') {
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: reviewersOf(ctx.state, task.projectId), trigger: 'review_requested', targetType: 'task', targetId: task.id });
  }
  touch(ctx, task.projectId);
}

export const tasksList = defineCall({
  input: z.object({
    projectId: ProjectId.optional(),
    ownerId: UserId.optional(),
    filter: z.enum(['all', 'mine', 'overdue', 'flagged', 'review_for_me']).default('all'),
    status: z.array(TaskStatus).optional(),
    dueFrom: Day.optional(),
    dueTo: Day.optional(),
    createdFrom: Day.optional(),
    createdTo: Day.optional(),
    doneFrom: Day.optional(),
    doneTo: Day.optional(),
    includeDone: z.boolean().default(true),
    activeProjectsOnly: z.boolean().default(true),
  }),
  output: z.array(TaskRow),
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority } = ctx;
    const { projectId, ownerId, status, dueFrom, dueTo } = input;
    const tasks = Object.values(state.tasks).filter((task) => {
      const project = state.projects[task.projectId];
      if (!project || (input.activeProjectsOnly && project.status !== 'active')) return false;
      if (projectId && task.projectId !== projectId) return false;
      if (ownerId && task.ownerId !== ownerId) return false;
      if (!input.includeDone && task.status === 'done') return false;
      if (status && !status.includes(task.status)) return false;
      if (dueFrom && (task.dueDate === null || task.dueDate < dueFrom)) return false;
      if (dueTo && (task.dueDate === null || task.dueDate > dueTo)) return false;
      const created = stampDay(task.createdAt);
      if (input.createdFrom && created < input.createdFrom) return false;
      if (input.createdTo && created > input.createdTo) return false;
      if (input.doneFrom || input.doneTo) {
        if (!task.completedAt) return false;
        const done = stampDay(task.completedAt);
        if (input.doneFrom && done < input.doneFrom) return false;
        if (input.doneTo && done > input.doneTo) return false;
      }
      switch (input.filter) {
        case 'mine':
          return task.ownerId === authority.id;
        case 'overdue':
          return isOverdue(task, today);
        case 'flagged':
          return task.flagged;
        case 'review_for_me':
          return task.status === 'in_review' && reviewersOf(state, task.projectId).includes(authority.id);
        default:
          return true;
      }
    });
    tasks.sort((a, b) =>
      (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return tasks.map((task) => taskRowOf(state, task, today, authority));
  },
});

export const tasksGet = defineCall({
  input: z.object({ id: TaskId }),
  output: TaskDetail,
  readOnly: true,
  run(input, ctx) {
    return detail(ctx, requireTask(ctx, input.id));
  },
});

export const tasksCreate = defineCall({
  input: z.object({
    projectId: ProjectId,
    title: Title,
    stageId: StageId.optional(),
    ownerId: UserId.optional(),
    dueDate: Day.nullable().optional(),
    startDate: Day.nullable().optional(),
    schedule: TaskSchedule.optional(),
    durationDays: DurationDays.nullable().optional(),
    description: z.string().max(5000).default(''),
    flagged: z.boolean().default(false),
    needsReview: z.boolean().optional(),
  }),
  output: TaskDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    const role = roleIn(ctx, project.id);
    // A task always belongs to a person. An agent adds tasks for the person it acts for.
    const ownerId = input.ownerId ?? ctx.authority.id;
    assertCan(ctx, ownerId === ctx.authority.id ? 'task.createForSelf' : 'task.createForAnyone', { projectRole: role });
    if (input.needsReview !== undefined) assertCan(ctx, 'task.updateAny', { projectRole: role });
    if (!onProject(ctx, project.id, ownerId)) throw invalid('ownerId', 'The owner must be on the project team.');
    const stageId = input.stageId ?? project.currentStageId;
    requireStage(ctx, project.id, stageId);
    const when = resolveWhen({ startDate: null, schedule: 'static', durationDays: null, dueDate: null }, input);
    const id = nextId(ctx.state, 'tsk');
    const task: Task = {
      id, projectId: project.id, stageId, title: input.title, description: input.description, ownerId, status: 'todo',
      ...when, flagged: input.flagged, needsReview: input.needsReview ?? true, checklist: [],
      createdBy: ctx.actor.id, createdAt: ctx.stamp, completedAt: null,
    };
    ctx.state.tasks[id] = task;
    recordCreate(ctx, { projectId: project.id, verb: 'task.created', targetType: 'task', targetId: id, entity: task });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [ownerId], trigger: 'task_assigned', targetType: 'task', targetId: id });
    touch(ctx, project.id);
    return detail(ctx, task);
  },
});

export const tasksUpdate = defineCall({
  input: z.object({
    id: TaskId,
    patch: z.object({
      title: Title.optional(),
      description: z.string().max(5000).optional(),
      dueDate: Day.nullable().optional(),
      startDate: Day.nullable().optional(),
      schedule: TaskSchedule.optional(),
      durationDays: DurationDays.nullable().optional(),
      stageId: StageId.optional(),
      ownerId: UserId.optional(),
      flagged: z.boolean().optional(),
      needsReview: z.boolean().optional(),
      checklist: z.array(ChecklistItem).max(100).optional(),
    }),
  }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    const { patch } = input;
    const needsAny = patch.ownerId !== undefined || patch.needsReview !== undefined;
    assertCan(ctx, needsAny ? 'task.updateAny' : 'task.updateOwn', { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId });
    if (patch.ownerId && !onProject(ctx, task.projectId, patch.ownerId)) throw invalid('ownerId', 'The owner must be on the project team.');
    if (patch.stageId) requireStage(ctx, task.projectId, patch.stageId);
    const reassigned = patch.ownerId !== undefined && patch.ownerId !== task.ownerId;
    const { startDate, schedule, durationDays, dueDate, ...rest } = patch;
    // Only the fields that change are written, so an old task is not marked changed for a field it never had.
    const when = resolveWhen(task, { startDate, schedule, durationDays, dueDate });
    const changes: Partial<Task> = { ...rest };
    if (when.dueDate !== task.dueDate) changes.dueDate = when.dueDate;
    if (when.startDate !== (task.startDate ?? null)) changes.startDate = when.startDate;
    if (when.schedule !== (task.schedule ?? 'static')) changes.schedule = when.schedule;
    if (when.durationDays !== (task.durationDays ?? null)) changes.durationDays = when.durationDays;
    applyPatch(ctx, task, changes, { projectId: task.projectId, verb: reassigned ? 'task.reassigned' : 'task.updated', targetType: 'task', targetId: task.id });
    if (reassigned) notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [task.ownerId], trigger: 'task_assigned', targetType: 'task', targetId: task.id });
    touch(ctx, task.projectId);
    return detail(ctx, task);
  },
});

export const tasksComplete = defineCall({
  input: z.object({ id: TaskId }),
  output: Moved,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId });
    if (task.status === 'done') throw invalid('id', 'This task is already done.');
    const result = landingStatus(ctx, task);
    changeStatus(ctx, task, result);
    return { result, task: detail(ctx, task) };
  },
});

export const tasksMove = defineCall({
  input: z.object({ id: TaskId, status: TaskStatus }),
  output: Moved,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId });
    const result = input.status === 'done' ? landingStatus(ctx, task) : input.status;
    changeStatus(ctx, task, result);
    return { result, task: detail(ctx, task) };
  },
});

export const tasksApprove = defineCall({
  input: z.object({ id: TaskId }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.review', { projectRole: roleIn(ctx, task.projectId) });
    if (task.status !== 'in_review') throw invalid('id', 'This task is not waiting for review.');
    changeStatus(ctx, task, 'done', 'task.approved');
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [task.ownerId], trigger: 'task_approved', targetType: 'task', targetId: task.id });
    return detail(ctx, task);
  },
});

export const tasksSendBack = defineCall({
  input: z.object({ id: TaskId, note: z.string().trim().min(1).max(2000) }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.review', { projectRole: roleIn(ctx, task.projectId) });
    if (task.status !== 'in_review') throw invalid('id', 'This task is not waiting for review.');
    changeStatus(ctx, task, 'in_progress', 'task.sent_back');
    insertComment(ctx, 'task', task.id, task.projectId, input.note);
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [task.ownerId], trigger: 'task_sent_back', targetType: 'task', targetId: task.id });
    return detail(ctx, task);
  },
});

export const tasksDelete = defineCall({
  input: z.object({ id: TaskId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.delete', { projectRole: roleIn(ctx, task.projectId) });
    recordDelete(ctx, { projectId: task.projectId, verb: 'task.deleted', targetType: 'task', targetId: task.id, entity: task });
    delete ctx.state.tasks[task.id];
    touch(ctx, task.projectId);
    return { deleted: true as const };
  },
});

export const taskCalls = {
  'tasks.list': tasksList,
  'tasks.get': tasksGet,
  'tasks.create': tasksCreate,
  'tasks.update': tasksUpdate,
  'tasks.complete': tasksComplete,
  'tasks.move': tasksMove,
  'tasks.approve': tasksApprove,
  'tasks.sendBack': tasksSendBack,
  'tasks.delete': tasksDelete,
};
