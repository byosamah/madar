import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ClientId, Day, DeadlineId, FileId, HealthValue, ProjectId, ProjectStatus, StageId, UserId, type Deadline, type Project } from '../contract/entities';
import { DeadlineRow, ProjectDetail, ProjectSummary } from '../contract/views';
import { ApiError, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { notify, projectPeople } from '../notify';
import { projectRoleOf } from '../permissions';
import { memberKey, nextId, type State } from '../store';
import { detailOf, stagesOf, summaryOf } from '../views';
import { diffDays } from '../../lib/dates';
import { assertCan, requireProject, requireStage, requireUser, roleIn, touch } from './shared';

const ProjectName = z.string().trim().min(1).max(120);
const StageName = z.string().trim().min(1).max(60);
const Location = z.string().trim().max(120);
const Area = z.number().nonnegative().max(10_000_000);
const FolderPath = z.string().trim().max(260);
const Description = z.string().max(5000);
const DeadlineName = z.string().trim().min(1).max(120);

export function nextProjectCode(state: State, prefix: string, today: string): string {
  const head = `${prefix}-${today.slice(2, 4)}-`;
  const max = Object.values(state.projects)
    .filter((p) => p.code.startsWith(head))
    .reduce((highest, p) => Math.max(highest, Number(p.code.slice(head.length))), 0);
  return `${head}${String(max + 1).padStart(3, '0')}`;
}

function assertDates(start: string | null, end: string | null, field: string): void {
  if (start && end && end <= start) throw invalid(field, 'The end date must be after the start date.');
}

function assertLeader(ctx: Ctx, userId: string): void {
  const user = ctx.state.users[userId];
  if (!user || !user.active || user.kind !== 'human') throw invalid('leaderId', 'The leader must be an active person.');
}

function addMember(ctx: Ctx, projectId: string, userId: string, discipline?: string): void {
  const key = memberKey(projectId, userId);
  if (ctx.state.members[key]) return;
  const member = { projectId, userId, discipline: discipline ?? ctx.state.users[userId].discipline };
  ctx.state.members[key] = member;
  recordCreate(ctx, { projectId, verb: 'member.added', targetType: 'member', targetId: key, entity: member });
  notify(ctx.state, ctx.actor, ctx.stamp, { userIds: [userId], trigger: 'added_to_project', targetType: 'project', targetId: projectId });
}

const detail = (ctx: Ctx, project: Project) => detailOf(ctx.state, project, ctx.today, ctx.authority);

function requireEditable(ctx: Ctx, projectId: string): Project {
  const project = requireProject(ctx, projectId);
  assertCan(ctx, 'project.edit', { projectRole: roleIn(ctx, project.id) });
  return project;
}

function requireDeadline(ctx: Ctx, id: string): Deadline {
  const deadline = ctx.state.deadlines[id];
  if (!deadline) throw notFound('Deadline', id);
  return deadline;
}

type Sorter = (a: ProjectSummary, b: ProjectSummary) => number;
const SORTS: Record<'updated' | 'deadline' | 'name', Sorter> = {
  updated: (a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : a.lastActivityAt > b.lastActivityAt ? -1 : 0),
  deadline: (a, b) => (a.nextDeadline?.date ?? '9999-12-31').localeCompare(b.nextDeadline?.date ?? '9999-12-31'),
  name: (a, b) => a.project.name.localeCompare(b.project.name),
};

export const projectsList = defineCall({
  input: z.object({
    status: z.union([ProjectStatus, z.literal('all')]).default('active'),
    filter: z.enum(['all', 'mine', 'at_risk']).default('all'),
    stageName: z.string().optional(),
    /** One health value, so each number of the dashboard's health mix opens exactly its projects (spec 8.3). */
    health: HealthValue.optional(),
    leaderId: UserId.optional(),
    clientId: ClientId.optional(),
    sort: z.enum(['updated', 'deadline', 'name']).default('updated'),
  }),
  output: z.array(ProjectSummary),
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority } = ctx;
    return Object.values(state.projects)
      .filter((p) => input.status === 'all' || p.status === input.status)
      .map((p) => summaryOf(state, p, today, ctx.authority))
      .filter((s) => input.filter !== 'mine' || projectRoleOf(state, s.project.id, authority.id) !== 'other')
      .filter((s) => input.filter !== 'at_risk' || (s.health !== null && s.health.value !== 'on_track'))
      .filter((s) => !input.stageName || s.currentStage.name === input.stageName)
      .filter((s) => !input.health || s.health?.value === input.health)
      .filter((s) => !input.leaderId || s.project.leaderId === input.leaderId)
      .filter((s) => !input.clientId || s.project.clientId === input.clientId)
      .sort(SORTS[input.sort]);
  },
});

