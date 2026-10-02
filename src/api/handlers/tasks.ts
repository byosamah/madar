import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  ChecklistItem, Day, DurationDays, MAX_HELPERS, ProjectId, StageId, TaskId, TaskSchedule, TaskStatus, TaskTemplateId, UserId, type Task,
} from '../contract/entities';
import { TaskDetail, TaskRow } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { isOverdue } from '../health';
import { notify, reviewersOf } from '../notify';
import { can } from '../permissions';
import { nextId, taskTemplatesOf } from '../store';
import { taskDetailOf, taskRowOf } from '../views';
import { stampDay } from '../../lib/dates';
import { helpersOf, involves, onlyTicks, peopleOfTask, versionOf } from '../../lib/taskPeople';
import { dueFromDuration } from '../../lib/workdays';
import { assertCan, ensureOnTeam, insertComment, requireProject, requireStage, requireTask, roleIn, touch } from './shared';
import { addTrackerEntry, replyTaskDone } from './tracker';

const Title = z.string().trim().min(1).max(200);
const HelperIds = z.array(UserId).max(MAX_HELPERS);
const Reason = z.string().trim().min(1).max(280);
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

/** The date fields that differ from the task. Only these are written, so an old task is not marked changed for a field it never had. */
function whenChanges(task: Task, when: When): Partial<Task> {
  const changes: Partial<Task> = {};
  if (when.dueDate !== task.dueDate) changes.dueDate = when.dueDate;
  if (when.startDate !== (task.startDate ?? null)) changes.startDate = when.startDate;
  if (when.schedule !== (task.schedule ?? 'static')) changes.schedule = when.schedule;
  if (when.durationDays !== (task.durationDays ?? null)) changes.durationDays = when.durationDays;
  return changes;
}

/** The helper list a call ends with. No repeats, never the lead. A person outside the team joins it when the leader or the Admin asks. */
function checkHelpers(ctx: Ctx, projectId: string, leadId: string, helperIds: string[]): string[] {
  if (new Set(helperIds).size !== helperIds.length) throw invalid('helperIds', 'A person is in the helper list twice.', 'duplicate_helper');
  if (helperIds.includes(leadId)) throw invalid('helperIds', 'The lead cannot also be a helper.', 'lead_is_helper');
  for (const id of helperIds) ensureOnTeam(ctx, projectId, id, 'helperIds');
  return helperIds;
}

/** A helper ticks items. Adding, removing, renaming or moving an item is for the lead, the leader and the Admin. */
function assertTicksOnly(current: ChecklistItem[], next: ChecklistItem[]): void {
  if (!onlyTicks(current, next)) throw forbidden('A helper can tick checklist items but not add, remove or change them.');
}

const detail = (ctx: Ctx, task: Task) => taskDetailOf(ctx.state, task, ctx.today, ctx.authority);

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
  if (status === 'done') replyTaskDone(ctx, task);
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
      if (ownerId && !involves(task, ownerId)) return false;
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
          return involves(task, authority.id);
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

type NewTask = {
  projectId: string; title: string; stageId?: string; ownerId?: string; helperIds?: string[]; dueDate?: string | null; startDate?: string | null;
  schedule?: Task['schedule']; durationDays?: number | null; description: string; flagged: boolean; needsReview?: boolean; checklist?: string[];
  /** The review setting comes from a template a leader saved, so a team member may use it without the right to set it. */
  fromTemplate?: boolean;
};

