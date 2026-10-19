import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import {
  ChecklistItem, ClientId, Day, DurationDays, MAX_HELPERS, MAX_PREREQUISITES, ProjectId, StageId, SubCompanyId, TaskId, TaskSchedule, TaskStatus, TaskTemplateId, TeamId, UserId, type DateMove, type Task,
} from '../contract/entities';
import { TaskDetail, TaskRow } from '../contract/views';
import { ApiError, forbidden, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete } from '../events';
import { assertHasLead, assertMayFinish, assertTaskPrerequisites, reopenDependents, shiftDependents, stageTag, watchStage } from '../flow';
import { isOverdue } from '../health';
import { notifyIn, reviewersOfTask } from '../notify';
import { peopleFilter } from '../pause';
import { sentToReviewOn } from '../review';
import { can, mayViewTask, principalOf } from '../permissions';
import { nextId, taskTemplatesOf } from '../store';
import { stagesOf, taskDetailOf, taskRowOf } from '../views';
import { arrangeRanks } from '../../lib/arrange';
import { stampDay } from '../../lib/dates';
import { compareTasks, stagesChrono } from '../../lib/stageFlow';
import { helpersOf, involves, onlyTicks, peopleOfTask, versionOf } from '../../lib/taskPeople';
import { dueFromDuration } from '../../lib/workdays';
import { assertActive, assertCan, ensureOnTeam, insertComment, requireProject, requireStage, requireTask, requireUser, roleIn, taskRole, touch } from './shared';
import { addTrackerEntry, replyTaskDone } from './tracker';

const Title = z.string().trim().min(1).max(200);
const HelperIds = z.array(UserId).max(MAX_HELPERS);
const Reason = z.string().trim().min(1).max(280);
/** Why the project moves back a stage, when a change would do that. Optional: only that case needs it. */
const StageBackReason = z.string().trim().max(280).optional();
/** Also log a move back in the Tracker as a Balady update (owner, 2026-10-03, API-14). It does nothing when the project does not move back. */
const LogInTracker = z.boolean().optional();
// Why the dates of a task moved (owner, 2026-10-02). It goes to the task's Conversation, so it is never empty.
const DateReason = z.string().trim().min(1).max(280).optional();
const PrerequisiteIds = z.array(TaskId).max(MAX_PREREQUISITES);
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

/** Only a person leads or helps on an office task: never an agent, which acts for a person (owner, 2026-10-06). */
function assertPerson(ctx: Ctx, userId: string, field: 'ownerId' | 'helperIds'): void {
  if (requireUser(ctx, userId).kind === 'agent') throw invalid(field, 'Only a person can lead or help on a task.', 'not_a_person');
}

/**
 * A person who leads or helps on a task: on the team of a project task (ensureOnTeam), and a person, not an agent, on an office
 * task, which has no team.
 */
function ensureMayWork(ctx: Ctx, projectId: string | null, userId: string, field: 'ownerId' | 'helperIds'): void {
  if (projectId === null) assertPerson(ctx, userId, field);
  else ensureOnTeam(ctx, projectId, userId, field);
}

/** The helper list a call ends with. No repeats, never the lead. A person outside the team joins it when the leader or the Admin asks. */
function checkHelpers(ctx: Ctx, projectId: string | null, leadId: string | null, helperIds: string[]): string[] {
  if (new Set(helperIds).size !== helperIds.length) throw invalid('helperIds', 'A person is in the helper list twice.', 'duplicate_helper');
  if (leadId !== null && helperIds.includes(leadId)) throw invalid('helperIds', 'The lead cannot also be a helper.', 'lead_is_helper');
  for (const id of helperIds) ensureMayWork(ctx, projectId, id, 'helperIds');
  return helperIds;
}

/** The maker of a task: the person who made it, or the person of the agent that made it. The maker reviews an office task. */
const makerOf = (ctx: Ctx, task: Pick<Task, 'createdBy'>): string => principalOf(ctx.state, task.createdBy);

/** An office task needs review only when its maker is not its lead (owner, 2026-10-06). */
function reviewByMaker(): ApiError {
  return invalid('needsReview', 'The maker reviews an office task, so a task that its maker leads needs no review.', 'review_by_maker');
}

/** An office task has no stage (owner, 2026-10-06). */
function officeNoStage(): ApiError {
  return invalid('stageId', 'An office task belongs to no project, so it has no stage.', 'office_no_stage');
}

