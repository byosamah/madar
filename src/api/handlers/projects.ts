import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { ClientId, Day, DeadlineId, FileId, HealthValue, LinkKind, linkUrlOk, MAX_PREREQUISITES, PauseKind, ProjectId, ProjectStatus, StageId, TeamId, UserId, type Deadline, type Project } from '../contract/entities';
import { DeadlineRow, ProjectDetail, ProjectSummary } from '../contract/views';
import { ApiError, invalid, notFound } from '../errors';
import { addProjectConversation, dropProjectConversation } from '../chatState';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { assertStagePrerequisites, watchStage } from '../flow';
import { notify, projectPeople } from '../notify';
import { teamFilter } from '../pause';
import { projectRoleOf } from '../permissions';
import { memberKey, nextId, paymentsOf, teamsOf, trackerOf, type State } from '../store';
import { detailOf, stagesOf, summaryOf } from '../views';
import { diffDays } from '../../lib/dates';
import { markOf, pickMark } from '../../lib/projectMark';
import { involves } from '../../lib/taskPeople';
import { addMember, assertCan, requireProject, requireStage, requireUser, roleIn, touch } from './shared';
import { addTrackerEntry } from './tracker';

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
    /** A project matches when any person of the team leads it or is on its team (colleague comment 15). */
    teamId: TeamId.optional(),
    sort: z.enum(['updated', 'deadline', 'name']).default('updated'),
  }),
  output: z.array(ProjectSummary),
  readOnly: true,
  run(input, ctx) {
    const { state, today, authority } = ctx;
    const inTeam = teamFilter(state, input.teamId);
    // The filters that read only the project come first, so the summary is built only for the projects that stay.
    return Object.values(state.projects)
      .filter((p) => input.status === 'all' || p.status === input.status)
      .filter((p) => input.filter !== 'mine' || projectRoleOf(state, p.id, authority.id) !== 'other')
      .filter((p) => !input.leaderId || p.leaderId === input.leaderId)
      .filter((p) => !input.clientId || p.clientId === input.clientId)
      .filter(inTeam)
      .map((p) => summaryOf(state, p, today, authority))
      .filter((s) => input.filter !== 'at_risk' || (s.health !== null && s.health.value !== 'on_track'))
      .filter((s) => !input.stageName || s.currentStage.name === input.stageName)
      .filter((s) => !input.health || s.health?.value === input.health)
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
    contractStartDate: Day.nullable().default(null),
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
      startDate: input.startDate, targetEndDate: input.targetEndDate, contractStartDate: input.contractStartDate, coverFileId: null, modelFolderPath: input.modelFolderPath,
      description: input.description, healthOverride: null, mark: pickMark(id, Object.values(state.projects)),
      createdBy: actor.id, createdAt: stamp, updatedAt: stamp,
    };
    state.projects[id] = project;
    recordCreate(ctx, { projectId: id, verb: 'project.created', targetType: 'project', targetId: id, entity: project });
    const people = new Set([ctx.authority.id, ...(leaderId ? [leaderId] : []), ...input.teamIds]);
    for (const userId of people) addMember(ctx, id, userId);
    addProjectConversation(state, id, stamp);
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
      contractStartDate: Day.nullable().optional(),
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
      if (!file.versions[file.versions.length - 1].mimeType.startsWith('image/')) throw invalid('coverFileId', 'The cover must be an image.', 'cover_not_image');
    }
    applyPatch(ctx, project, patch, { projectId: project.id, verb: 'project.updated', targetType: 'project', targetId: project.id });
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

/**
 * A pause ends, by Resume or by another status: the pause goes, and the open entry of a client pause closes with it. An entry that a
 * person already closed, changed or deleted stays as it is.
 */
function endPause(ctx: Ctx, project: Project, status: Project['status'], verb: string): void {
  const waiting = project.pause?.trackerId ? trackerOf(ctx.state)[project.pause.trackerId] : undefined;
  applyPatch(ctx, project, { status, pause: null }, { projectId: project.id, verb, targetType: 'project', targetId: project.id });
  if (waiting && waiting.waiting === 'client' && waiting.closedAt === null) {
    applyPatch(ctx, waiting, { closedAt: ctx.stamp, closedBy: ctx.actor.id }, { projectId: project.id, verb: 'tracker.closed', targetType: 'tracker', targetId: waiting.id });
  }
}