export const projectsGet = defineCall({
  input: z.object({ id: ProjectId }),
  output: ProjectDetail,
  readOnly: true,
  run(input, ctx) {
    return detail(ctx, requireProject(ctx, input.id));
  },
});

export const projectsCreate = defineCall({
  input: z.object({
    name: ProjectName,
    clientId: ClientId.nullable().default(null),
    leader: z.union([z.literal('me'), z.literal('none'), UserId]).default('me'),
    location: Location.default(''),
    areaM2: Area.nullable().default(null),
    startDate: Day.nullable().default(null),
    targetEndDate: Day.nullable().default(null),
    stages: z.array(StageName).min(1).max(20).optional(),
    teamIds: z.array(UserId).max(50).default([]),
    modelFolderPath: FolderPath.default(''),
    description: Description.default(''),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    assertCan(ctx, 'project.create');
    const { state, actor, stamp, today } = ctx;
    assertDates(input.startDate, input.targetEndDate, 'targetEndDate');
    const leaderId = input.leader === 'me' ? ctx.authority.id : input.leader === 'none' ? null : input.leader;
    if (leaderId) assertLeader(ctx, leaderId);
    if (input.clientId && !state.clients[input.clientId]) throw invalid('clientId', 'This client does not exist.');
    for (const userId of input.teamIds) {
      const member = state.users[userId];
      if (!member?.active || member.kind !== 'human') throw invalid('teamIds', 'Every team member must be an active person. Agents act for a person.');
    }
    const id = nextId(state, 'prj');
    const stageIds = (input.stages ?? state.settings.defaultStages).map((name, order) => {
      const stageId = nextId(state, 'stg');
      state.stages[stageId] = { id: stageId, projectId: id, name, order, startDate: null, endDate: null };
      return stageId;
    });
    const project: Project = {
      id, code: nextProjectCode(state, state.settings.codePrefix, today), name: input.name, clientId: input.clientId,
      status: 'active', leaderId, currentStageId: stageIds[0], location: input.location, areaM2: input.areaM2,
      startDate: input.startDate, targetEndDate: input.targetEndDate, coverFileId: null, modelFolderPath: input.modelFolderPath,
      description: input.description, healthOverride: null, createdBy: actor.id, createdAt: stamp, updatedAt: stamp,
    };
    state.projects[id] = project;
    recordCreate(ctx, { projectId: id, verb: 'project.created', targetType: 'project', targetId: id, entity: project });
    const people = new Set([ctx.authority.id, ...(leaderId ? [leaderId] : []), ...input.teamIds]);
    for (const userId of people) addMember(ctx, id, userId);
    return detail(ctx, project);
  },
});

export const projectsUpdate = defineCall({
  input: z.object({
    id: ProjectId,
    patch: z.object({
      name: ProjectName.optional(),
      clientId: ClientId.nullable().optional(),
      location: Location.optional(),
      areaM2: Area.nullable().optional(),
      startDate: Day.nullable().optional(),
      targetEndDate: Day.nullable().optional(),
      modelFolderPath: FolderPath.optional(),
      description: Description.optional(),
      coverFileId: FileId.nullable().optional(),
    }),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.id);
    const { patch } = input;
    const start = patch.startDate !== undefined ? patch.startDate : project.startDate;
    const end = patch.targetEndDate !== undefined ? patch.targetEndDate : project.targetEndDate;
    assertDates(start, end, 'targetEndDate');
    if (patch.clientId && !ctx.state.clients[patch.clientId]) throw invalid('clientId', 'This client does not exist.');
    if (patch.coverFileId) {
      const file = ctx.state.files[patch.coverFileId];
      if (!file || file.projectId !== project.id) throw invalid('coverFileId', 'This file is not in the project.');
      if (!file.versions[file.versions.length - 1].mimeType.startsWith('image/')) throw invalid('coverFileId', 'The cover must be an image.');
    }
    applyPatch(ctx, project, patch, { projectId: project.id, verb: 'project.updated', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetStage = defineCall({
  input: z.object({ id: ProjectId, stageId: StageId }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.id);
    requireStage(ctx, project.id, input.stageId);
    if (project.currentStageId === input.stageId) return detail(ctx, project);
    applyPatch(ctx, project, { currentStageId: input.stageId, healthOverride: null }, {
      projectId: project.id, verb: 'project.stage_changed', targetType: 'project', targetId: project.id,
    });
    notify(ctx.state, ctx.actor, ctx.stamp, { userIds: projectPeople(ctx.state, project.id), trigger: 'stage_changed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetLeader = defineCall({
  input: z.object({ id: ProjectId, leaderId: UserId.nullable() }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.changeLeader', { projectRole: roleIn(ctx, project.id) });
    if (input.leaderId) {
      assertLeader(ctx, input.leaderId);
      addMember(ctx, project.id, input.leaderId);
    }
    applyPatch(ctx, project, { leaderId: input.leaderId }, { projectId: project.id, verb: 'project.leader_changed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetStatus = defineCall({
  input: z.object({ id: ProjectId, status: ProjectStatus }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.archive', { projectRole: roleIn(ctx, project.id) });
    applyPatch(ctx, project, { status: input.status }, { projectId: project.id, verb: 'project.status_changed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

/** The leader or the Admin pauses a project with a reason and an optional restart date (owner, 2026-10-01). */
export const projectsPause = defineCall({
  input: z.object({ id: ProjectId, reason: z.string().trim().min(1, 'Write why the project pauses.').max(280), resumeOn: Day.nullable().optional() }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.archive', { projectRole: roleIn(ctx, project.id) });
    if (input.resumeOn && input.resumeOn <= ctx.today) throw invalid('resumeOn', 'The restart date must be after today.');
    const pause = { reason: input.reason, resumeOn: input.resumeOn ?? null, by: ctx.actor.id, at: ctx.stamp };
    applyPatch(ctx, project, { status: 'on_hold', pause }, { projectId: project.id, verb: 'project.paused', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

/** The leader or the Admin starts a paused project again. */
export const projectsResume = defineCall({
  input: z.object({ id: ProjectId }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.archive', { projectRole: roleIn(ctx, project.id) });
    if (project.status !== 'on_hold') throw new ApiError('conflict', 'This project is not paused.');
    applyPatch(ctx, project, { status: 'active', pause: null }, { projectId: project.id, verb: 'project.resumed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsSetHealthOverride = defineCall({
  input: z.object({ id: ProjectId, value: HealthValue, reason: z.string().trim().min(1).max(280) }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.healthOverride', { projectRole: roleIn(ctx, project.id) });
    const override = { value: input.value, reason: input.reason, setBy: ctx.actor.id, setAt: ctx.stamp };
    applyPatch(ctx, project, { healthOverride: override }, { projectId: project.id, verb: 'project.health_overridden', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsClearHealthOverride = defineCall({
  input: z.object({ id: ProjectId }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.healthOverride', { projectRole: roleIn(ctx, project.id) });
    applyPatch(ctx, project, { healthOverride: null }, { projectId: project.id, verb: 'project.health_cleared', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const projectsDelete = defineCall({
  input: z.object({ id: ProjectId, confirm: z.literal(true) }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.delete', { projectRole: roleIn(ctx, project.id) });
    const { state } = ctx;
    const pid = project.id;
    const drop = <T extends { projectId: string }>(records: Record<string, T>) => {
      for (const [key, value] of Object.entries(records)) if (value.projectId === pid) delete records[key];
    };
    drop(state.stages);
    drop(state.deadlines);
    drop(state.tasks);
    drop(state.updates);
    drop(state.files);
    drop(state.members);
    for (const [key, comment] of Object.entries(state.comments)) {
      const target = comment.targetType === 'task' ? state.tasks[comment.targetId] : state.updates[comment.targetId];
      if (!target) delete state.comments[key];
    }
    for (const [key, n] of Object.entries(state.notifications)) {
      const gone = (n.targetType === 'project' && n.targetId === pid)
        || (n.targetType === 'task' && !state.tasks[n.targetId])
        || (n.targetType === 'update' && !state.updates[n.targetId]);
      if (gone) delete state.notifications[key];
    }
    delete state.projects[pid];
    recordDelete(ctx, { projectId: pid, verb: 'project.deleted', targetType: 'project', targetId: pid, entity: project });
    return { deleted: true as const };
  },
});

export const membersAdd = defineCall({
  input: z.object({ projectId: ProjectId, userId: UserId, discipline: z.string().trim().min(1).max(40).optional() }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const user = requireUser(ctx, input.userId);
    if (!user.active) throw invalid('userId', 'This person is not active.');
    if (user.kind === 'agent') throw invalid('userId', 'Agents act for a person. Add the person instead.');
    if (ctx.state.members[memberKey(project.id, user.id)]) throw invalid('userId', 'This person is already on the team.');
    addMember(ctx, project.id, user.id, input.discipline);
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const membersRemove = defineCall({
  input: z.object({ projectId: ProjectId, userId: UserId }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const key = memberKey(project.id, input.userId);
    const member = ctx.state.members[key];
    if (!member) throw notFound('Member', key);
    if (project.leaderId === input.userId) throw invalid('userId', 'Change the leader first.');
    const hasOpenTasks = Object.values(ctx.state.tasks).some((t) => t.projectId === project.id && t.ownerId === input.userId && t.status !== 'done');
    if (hasOpenTasks) throw invalid('userId', 'Give their open tasks to someone else first.');
    delete ctx.state.members[key];
    recordDelete(ctx, { projectId: project.id, verb: 'member.removed', targetType: 'member', targetId: key, entity: member });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const membersUpdate = defineCall({
  input: z.object({ projectId: ProjectId, userId: UserId, discipline: z.string().trim().min(1).max(40) }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const key = memberKey(project.id, input.userId);
    const member = ctx.state.members[key];
    if (!member) throw notFound('Member', key);
    applyPatch(ctx, member, { discipline: input.discipline }, { projectId: project.id, verb: 'member.updated', targetType: 'member', targetId: key });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const stagesReplace = defineCall({
  input: z.object({
    projectId: ProjectId,
    stages: z.array(z.object({
      id: StageId.optional(),
      name: StageName,
      startDate: Day.nullable().default(null),
      endDate: Day.nullable().default(null),
    })).min(1).max(20),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const { state } = ctx;
    const existing = stagesOf(state, project.id);
    const keep = new Set(input.stages.map((s) => s.id).filter((id): id is string => Boolean(id)));
    for (const stage of input.stages) {
      if (stage.id && state.stages[stage.id]?.projectId !== project.id) throw invalid('stages', 'A stage is not in this project.');
      if (stage.startDate && stage.endDate && stage.endDate < stage.startDate) throw invalid('stages', `The stage "${stage.name}" ends before it starts.`);
    }
    const removed = existing.filter((stage) => !keep.has(stage.id));
    for (const stage of removed) {
      const used = Object.values(state.tasks).some((t) => t.stageId === stage.id);
      if (used) throw invalid('stages', `Move the tasks out of "${stage.name}" first.`);
    }
    const before = existing.map((stage) => ({ ...stage }));
    for (const stage of removed) {
      delete state.stages[stage.id];
      for (const d of Object.values(state.deadlines)) if (d.stageId === stage.id) d.stageId = null;
      for (const f of Object.values(state.files)) if (f.stageId === stage.id) f.stageId = null;
    }
    input.stages.forEach((stage, order) => {
      const id = stage.id ?? nextId(state, 'stg');
      state.stages[id] = { id, projectId: project.id, name: stage.name, order, startDate: stage.startDate, endDate: stage.endDate };
    });
    if (!state.stages[project.currentStageId]) project.currentStageId = stagesOf(state, project.id)[0].id;
    writeEvent(ctx, {
      projectId: project.id, verb: 'project.stages_changed', targetType: 'project', targetId: project.id,
      before: { stages: before }, after: { stages: stagesOf(state, project.id) },
    });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const stagesSetDates = defineCall({
  input: z.object({ stageId: StageId, startDate: Day.nullable(), endDate: Day.nullable() }),
  output: ProjectDetail,
  run(input, ctx) {
    const stage = ctx.state.stages[input.stageId];
    if (!stage) throw notFound('Stage', input.stageId);
    const project = requireEditable(ctx, stage.projectId);
    if (input.startDate && input.endDate && input.endDate < input.startDate) throw invalid('endDate', 'The stage cannot end before it starts.');
    applyPatch(ctx, stage, { startDate: input.startDate, endDate: input.endDate }, {
      projectId: project.id, verb: 'stage.dates_changed', targetType: 'stage', targetId: stage.id,
    });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const deadlinesCreate = defineCall({
  input: z.object({ projectId: ProjectId, name: DeadlineName, date: Day, stageId: StageId.nullable().default(null) }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    if (input.stageId) requireStage(ctx, project.id, input.stageId);
    const id = nextId(ctx.state, 'ddl');
    const deadline: Deadline = { id, projectId: project.id, stageId: input.stageId, name: input.name, date: input.date };
    ctx.state.deadlines[id] = deadline;
    recordCreate(ctx, { projectId: project.id, verb: 'deadline.created', targetType: 'deadline', targetId: id, entity: deadline });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const deadlinesUpdate = defineCall({
  input: z.object({
    id: DeadlineId,
    patch: z.object({ name: DeadlineName.optional(), date: Day.optional(), stageId: StageId.nullable().optional() }),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    const deadline = requireDeadline(ctx, input.id);
    const project = requireEditable(ctx, deadline.projectId);
    if (input.patch.stageId) requireStage(ctx, project.id, input.patch.stageId);
    applyPatch(ctx, deadline, input.patch, { projectId: project.id, verb: 'deadline.updated', targetType: 'deadline', targetId: deadline.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

export const deadlinesDelete = defineCall({
  input: z.object({ id: DeadlineId }),
  output: ProjectDetail,
  run(input, ctx) {
    const deadline = requireDeadline(ctx, input.id);
    const project = requireEditable(ctx, deadline.projectId);
    delete ctx.state.deadlines[deadline.id];
    recordDelete(ctx, { projectId: project.id, verb: 'deadline.deleted', targetType: 'deadline', targetId: deadline.id, entity: deadline });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

/** Deadlines of all projects in a date range, soonest first: the dashboard's "Deadlines, next 14 days" list (spec 8.2). */
export const deadlinesList = defineCall({
  input: z.object({
    from: Day.optional(),
    to: Day.optional(),
    status: z.union([ProjectStatus, z.literal('all')]).default('active'),
  }),
  output: z.array(DeadlineRow),
  readOnly: true,
  run(input, ctx) {
    const { state, today } = ctx;
    return Object.values(state.deadlines)
      .filter((d) => {
        const project = state.projects[d.projectId];
        if (!project || (input.status !== 'all' && project.status !== input.status)) return false;
        return (!input.from || d.date >= input.from) && (!input.to || d.date <= input.to);
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((d) => {
        const project = state.projects[d.projectId];
        return { deadline: d, project: { id: project.id, code: project.code, name: project.name }, daysLeft: diffDays(today, d.date) };
      });
  },
});

export const projectCalls = {
  'deadlines.list': deadlinesList,
  'projects.list': projectsList,
  'projects.get': projectsGet,
  'projects.create': projectsCreate,
  'projects.update': projectsUpdate,
  'projects.setStage': projectsSetStage,
  'projects.setLeader': projectsSetLeader,
  'projects.setStatus': projectsSetStatus,
  'projects.pause': projectsPause,
  'projects.resume': projectsResume,
  'projects.setHealthOverride': projectsSetHealthOverride,
  'projects.clearHealthOverride': projectsClearHealthOverride,
  'projects.delete': projectsDelete,
  'members.add': membersAdd,
  'members.remove': membersRemove,
  'members.update': membersUpdate,
  'stages.replace': stagesReplace,
  'stages.setDates': stagesSetDates,
  'deadlines.create': deadlinesCreate,
  'deadlines.update': deadlinesUpdate,
  'deadlines.delete': deadlinesDelete,
};