/** A helper ticks items. Adding, removing, renaming or moving an item is for the lead, the leader and the Admin. */
function assertTicksOnly(current: ChecklistItem[], next: ChecklistItem[]): void {
  if (!onlyTicks(current, next)) throw forbidden('A helper can tick checklist items but not add, remove or change them.');
}

const detail = (ctx: Ctx, task: Task) => taskDetailOf(ctx.state, task, ctx.today, ctx.authority);

/**
 * Spec 5.5, with clarification 2: the leader and the Admin are the reviewers, so their tick lands on Done. An office task goes to its
 * maker, so the tick of the maker (or the Admin) lands on Done, and a task that its maker leads needs no review.
 */
function landingStatus(ctx: Ctx, task: Task): 'done' | 'in_review' {
  const reviewer = can(ctx.authority, 'task.review', taskRole(ctx, task));
  const needs = task.needsReview && !(task.projectId === null && task.ownerId === makerOf(ctx, task));
  return !needs || reviewer ? 'done' : 'in_review';
}

/**
 * The day the owner finished: the day the task last went to review, or today. Time in review is not the owner's lateness
 * (audit 2026-10-03, API-4).
 */
function finishedOn(ctx: Ctx, task: Task): string {
  if (task.status !== 'in_review') return ctx.today;
  return sentToReviewOn(ctx.state, new Set([task.id])).get(task.id) ?? ctx.today;
}

/**
 * One way to change a status. A task is finished (done, or sent to review) only when what it needs is done. A task that was done and
 * opens again opens the done tasks that need it. A task that becomes done late moves the dynamic tasks that need it.
 */
export function changeStatus(ctx: Ctx, task: Task, status: TaskStatus, verb = 'task.status_changed'): void {
  if (task.status === status) return;
  if (status === 'done' || status === 'in_review') assertMayFinish(ctx.state, task);
  const wasDone = task.status === 'done';
  const finishDay = status === 'done' ? finishedOn(ctx, task) : ctx.today;
  const cause = applyPatch(ctx, task, { status, completedAt: status === 'done' ? ctx.stamp : null }, {
    projectId: task.projectId, verb, targetType: 'task', targetId: task.id,
  })!;
  if (wasDone && status !== 'done') reopenDependents(ctx, task, cause.id);
  if (status === 'done') shiftDependents(ctx, task, cause.id, finishDay);
  if (status === 'done') replyTaskDone(ctx, task);
  if (status === 'in_review') {
    notifyIn(ctx, { userIds: reviewersOfTask(ctx.state, task), trigger: 'review_requested', targetType: 'task', targetId: task.id });
  }
  touch(ctx, task.projectId);
}