/** One way to make a task, for tasks.create and tasks.createFromTemplate. The rules live here. */
function createTask(ctx: Ctx, input: NewTask): Task {
  const project = requireProject(ctx, input.projectId);
  const role = roleIn(ctx, project.id);
  // A task always belongs to a person. An agent adds tasks for the person it acts for.
  const ownerId = input.ownerId ?? ctx.authority.id;
  assertCan(ctx, ownerId === ctx.authority.id ? 'task.createForSelf' : 'task.createForAnyone', { projectRole: role });
  if ((input.needsReview !== undefined && !input.fromTemplate) || (input.helperIds ?? []).length > 0) assertCan(ctx, 'task.updateAny', { projectRole: role });
  // Only the leader or the Admin may skip the review step. A template's "no review" applies to them alone, so a team
  // member cannot skip review through a leader's template (security review, 2026-10-01).
  const needsReview = input.fromTemplate && !can(ctx.authority, 'task.updateAny', { projectRole: role }) ? true : input.needsReview ?? true;
  const stageId = input.stageId ?? project.currentStageId;
  requireStage(ctx, project.id, stageId);
  const when = resolveWhen({ startDate: null, schedule: 'static', durationDays: null, dueDate: null }, input);
  ensureOnTeam(ctx, project.id, ownerId, 'ownerId');
  const helperIds = checkHelpers(ctx, project.id, ownerId, input.helperIds ?? []);
  const id = nextId(ctx.state, 'tsk');
  const task: Task = {
    id, projectId: project.id, stageId, title: input.title, description: input.description, ownerId, status: 'todo',
    ...when, flagged: input.flagged, needsReview,
    checklist: (input.checklist ?? []).map((text) => ({ id: nextId(ctx.state, 'chk'), text, done: false })),
    createdBy: ctx.actor.id, createdAt: ctx.stamp, completedAt: null,
  };
  if (helperIds.length > 0) task.helperIds = helperIds;
  ctx.state.tasks[id] = task;
  recordCreate(ctx, { projectId: project.id, verb: 'task.created', targetType: 'task', targetId: id, entity: task });
  notify(ctx.state, ctx.actor, ctx.stamp, { userIds: peopleOfTask(task), trigger: 'task_assigned', targetType: 'task', targetId: id });
  touch(ctx, project.id);
  return task;
}

export const tasksCreate = defineCall({
  input: z.object({
    projectId: ProjectId,
    title: Title,
    stageId: StageId.optional(),
    ownerId: UserId.optional(),
    helperIds: HelperIds.optional(),
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
    return detail(ctx, createTask(ctx, input));
  },
});

/**
 * A task made from a saved template (colleague comments 8 and 12): the template's title, description, review setting and timing,
 * and its checklist with every item unticked. The stage must be the one the template was saved for. A dynamic template starts today.
 */
export const tasksCreateFromTemplate = defineCall({
  input: z.object({ templateId: TaskTemplateId, stageId: StageId, ownerId: UserId.optional(), helperIds: HelperIds.optional() }),
  output: TaskDetail,
  run(input, ctx) {
    const template = taskTemplatesOf(ctx.state)[input.templateId];
    if (!template) throw notFound('Task template', input.templateId);
    const stage = ctx.state.stages[input.stageId];
    if (!stage) throw notFound('Stage', input.stageId);
    if (stage.name.toLowerCase() !== template.stageName.toLowerCase()) {
      throw invalid('templateId', `This template is for the stage "${template.stageName}".`, 'template_other_stage');
    }
    const dynamic = template.schedule === 'dynamic';
    return detail(ctx, createTask(ctx, {
      projectId: stage.projectId, stageId: stage.id, ownerId: input.ownerId, helperIds: input.helperIds, title: template.name, description: template.description,
      flagged: false, needsReview: template.needsReview, checklist: template.checklist, fromTemplate: true,
      ...(dynamic ? { schedule: 'dynamic' as const, durationDays: template.durationDays, startDate: ctx.today } : {}),
    }));
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
      helperIds: HelperIds.optional(),
      flagged: z.boolean().optional(),
      needsReview: z.boolean().optional(),
      checklist: z.array(ChecklistItem).max(100).optional(),
    }),
  }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    const { patch } = input;
    const resource = { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId, helperIds: helpersOf(task) };
    const needsAny = patch.ownerId !== undefined || patch.needsReview !== undefined || patch.helperIds !== undefined;
    const given = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);
    if (needsAny) assertCan(ctx, 'task.updateAny', resource);
    else if (given.length > 0 && given.every((key) => key === 'checklist')) {
      // A helper may tick items. Only the lead, the leader and the Admin may change the list itself.
      assertCan(ctx, 'task.contribute', resource);
      if (!can(ctx.authority, 'task.updateOwn', resource) && patch.checklist) assertTicksOnly(task.checklist, patch.checklist);
    } else assertCan(ctx, 'task.updateOwn', resource);
    if (patch.stageId) requireStage(ctx, task.projectId, patch.stageId);
    const leadId = patch.ownerId ?? task.ownerId;
    if (patch.ownerId) ensureOnTeam(ctx, task.projectId, patch.ownerId, 'ownerId');
    const reassigned = patch.ownerId !== undefined && patch.ownerId !== task.ownerId;
    // A person who becomes the lead stops being a helper, so the lead is never in the list.
    const helperIds = patch.helperIds !== undefined
      ? checkHelpers(ctx, task.projectId, leadId, patch.helperIds)
      : reassigned && helpersOf(task).includes(leadId) ? helpersOf(task).filter((id) => id !== leadId) : undefined;
    const { startDate, schedule, durationDays, dueDate, helperIds: _helpers, ...rest } = patch;
    const when = resolveWhen(task, { startDate, schedule, durationDays, dueDate });
    const changes: Partial<Task> = { ...rest, ...whenChanges(task, when) };
    const added = (helperIds ?? []).filter((id) => !helpersOf(task).includes(id));
    if (helperIds !== undefined) {
      // Written down first, so Undo has a value to bring back for a task that never had helpers.
      task.helperIds ??= [];
      changes.helperIds = helperIds;
    }
    applyPatch(ctx, task, changes, { projectId: task.projectId, verb: reassigned ? 'task.reassigned' : 'task.updated', targetType: 'task', targetId: task.id });
    const told = [...(reassigned ? [task.ownerId] : []), ...added];
    if (told.length > 0) notify(ctx.state, ctx.actor, ctx.stamp, { userIds: told, trigger: 'task_assigned', targetType: 'task', targetId: task.id });
    touch(ctx, task.projectId);
    return detail(ctx, task);
  },
});