export const projectsSetStatus = defineCall({
  input: z.object({ id: ProjectId, status: ProjectStatus }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.archive', { projectRole: roleIn(ctx, project.id) });
    // A pause needs a reason (owner decision D7), so it goes through projects.pause. A paused project that is completed or
    // archived ends its pause as Resume does, so no "waiting for the client" item stays open (audit 2026-10-03, API-8).
    if (input.status === 'on_hold' && project.status !== 'on_hold') throw invalid('status', 'Use Pause project and write why the project pauses.', 'pause_needs_reason');
    if (project.status === 'on_hold' && input.status !== 'on_hold') endPause(ctx, project, input.status, 'project.status_changed');
    else applyPatch(ctx, project, { status: input.status }, { projectId: project.id, verb: 'project.status_changed', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

/** A Tracker title is shorter than a pause reason. The whole reason then goes in the note. */
const TITLE_MAX = 200;

/**
 * The leader or the Admin pauses a project with a reason and an optional restart date (owner, 2026-10-01).
 * "internal" is the office's own pause. "client" says the project waits for the client: the pause then logs a Tracker
 * entry that waits for the client, so it shows in "Waiting for the client" and in the Overview (colleague comment 16).
 */
export const projectsPause = defineCall({
  input: z.object({
    id: ProjectId,
    reason: z.string().trim().min(1, 'Write why the project pauses.').max(280),
    resumeOn: Day.nullable().optional(),
    kind: PauseKind.default('internal'),
  }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.id);
    assertCan(ctx, 'project.archive', { projectRole: roleIn(ctx, project.id) });
    if (project.status === 'on_hold') throw new ApiError('conflict', 'This project is already paused. Resume it first.');
    if (input.resumeOn && input.resumeOn <= ctx.today) throw invalid('resumeOn', 'The restart date must be after today.');
    const pause: NonNullable<Project['pause']> = { reason: input.reason, resumeOn: input.resumeOn ?? null, by: ctx.actor.id, at: ctx.stamp, kind: input.kind };
    if (input.kind === 'client') {
      const long = input.reason.length > TITLE_MAX;
      // The entry comes first, so an Undo takes the pause away first and then the entry that the pause points to.
      pause.trackerId = addTrackerEntry(ctx, {
        projectId: project.id, type: 'message', direction: 'out', waiting: 'client',
        title: long ? `${input.reason.slice(0, TITLE_MAX - 1)}…` : input.reason, note: long ? input.reason : '',
      }).id;
    }
    applyPatch(ctx, project, { status: 'on_hold', pause }, { projectId: project.id, verb: 'project.paused', targetType: 'project', targetId: project.id });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

const LinkLabel = z.string().trim().max(80);
const LinkUrl = z.string().trim().min(1, 'Paste the link.').max(500);

function assertLink(kind: LinkKind, url: string) {
  if (linkUrlOk(kind, url)) return;
  throw invalid('url', kind === 'folder' ? 'Use a web link (https://...) or an office network path (\\\\SERVER\\folder).' : 'Use a web link that starts with https://.');
}

function requireLink(project: Project, linkId: string) {
  const link = (project.links ?? []).find((item) => item.id === linkId);
  if (!link) throw notFound('Link', linkId);
  return link;
}

function saveLinks(ctx: Ctx, project: Project, links: Project['links']) {
  applyPatch(ctx, project, { links }, { projectId: project.id, verb: 'project.updated', targetType: 'project', targetId: project.id });
  touch(ctx, project.id);
  return detail(ctx, project);
}

/** The leader and the team add a link to a place outside Madar; everyone who opens the project can use it (colleague comment 5). */
export const projectsAddLink = defineCall({
  input: z.object({ projectId: ProjectId, kind: LinkKind, label: LinkLabel.default(''), url: LinkUrl }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, project.id) });
    assertLink(input.kind, input.url);
    const links = project.links ?? [];
    if (links.length >= 20) throw invalid('url', 'A project holds up to 20 links.');
    return saveLinks(ctx, project, [...links, { id: nextId(ctx.state, 'lnk'), kind: input.kind, label: input.label, url: input.url }]);
  },
});

export const projectsUpdateLink = defineCall({
  input: z.object({ projectId: ProjectId, linkId: z.string(), kind: LinkKind.optional(), label: LinkLabel.optional(), url: LinkUrl.optional() }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, project.id) });
    const link = requireLink(project, input.linkId);
    const next = { ...link, ...(input.kind ? { kind: input.kind } : {}), ...(input.label !== undefined ? { label: input.label } : {}), ...(input.url ? { url: input.url } : {}) };
    assertLink(next.kind, next.url);
    return saveLinks(ctx, project, (project.links ?? []).map((item) => (item.id === link.id ? next : item)));
  },
});

export const projectsRemoveLink = defineCall({
  input: z.object({ projectId: ProjectId, linkId: z.string() }),
  output: ProjectDetail,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertCan(ctx, 'content.post', { projectRole: roleIn(ctx, project.id) });
    requireLink(project, input.linkId);
    return saveLinks(ctx, project, (project.links ?? []).filter((item) => item.id !== input.linkId));
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
    // The wait is over, so the open entry of a client pause closes with the pause.
    endPause(ctx, project, 'active', 'project.resumed');
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

/** Every stored file data key of a project: its files now, and the versions its file events remember. */
function blobKeysOf(state: State, projectId: string): string[] {
  const keys = new Set<string>();
  const add = (value: unknown) => {
    for (const version of (value as { versions?: { blobKey?: string }[] } | null)?.versions ?? []) if (version.blobKey) keys.add(version.blobKey);
  };
  for (const file of Object.values(state.files)) if (file.projectId === projectId) add(file);
  for (const event of Object.values(state.events)) {
    if (event.projectId !== projectId || event.targetType !== 'file') continue;
    add(event.before);
    add(event.after);
  }
  return [...keys];
}

export const projectsDelete = defineCall({
  input: z.object({ id: ProjectId, confirm: z.literal(true) }),
  output: z.object({ deleted: z.literal(true) }),
  async prepare(input, p) {
    return { blobKeys: blobKeysOf(p.state, input.id) };
  },
  // A deleted project never comes back, so its stored file data goes after the delete (audit 2026-10-03, API-17).
  // A key that a file of another project still uses stays.
  async after(_output, p, prepared) {
    const used = new Set(Object.values(p.state.files).flatMap((file) => file.versions.map((version) => version.blobKey)));
    for (const key of prepared.blobKeys) if (!used.has(key)) await p.persister.deleteBlob(key);
  },
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
    drop(paymentsOf(state));
    // A Tracker entry has no meaning without its project (audit 2026-10-03, API-17).
    drop(trackerOf(state));
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
    dropProjectConversation(state, pid);
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

/**
 * Adds every active person of an office team who is not on the project yet (colleague comment 15). The rules are those of
 * members.add: only a person who may edit the project does it, and each new person gets the same notice. It says how many it added.
 */
export const membersAddTeam = defineCall({
  input: z.object({ projectId: ProjectId, teamId: TeamId }),
  output: z.object({ detail: ProjectDetail, added: z.number().int().min(0) }),
  run(input, ctx) {
    const project = requireEditable(ctx, input.projectId);
    const team = teamsOf(ctx.state)[input.teamId];
    if (!team) throw notFound('Team', input.teamId);
    let added = 0;
    for (const userId of team.memberIds) {
      const user = ctx.state.users[userId];
      if (!user?.active || user.kind !== 'human' || ctx.state.members[memberKey(project.id, userId)]) continue;
      addMember(ctx, project.id, userId);
      added += 1;
    }
    if (added > 0) touch(ctx, project.id);
    return { detail: detail(ctx, project), added };
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
    const hasOpenTasks = Object.values(ctx.state.tasks).some((t) => t.projectId === project.id && involves(t, input.userId) && t.status !== 'done');
    // The reason has its own words on the screen, so the person knows what to do (audit 2026-10-03, PRJ-3).
    if (hasOpenTasks) throw invalid('userId', 'Give their open tasks to someone else first.', 'member_has_open_tasks');
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
      if (used) throw invalid('stages', `Move the tasks out of "${stage.name}" first.`, 'stage_has_tasks');
    }
    const before = existing.map((stage) => ({ ...stage }));
    const watch = watchStage(ctx, project.id);
    for (const stage of removed) {
      delete state.stages[stage.id];
      for (const d of Object.values(state.deadlines)) if (d.stageId === stage.id) d.stageId = null;
      for (const f of Object.values(state.files)) if (f.stageId === stage.id) f.stageId = null;
    }
    input.stages.forEach((stage, order) => {
      const id = stage.id ?? nextId(state, 'stg');
      // A kept stage keeps the stages it needs, minus any stage that is gone.
      const needs = (state.stages[id]?.prerequisiteIds ?? []).filter((other) => keep.has(other));
      state.stages[id] = { id, projectId: project.id, name: stage.name, order, startDate: stage.startDate, endDate: stage.endDate, ...(needs.length > 0 ? { prerequisiteIds: needs } : {}) };
    });
    writeEvent(ctx, {
      projectId: project.id, verb: 'project.stages_changed', targetType: 'project', targetId: project.id,
      before: { stages: before }, after: { stages: stagesOf(state, project.id) },
    });
    // The tag follows the stages and the tasks, so a new first stage or a new date order can change it.
    watch.finish({ ask: false });
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
    const watch = watchStage(ctx, project.id);
    applyPatch(ctx, stage, { startDate: input.startDate, endDate: input.endDate }, {
      projectId: project.id, verb: 'stage.dates_changed', targetType: 'stage', targetId: stage.id,
    });
    // The dates set the order of the stages, so they can change the tag. A date change never asks for a reason.
    watch.finish({ ask: false });
    touch(ctx, project.id);
    return detail(ctx, project);
  },
});

/** The stages a stage needs first. No task of the stage can be finished while one of them has an open task. The leader and the Admin set them. */
export const stagesSetPrerequisites = defineCall({
  input: z.object({ stageId: StageId, prerequisiteIds: z.array(StageId).max(MAX_PREREQUISITES) }),
  output: ProjectDetail,
  run(input, ctx) {
    const stage = ctx.state.stages[input.stageId];
    if (!stage) throw notFound('Stage', input.stageId);
    const project = requireEditable(ctx, stage.projectId);
    assertStagePrerequisites(ctx.state, stage, input.prerequisiteIds);
    applyPatch(ctx, stage, { prerequisiteIds: input.prerequisiteIds }, {
      projectId: project.id, verb: 'stage.prerequisites_changed', targetType: 'stage', targetId: stage.id,
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
    /** Only the deadlines of the projects that this office team works on, as the Dashboard counts them (audit 2026-10-03, V-37a). */
    teamId: TeamId.optional(),
  }),
  output: z.array(DeadlineRow),
  readOnly: true,
  run(input, ctx) {
    const { state, today } = ctx;
    const inTeam = teamFilter(state, input.teamId);
    return Object.values(state.deadlines)
      .filter((d) => {
        const project = state.projects[d.projectId];
        if (!project || (input.status !== 'all' && project.status !== input.status)) return false;
        if (!inTeam(project)) return false;
        return (!input.from || d.date >= input.from) && (!input.to || d.date <= input.to);
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
      .map((d) => {
        const project = state.projects[d.projectId];
        return { deadline: d, project: { id: project.id, code: project.code, name: project.name, mark: markOf(project) }, daysLeft: diffDays(today, d.date) };
      });
  },
});

export const projectCalls = {
  'deadlines.list': deadlinesList,
  'projects.list': projectsList,
  'projects.get': projectsGet,
  'projects.create': projectsCreate,
  'projects.update': projectsUpdate,
  'projects.setLeader': projectsSetLeader,
  'projects.setStatus': projectsSetStatus,
  'projects.pause': projectsPause,
  'projects.resume': projectsResume,
  'projects.addLink': projectsAddLink,
  'projects.updateLink': projectsUpdateLink,
  'projects.removeLink': projectsRemoveLink,
  'projects.setHealthOverride': projectsSetHealthOverride,
  'projects.clearHealthOverride': projectsClearHealthOverride,
  'projects.delete': projectsDelete,
  'members.add': membersAdd,
  'members.addTeam': membersAddTeam,
  'members.remove': membersRemove,
  'members.update': membersUpdate,
  'stages.replace': stagesReplace,
  'stages.setDates': stagesSetDates,
  'stages.setPrerequisites': stagesSetPrerequisites,
  'deadlines.create': deadlinesCreate,
  'deadlines.update': deadlinesUpdate,
  'deadlines.delete': deadlinesDelete,
};