export const tasksList = defineCall({
  input: z.object({
    projectId: ProjectId.optional(),
    ownerId: UserId.optional(),
    /** no_lead: only the tasks with no lead (owner, 2026-10-05). no_date: only the tasks with no due date (owner, 2026-10-06). */
    filter: z.enum(['all', 'mine', 'overdue', 'flagged', 'review_for_me', 'no_lead', 'no_date']).default('all'),
    status: z.array(TaskStatus).optional(),
    dueFrom: Day.optional(),
    dueTo: Day.optional(),
    createdFrom: Day.optional(),
    createdTo: Day.optional(),
    doneFrom: Day.optional(),
    doneTo: Day.optional(),
    includeDone: z.boolean().default(true),
    activeProjectsOnly: z.boolean().default(true),
    /**
     * Only the tasks of the projects that this office team works on: the same rule as the Dashboard, so a number and the list it
     * opens agree. A team that does not exist matches nothing (audit 2026-10-03, V-37a).
     */
    teamId: TeamId.optional(),
    /** Only the tasks of the projects that this person leads, or of this client: the Dashboard filters (owner, 2026-10-06). */
    leaderId: UserId.optional(),
    clientId: ClientId.optional(),
    /** Only the tasks of the projects of one sub-company: the Dashboard filter (INT-09). */
    subCompanyId: SubCompanyId.optional(),
    /**
     * The work of one person, as the People tab of the Dashboard counts it (owner, 2026-10-06): the open tasks the person leads
     * or helps on that are not in review, and the tasks in review that the person reviews (reviewersOf). A task in review passes
     * the due range only when the range holds today, because the Dashboard counts it in the first week.
     */
    workOf: UserId.optional(),
  }),
  output: z.array(TaskRow),
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority } = ctx;
    const { projectId, ownerId, status, dueFrom, dueTo } = input;
    const inFilters = peopleFilter(state, input);
    // An office task belongs to no project, so a project filter leaves it out. It shows only to its people and the Admin (owner, 2026-10-06).
    const officeIn = !projectId && !input.leaderId && !input.clientId && !input.teamId && !input.subCompanyId;
    const tasks = Object.values(state.tasks).filter((task) => {
      if (task.projectId === null) {
        if (!officeIn || !mayViewTask(state, authority, task)) return false;
      } else {
        const project = state.projects[task.projectId];
        if (!project || (input.activeProjectsOnly && project.status !== 'active')) return false;
        if (!inFilters(project)) return false;
        if (projectId && task.projectId !== projectId) return false;
      }
      if (ownerId && !involves(task, ownerId)) return false;
      if (!input.includeDone && task.status === 'done') return false;
      if (status && !status.includes(task.status)) return false;
      const review = input.workOf !== undefined && task.status === 'in_review';
      if (input.workOf && !(review ? reviewersOfTask(state, task).includes(input.workOf) : task.status !== 'done' && involves(task, input.workOf))) return false;
      // A review is due now for its reviewer, so it passes a range that holds today.
      const dueOn = review ? today : task.dueDate;
      if (dueFrom && (dueOn === null || dueOn < dueFrom)) return false;
      if (dueTo && (dueOn === null || dueOn > dueTo)) return false;
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
          return task.status === 'in_review' && reviewersOfTask(state, task).includes(authority.id);
        case 'no_lead':
          return task.ownerId === null;
        case 'no_date':
          return task.dueDate === null;
        default:
          return true;
      }
    });
    // Time order (owner, 2026-10-02): start date, then due date, then the stage's place in time, then the title.
    const rank = new Map<string, number>();
    for (const projectKey of new Set(tasks.map((task) => task.projectId))) {
      if (projectKey !== null) stagesChrono(stagesOf(state, projectKey)).forEach((stage, index) => rank.set(stage.id, index));
    }
    tasks.sort((a, b) => compareTasks(a, b, (id) => (id === null ? 0 : rank.get(id) ?? 0)));
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
  /** None: an office task (owner, 2026-10-06). */
  projectId?: string; title: string; stageId?: string; ownerId?: string; helperIds?: string[]; dueDate?: string | null; startDate?: string | null;
  schedule?: Task['schedule']; durationDays?: number | null; description: string; flagged: boolean; needsReview?: boolean; checklist?: string[];
  prerequisiteIds?: string[]; reason?: string; logInTracker?: boolean;
  /** The review setting comes from a template a leader saved, so a team member may use it without the right to set it. */
  fromTemplate?: boolean;
};

/**
 * An office task (owner, 2026-10-06): no project, no stage, no prerequisites, so no stage move and no Tracker entry. Anyone makes
 * one for anyone: the person who makes it is its maker and reviews it, when another person leads it.
 */
function createOfficeTask(ctx: Ctx, input: NewTask): Task {
  if (input.stageId) throw officeNoStage();
  if ((input.prerequisiteIds ?? []).length > 0) throw invalid('prerequisiteIds', 'An office task waits for no other task.', 'office_no_prerequisites');
  const maker = ctx.authority.id;
  const ownerId = input.ownerId ?? null;
  assertCan(ctx, ownerId === null || ownerId === maker ? 'task.createForSelf' : 'task.createForAnyone', { office: true, makerId: maker });
  if (ownerId !== null) assertPerson(ctx, ownerId, 'ownerId');
  for (const helperId of input.helperIds ?? []) assertPerson(ctx, helperId, 'helperIds');
  if (ownerId !== null) assertActive(ctx, ownerId, 'ownerId');
  for (const helperId of input.helperIds ?? []) assertActive(ctx, helperId, 'helperIds');
  const helperIds = checkHelpers(ctx, null, ownerId, input.helperIds ?? []);
  // The maker reviews, so the review need is on only when another person leads it, unless the call says otherwise.
  const needsReview = input.needsReview ?? (ownerId !== null && ownerId !== maker);
  if (needsReview && ownerId === maker) throw reviewByMaker();
  const when = resolveWhen({ startDate: null, schedule: 'static', durationDays: null, dueDate: null }, input);
  const id = nextId(ctx.state, 'tsk');
  const task: Task = {
    id, projectId: null, stageId: null, title: input.title, description: input.description, ownerId, status: 'todo',
    ...when, flagged: input.flagged, needsReview,
    checklist: (input.checklist ?? []).map((text) => ({ id: nextId(ctx.state, 'chk'), text, done: false })),
    createdBy: ctx.actor.id, createdAt: ctx.stamp, completedAt: null,
  };
  if (helperIds.length > 0) task.helperIds = helperIds;
  ctx.state.tasks[id] = task;
  recordCreate(ctx, { projectId: null, verb: 'task.created', targetType: 'task', targetId: id, entity: task });
  notifyIn(ctx, { userIds: peopleOfTask(task), trigger: 'task_assigned', targetType: 'task', targetId: id });
  return task;
}