/**
 * A finished task opens again as the next version (colleague comment 8). It keeps its id, its comments and its files.
 * Status goes back to To do, every checklist item is unticked, and the new dates follow the usual timing rules.
 * The Tracker gets an automatic entry from the client, because new work on a finished task usually starts with the client.
 */
export const tasksNewVersion = defineCall({
  input: z.object({
    id: TaskId,
    reason: Reason,
    startDate: Day.nullable().optional(),
    schedule: TaskSchedule.optional(),
    durationDays: DurationDays.nullable().optional(),
    dueDate: Day.nullable().optional(),
  }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', { projectRole: roleIn(ctx, task.projectId), ownerId: task.ownerId });
    if (task.status !== 'done') throw invalid('id', 'Only a finished task gets a new version.', 'not_done');
    const { startDate, schedule, durationDays, dueDate } = input;
    const when = resolveWhen(task, { startDate, schedule, durationDays, dueDate });
    const n = versionOf(task) + 1;
    if (n > 50) throw invalid('id', 'A task has at most 50 versions.', 'too_many_versions');
    // The first reopening writes version 1 down, so Undo has a value to bring back.
    task.version ??= 1;
    task.versions ??= [{ n: 1, reason: '', openedAt: task.createdAt, openedBy: task.createdBy, finishedAt: null }];
    const versions = task.versions.map((v) => (v.n === n - 1 ? { ...v, finishedAt: task.completedAt } : v));
    versions.push({ n, reason: input.reason, openedAt: ctx.stamp, openedBy: ctx.actor.id, finishedAt: null });
    applyPatch(ctx, task, {
      status: 'todo', completedAt: null, version: n, versions, checklist: task.checklist.map((item) => ({ ...item, done: false })), ...whenChanges(task, when),
    }, { projectId: task.projectId, verb: 'task.version_opened', targetType: 'task', targetId: task.id });
    addTrackerEntry(ctx, {
      projectId: task.projectId, type: 'message', direction: 'in', title: `${task.title.slice(0, 150)}: version ${n}`, note: input.reason, auto: 'version',
    });
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
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: peopleOfTask(task), trigger: 'task_approved', targetType: 'task', targetId: task.id });
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
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: peopleOfTask(task), trigger: 'task_sent_back', targetType: 'task', targetId: task.id });
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
  'tasks.createFromTemplate': tasksCreateFromTemplate,
  'tasks.update': tasksUpdate,
  'tasks.newVersion': tasksNewVersion,
  'tasks.complete': tasksComplete,
  'tasks.move': tasksMove,
  'tasks.approve': tasksApprove,
  'tasks.sendBack': tasksSendBack,
  'tasks.delete': tasksDelete,
};