/** One way to make a task, for tasks.create and tasks.createFromTemplate. The rules live here. */
function createTask(ctx: Ctx, input: NewTask): Task {
  if (input.projectId === undefined) return createOfficeTask(ctx, input);
  const project = requireProject(ctx, input.projectId);
  const role = roleIn(ctx, project.id);
  // A new task has no lead unless the call names one (owner, 2026-10-05). Anyone on the team may add a task and name any team mate
  // as its lead and helpers, because its maker holds the leader's rights on it (owner, 2026-10-07). Only the leader and the Admin
  // name a person outside the team (ensureOnTeam). An agent names the person it acts for as itself.
  const ownerId = input.ownerId ?? null;
  assertCan(ctx, ownerId === null || ownerId === ctx.authority.id ? 'task.createForSelf' : 'task.createForAnyone', { projectRole: role });
  // Only "no review" needs the reviewer's right. The default value is safe for anyone to send (audit 2026-10-03, API-21).
  if (input.needsReview === false && !input.fromTemplate) assertCan(ctx, 'task.review', { projectRole: role });
  // Only the leader or the Admin may skip the review step. A template's "no review" applies to them alone, so a team
  // member cannot skip review through a leader's template (security review, 2026-10-01).
  const needsReview = input.fromTemplate && !can(ctx.authority, 'task.review', { projectRole: role }) ? true : input.needsReview ?? true;
  const stageId = input.stageId ?? stageTag(ctx.state, project.id)?.id ?? project.currentStageId;
  requireStage(ctx, project.id, stageId);
  const watch = watchStage(ctx, project.id);
  const when = resolveWhen({ startDate: null, schedule: 'static', durationDays: null, dueDate: null }, input);
  if (ownerId !== null) assertActive(ctx, ownerId, 'ownerId');
  for (const helperId of input.helperIds ?? []) assertActive(ctx, helperId, 'helperIds');
  if (ownerId !== null) ensureOnTeam(ctx, project.id, ownerId, 'ownerId');
  const helperIds = checkHelpers(ctx, project.id, ownerId, input.helperIds ?? []);
  const id = nextId(ctx.state, 'tsk');
  const prerequisiteIds = input.prerequisiteIds ?? [];
  assertTaskPrerequisites(ctx.state, { id, projectId: project.id }, prerequisiteIds);
  const task: Task = {
    id, projectId: project.id, stageId, title: input.title, description: input.description, ownerId, status: 'todo',
    ...when, flagged: input.flagged, needsReview,
    checklist: (input.checklist ?? []).map((text) => ({ id: nextId(ctx.state, 'chk'), text, done: false })),
    createdBy: ctx.actor.id, createdAt: ctx.stamp, completedAt: null,
  };
  if (helperIds.length > 0) task.helperIds = helperIds;
  if (prerequisiteIds.length > 0) task.prerequisiteIds = prerequisiteIds;
  ctx.state.tasks[id] = task;
  recordCreate(ctx, { projectId: project.id, verb: 'task.created', targetType: 'task', targetId: id, entity: task });
  notifyIn(ctx, { userIds: peopleOfTask(task), trigger: 'task_assigned', targetType: 'task', targetId: id });
  // A new open task in an earlier stage moves the project back, and that needs a reason.
  watch.finish({ reason: input.reason, logInTracker: input.logInTracker });
  touch(ctx, project.id);
  return task;
}

export const tasksCreate = defineCall({
  input: z.object({
    /** None: an office task, which belongs to no project (owner, 2026-10-06). */
    projectId: ProjectId.optional(),
    title: Title,
    stageId: StageId.optional(),
    ownerId: UserId.optional(),
    helperIds: HelperIds.optional(),
    prerequisiteIds: PrerequisiteIds.optional(),
    dueDate: Day.nullable().optional(),
    startDate: Day.nullable().optional(),
    schedule: TaskSchedule.optional(),
    durationDays: DurationDays.nullable().optional(),
    description: z.string().max(5000).default(''),
    flagged: z.boolean().default(false),
    needsReview: z.boolean().optional(),
    reason: StageBackReason,
    logInTracker: LogInTracker,
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
  input: z.object({
    templateId: TaskTemplateId, stageId: StageId, ownerId: UserId.optional(), helperIds: HelperIds.optional(), reason: StageBackReason, logInTracker: LogInTracker,
  }),
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
      flagged: false, needsReview: template.needsReview, checklist: template.checklist, fromTemplate: true, reason: input.reason, logInTracker: input.logInTracker,
      ...(dynamic ? { schedule: 'dynamic' as const, durationDays: template.durationDays, startDate: ctx.today } : {}),
    }));
  },
});

/**
 * The move a change makes to the dates of a task, or null. A date that was empty and gets its first value is not a move:
 * only a start or a due date that had a value and now has another one (or none) needs a reason.
 */
export function dateMoveOf(task: Task, changes: Partial<Task>): DateMove | null {
  const from = { startDate: task.startDate ?? null, dueDate: task.dueDate };
  const to = {
    startDate: 'startDate' in changes ? changes.startDate ?? null : from.startDate,
    dueDate: 'dueDate' in changes ? changes.dueDate ?? null : from.dueDate,
  };
  const moved = (key: 'startDate' | 'dueDate') => from[key] !== null && to[key] !== from[key];
  return moved('startDate') || moved('dueDate') ? { from, to } : null;
}

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
      /** Null takes the lead off the task (owner, 2026-10-05). A task in review or done keeps its lead. */
      ownerId: UserId.nullable().optional(),
      helperIds: HelperIds.optional(),
      prerequisiteIds: PrerequisiteIds.optional(),
      flagged: z.boolean().optional(),
      needsReview: z.boolean().optional(),
      checklist: z.array(ChecklistItem).max(100).optional(),
    }),
    reason: StageBackReason,
    logInTracker: LogInTracker,
    dateReason: DateReason,
  }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    const { patch } = input;
    const resource = taskRole(ctx, task);
    const needsAny = patch.ownerId !== undefined || patch.helperIds !== undefined || patch.prerequisiteIds !== undefined;
    const given = Object.keys(patch).filter((key) => patch[key as keyof typeof patch] !== undefined);
    // The review need belongs to the reviewer: the leader and the Admin, or the maker of an office task (owner, 2026-10-07).
    if (patch.needsReview !== undefined) assertCan(ctx, 'task.review', resource);
    if (needsAny) assertCan(ctx, 'task.updateAny', resource);
    else if (given.length > 0 && given.every((key) => key === 'checklist')) {
      // A helper may tick items. Only the lead, the leader and the Admin may change the list itself.
      assertCan(ctx, 'task.contribute', resource);
      if (!can(ctx.authority, 'task.updateOwn', resource) && patch.checklist) assertTicksOnly(task.checklist, patch.checklist);
    } else assertCan(ctx, 'task.updateOwn', resource);
    if (task.projectId === null && patch.stageId !== undefined) throw officeNoStage();
    if (patch.stageId && task.projectId !== null) requireStage(ctx, task.projectId, patch.stageId);
    if (patch.prerequisiteIds !== undefined) {
      assertTaskPrerequisites(ctx.state, task, patch.prerequisiteIds);
      // A finished task cannot start to wait for an open one: reopen it first.
      if (task.status === 'done' || task.status === 'in_review') {
        const open = patch.prerequisiteIds.map((id) => ctx.state.tasks[id]).filter((other) => other.status !== 'done');
        if (open.length > 0) {
          throw new ApiError('invalid_input', `Finish ${open.map((other) => other.title).join(', ')} first.`, {
            fields: ['prerequisiteIds'], reason: 'prerequisite_open', names: open.map((other) => other.title).join(', '),
          });
        }
      }
    }
    const watch = watchStage(ctx, task.projectId);
    const leadId = patch.ownerId !== undefined ? patch.ownerId : task.ownerId;
    // A task in review or done keeps its lead, because a task with no lead cannot be finished (owner, 2026-10-05).
    if (patch.ownerId === null && (task.status === 'in_review' || task.status === 'done')) assertHasLead({ ownerId: null });
    if (patch.ownerId) ensureMayWork(ctx, task.projectId, patch.ownerId, 'ownerId');
    const reassigned = patch.ownerId !== undefined && patch.ownerId !== task.ownerId;
    // Only a person newly named must be active. A helper who left keeps their place on the task.
    if (reassigned && leadId !== null) assertActive(ctx, leadId, 'ownerId');
    for (const helperId of patch.helperIds ?? []) if (!helpersOf(task).includes(helperId)) assertActive(ctx, helperId, 'helperIds');
    // A person who becomes the lead stops being a helper, so the lead is never in the list.
    const helperIds = patch.helperIds !== undefined
      ? checkHelpers(ctx, task.projectId, leadId, patch.helperIds)
      : reassigned && leadId !== null && helpersOf(task).includes(leadId) ? helpersOf(task).filter((id) => id !== leadId) : undefined;
    const { startDate, schedule, durationDays, dueDate, helperIds: _helpers, ...rest } = patch;
    const when = resolveWhen(task, { startDate, schedule, durationDays, dueDate });
    const changes: Partial<Task> = { ...rest, ...whenChanges(task, when) };
    // An office task that its maker leads needs no review: a new lead who is the maker turns the review need off (owner, 2026-10-06).
    if (task.projectId === null && (patch.needsReview ?? task.needsReview) && leadId === makerOf(ctx, task)) {
      if (patch.needsReview === true) throw reviewByMaker();
      changes.needsReview = false;
    }
    const move = dateMoveOf(task, changes);
    if (move && !input.dateReason) {
      // The refusal carries the move, so the screen can show what changes while it asks why.
      throw new ApiError('invalid_input', 'Write why the dates change.', { fields: ['dateReason'], reason: 'date_reason_needed', from: move.from, to: move.to });
    }
    const added = (helperIds ?? []).filter((id) => !helpersOf(task).includes(id));
    if (helperIds !== undefined) {
      // Written down first, so Undo has a value to bring back for a task that never had helpers.
      task.helperIds ??= [];
      changes.helperIds = helperIds;
    }
    applyPatch(ctx, task, changes, { projectId: task.projectId, verb: reassigned ? 'task.reassigned' : 'task.updated', targetType: 'task', targetId: task.id });
    // Moving an open task into an earlier stage moves the project back, and that needs a reason.
    watch.finish({ reason: input.reason, logInTracker: input.logInTracker });
    if (move && input.dateReason) insertComment(ctx, 'task', task.id, task.projectId, input.dateReason, [], move);
    // The new lead hears of it. A lead taken off tells nobody.
    const told = [...(reassigned && task.ownerId !== null ? [task.ownerId] : []), ...added];
    if (told.length > 0) notifyIn(ctx, { userIds: told, trigger: 'task_assigned', targetType: 'task', targetId: task.id });
    touch(ctx, task.projectId);
    return detail(ctx, task);
  },
});

/**
 * A person on the project team takes the lead of a task with no lead (owner, 2026-10-05). An agent takes it for the person it
 * acts for. A taker who helps on the task stops being a helper. An Admin outside the team joins it, as for a change of lead.
 * The change is a change of lead, so the History and the meeting summary name it, and the taker can give it back with Undo.
 */
export const tasksTake = defineCall({
  input: z.object({ taskId: TaskId }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.taskId);
    assertCan(ctx, 'task.take', taskRole(ctx, task));
    if (task.ownerId !== null) throw invalid('taskId', 'This task has a lead already.', 'has_lead');
    const leadId = ctx.authority.id;
    ensureMayWork(ctx, task.projectId, leadId, 'ownerId');
    const changes: Partial<Task> = { ownerId: leadId };
    if (helpersOf(task).includes(leadId)) changes.helperIds = helpersOf(task).filter((id) => id !== leadId);
    // The maker who takes an office task needs nobody's review but their own, so the review need goes off (owner, 2026-10-06).
    if (task.projectId === null && task.needsReview && leadId === makerOf(ctx, task)) changes.needsReview = false;
    applyPatch(ctx, task, changes, { projectId: task.projectId, verb: 'task.reassigned', targetType: 'task', targetId: task.id });
    touch(ctx, task.projectId);
    return detail(ctx, task);
  },
});

/** The most tasks in one new order: more than any date group of one person holds. */
export const MAX_ARRANGE = 200;

/**
 * The shared order of the tasks inside a date group of the Tasks screen and Home (owner, 2026-10-07). `ids` is the new order,
 * top first; `moved` names the task that the person dragged. Each task needs the right to change it (`task.updateOwn`): its
 * lead, its maker, the leader or the Admin. Only the place numbers change (`lib/arrange.ts`), never a date, a status or a lead.
 */
export const tasksArrange = defineCall({
  input: z.object({
    ids: z.array(TaskId).min(1).max(MAX_ARRANGE).refine((ids) => new Set(ids).size === ids.length, 'Name each task once.'),
    moved: TaskId.optional(),
  }),
  output: z.array(z.object({ id: TaskId, rank: z.number() })),
  run(input, ctx) {
    const tasks = input.ids.map((id) => requireTask(ctx, id));
    for (const task of tasks) assertCan(ctx, 'task.updateOwn', taskRole(ctx, task));
    if (input.moved !== undefined && !input.ids.includes(input.moved)) throw invalid('moved', 'The moved task is not in the list.', 'not_in_list');
    const ranks = arrangeRanks(tasks.map((task) => task.rank), input.moved === undefined ? undefined : input.ids.indexOf(input.moved));
    tasks.forEach((task, i) => {
      // A task with no place yet records null as its old place, so an Undo gives it back no place.
      if (task.rank === undefined) task.rank = null;
      applyPatch(ctx, task, { rank: ranks[i] }, { projectId: task.projectId, verb: 'task.arranged', targetType: 'task', targetId: task.id });
    });
    return tasks.map((task, i) => ({ id: task.id, rank: ranks[i] }));
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
    logInTracker: LogInTracker,
  }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', taskRole(ctx, task));
    if (task.status !== 'done') throw invalid('id', 'Only a finished task gets a new version.', 'not_done');
    const { startDate, schedule, durationDays, dueDate } = input;
    const when = resolveWhen(task, { startDate, schedule, durationDays, dueDate });
    const n = versionOf(task) + 1;
    if (n > 50) throw invalid('id', 'A task has at most 50 versions.', 'too_many_versions');
    // The first reopening writes version 1 down, so Undo has a value to bring back.
    task.version ??= 1;
    task.versions ??= [{ n: 1, reason: '', openedAt: task.createdAt, openedBy: task.createdBy, finishedAt: null }];
    const watch = watchStage(ctx, task.projectId);
    const versions = task.versions.map((v) => (v.n === n - 1 ? { ...v, finishedAt: task.completedAt } : v));
    versions.push({ n, reason: input.reason, openedAt: ctx.stamp, openedBy: ctx.actor.id, finishedAt: null });
    const opened = applyPatch(ctx, task, {
      status: 'todo', completedAt: null, version: n, versions, checklist: task.checklist.map((item) => ({ ...item, done: false })), ...whenChanges(task, when),
    }, { projectId: task.projectId, verb: 'task.version_opened', targetType: 'task', targetId: task.id })!;
    reopenDependents(ctx, task, opened.id);
    // The reason is one quiet line of the thread: "<Person> reopened the task: <reason>". It is no message of a person (fbk_027).
    insertComment(ctx, 'task', task.id, task.projectId, input.reason, [], undefined, 'reopened');
    // The reason for the new version is also the reason the project moves back, when it does.
    watch.finish({ reason: input.reason, logInTracker: input.logInTracker });
    // An office task has no client, so it has no Tracker (owner, 2026-10-06).
    if (task.projectId !== null) {
      addTrackerEntry(ctx, {
        projectId: task.projectId, type: 'message', direction: 'in', title: `${task.title.slice(0, 150)}: version ${n}`, note: input.reason, auto: 'version',
      });
    }
    touch(ctx, task.projectId);
    return detail(ctx, task);
  },
});

/**
 * A reviewer's Done on a task in review is an approval, by the Approve button, the status menu, the board or the tick: the same
 * event and the same notice to the owner (audit 2026-10-03, PRJ-2).
 */
function approve(ctx: Ctx, task: Task): void {
  const watch = watchStage(ctx, task.projectId);
  changeStatus(ctx, task, 'done', 'task.approved');
  watch.finish({ ask: false });
  notifyIn(ctx, { userIds: peopleOfTask(task), trigger: 'task_approved', targetType: 'task', targetId: task.id });
}

const reviews = (ctx: Ctx, task: Task): boolean => task.status === 'in_review' && can(ctx.authority, 'task.review', taskRole(ctx, task));

export const tasksComplete = defineCall({
  input: z.object({ id: TaskId }),
  output: Moved,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', taskRole(ctx, task));
    if (task.status === 'done') throw invalid('id', 'This task is already done.');
    const result = landingStatus(ctx, task);
    if (result === 'done' && reviews(ctx, task)) approve(ctx, task);
    else {
      const watch = watchStage(ctx, task.projectId);
      changeStatus(ctx, task, result);
      watch.finish({ ask: false });
    }
    return { result, task: detail(ctx, task) };
  },
});

export const tasksMove = defineCall({
  input: z.object({ id: TaskId, status: TaskStatus, reason: StageBackReason, logInTracker: LogInTracker }),
  output: Moved,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.updateOwn', taskRole(ctx, task));
    const result = input.status === 'done' ? landingStatus(ctx, task) : input.status;
    if (result === 'done' && reviews(ctx, task)) approve(ctx, task);
    else {
      // A reviewer sends a task in review back only by Send back, with a note that tells the owner why. The owner may still pull
      // their own task back, also an owner who may review it (audit 2026-10-03, PRJ-2).
      if ((result === 'todo' || result === 'in_progress') && reviews(ctx, task) && task.ownerId !== ctx.authority.id) {
        throw invalid('status', 'Use Send back and write a note for the lead.', 'review_send_back');
      }
      const watch = watchStage(ctx, task.projectId);
      changeStatus(ctx, task, result);
      // Opening a done task again (and the done tasks that need it) can move the project back, and that needs a reason.
      watch.finish({ reason: input.reason, logInTracker: input.logInTracker });
    }
    return { result, task: detail(ctx, task) };
  },
});

export const tasksApprove = defineCall({
  input: z.object({ id: TaskId }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.review', taskRole(ctx, task));
    if (task.status !== 'in_review') throw invalid('id', 'This task is not waiting for review.');
    approve(ctx, task);
    return detail(ctx, task);
  },
});

export const tasksSendBack = defineCall({
  input: z.object({ id: TaskId, note: z.string().trim().min(1).max(2000) }),
  output: TaskDetail,
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.review', taskRole(ctx, task));
    if (task.status !== 'in_review') throw invalid('id', 'This task is not waiting for review.');
    const watch = watchStage(ctx, task.projectId);
    changeStatus(ctx, task, 'in_progress', 'task.sent_back');
    watch.finish({ ask: false });
    insertComment(ctx, 'task', task.id, task.projectId, input.note);
    notifyIn(ctx, { userIds: peopleOfTask(task), trigger: 'task_sent_back', targetType: 'task', targetId: task.id });
    return detail(ctx, task);
  },
});

export const tasksDelete = defineCall({
  input: z.object({ id: TaskId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const task = requireTask(ctx, input.id);
    assertCan(ctx, 'task.delete', taskRole(ctx, task));
    const watch = watchStage(ctx, task.projectId);
    recordDelete(ctx, { projectId: task.projectId, verb: 'task.deleted', targetType: 'task', targetId: task.id, entity: task });
    delete ctx.state.tasks[task.id];
    // A deleted template task stays dropped, so a later template update does not add it again. Its Undo takes the part back (fbk_008 item 4).
    const project = task.projectId ? ctx.state.projects[task.projectId] : undefined;
    if (project?.templateLink && task.templatePartId) {
      const droppedPartIds = [...new Set([...project.templateLink.droppedPartIds, task.templatePartId])];
      project.templateLink = { ...project.templateLink, droppedPartIds };
    }
    watch.finish({ ask: false });
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
  'tasks.take': tasksTake,
  'tasks.arrange': tasksArrange,
  'tasks.newVersion': tasksNewVersion,
  'tasks.complete': tasksComplete,
  'tasks.move': tasksMove,
  'tasks.approve': tasksApprove,
  'tasks.sendBack': tasksSendBack,
  'tasks.delete': tasksDelete,
};
