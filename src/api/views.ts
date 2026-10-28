import { PICTURE_DATA, type Comment, type Deadline, type Event, type FileRec, type MeetingMinutes, type Payment, type Project, type ProjectMember, type Stage, type Task, type TrackerEntry, type Update, type User } from './contract/entities';
import type {
  Attachment, CommentView, EventView, FeedItem, FileView, MinutesView, ProjectDetail, ProjectSummary, PaymentRow, TaskDetail, TaskRow, TrackerRow, UserCard,
} from './contract/views';
import { assertAiSwitch } from './aiOff';
import { canSeeConversation } from './chatState';
import { namesPerson, replyRefOf } from './chatNaming';
import { computeHealth, isOverdue } from './health';
import { can, holdsRight, leadTookTask, mayViewMeeting, meetingResource, principalOf, projectResource, projectRoleOf, taskResource, type ProjectRole, type Resource } from './permissions';
import { ensureRights } from './rights';
import { mayWriteMinutes } from './meetingGates';
import { isTaskMaker, mayAssignTask, mayChangeTask, mayDeleteTask, mayTickChecklist } from './taskGates';
import { commentCountKey, fileCountKey, projectTemplatesOf, type State } from './store';
import { lineKindOf } from '../lib/commentLine';
import { diffDays } from '../lib/dates';
import { pinFromLinks } from '../lib/geo';
import { projectRef } from '../lib/projectRef';
import { helpersOf, involves } from '../lib/taskPeople';
import { openPrerequisites, openPrerequisiteStages, stagesChrono, stageTagOf, tasksChrono } from '../lib/stageFlow';
import { staleDaysOf } from './pause';

/**
 * The short form of a person in every view. Picture data (up to 24,000 characters) stays out: a list of 100 tasks would carry
 * it 100 times. The screens take the picture of a person from users.list (app/pictures.tsx).
 */
export function userCard(user: User): UserCard {
  const avatarUrl = user.avatarUrl !== null && PICTURE_DATA.test(user.avatarUrl) ? null : user.avatarUrl;
  return {
    id: user.id, name: user.name, ...(user.nameAr ? { nameAr: user.nameAr } : {}), avatarUrl, kind: user.kind, discipline: user.discipline,
    gender: user.gender,
  };
}

/** Both names of a person under one key, for a text detail of an event: "key" holds the English name, "keyAr" the Arabic one. */
export function namesUnder<K extends string>(key: K, user: User | undefined): Record<K, string> & Partial<Record<`${K}Ar`, string>> {
  const names: Record<string, string> = { [key]: user?.name ?? '' };
  if (user?.nameAr) names[`${key}Ar`] = user.nameAr;
  return names as Record<K, string> & Partial<Record<`${K}Ar`, string>>;
}

export function cardOf(state: State, userId: string): UserCard {
  const user = state.users[userId];
  return user ? userCard(user) : { id: userId, name: '?', avatarUrl: null, kind: 'human', discipline: '' };
}

/** The stages in the order the office gave them. */
export function stagesOf(state: State, projectId: string): Stage[] {
  return Object.values(state.stages).filter((s) => s.projectId === projectId).sort(byOrder);
}

const byOrder = (a: Stage, b: Stage): number => a.order - b.order;
const byDate = (a: Deadline, b: Deadline): number => a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/**
 * The rows of a project, found without a scan of the whole office for each project (speed review 2026-10-28). A view that works on
 * many projects or many to-dos builds this once for the call and passes it down. Each group is built on its first use, in one pass over
 * the collection, and keeps the order of Object.values, so a view gives the same answer with the lookups as without them. The lookups
 * belong to one call on one state: a write changes the rows, so a write never keeps them. Treat every list as read only.
 */
export type ViewIndex = {
  /** The tasks of a project, in the order of the state. */
  tasksOf(projectId: string): Task[];
  membersOf(projectId: string): ProjectMember[];
  /** The stages of a project in the order the office gave them, as stagesOf. */
  stagesOf(projectId: string): Stage[];
  /** The deadlines of a project by date, as deadlinesOf. */
  deadlinesOf(projectId: string): Deadline[];
  updatesOf(projectId: string): Update[];
  /** The changes of a project that the feed may show: not undone, and a verb of FEED_VERBS. */
  feedEventsOf(projectId: string): Event[];
};

/** A lookup by project: one pass over the rows on the first use, and "finish" runs once on a group when it is first read. */
function lookupBy<T>(rows: () => T[], projectOf: (row: T) => string | null, finish?: (group: T[]) => void): (projectId: string) => T[] {
  let groups: Map<string, T[]> | undefined;
  const finished = new Set<string>();
  return (projectId) => {
    if (!groups) {
      groups = new Map();
      for (const row of rows()) {
        const key = projectOf(row);
        if (key === null) continue;
        const group = groups.get(key);
        if (group) group.push(row);
        else groups.set(key, [row]);
      }
    }
    const group = groups.get(projectId);
    if (!group) return [];
    if (finish && !finished.has(projectId)) {
      finish(group);
      finished.add(projectId);
    }
    return group;
  };
}

export function viewIndexOf(state: State): ViewIndex {
  return {
    tasksOf: lookupBy(() => Object.values(state.tasks), (task) => task.projectId),
    membersOf: lookupBy(() => Object.values(state.members), (member) => member.projectId),
    stagesOf: lookupBy(() => Object.values(state.stages), (stage) => stage.projectId, (group) => { group.sort(byOrder); }),
    deadlinesOf: lookupBy(() => Object.values(state.deadlines), (deadline) => deadline.projectId, (group) => { group.sort(byDate); }),
    updatesOf: lookupBy(() => Object.values(state.updates), (update) => update.projectId),
    feedEventsOf: lookupBy(() => Object.values(state.events), (event) => (event.undoneBy || !FEED_VERBS.has(event.verb) ? null : event.projectId)),
  };
}

/** The stages in time order, which is how every screen lists them (owner, 2026-10-02). */
export function stagesInTime(state: State, projectId: string): Stage[] {
  return stagesChrono(stagesOf(state, projectId));
}

export function deadlinesOf(state: State, projectId: string): Deadline[] {
  return Object.values(state.deadlines).filter((d) => d.projectId === projectId).sort(byDate);
}

/** A count from State.counts when a loader put one there, else a scan of the comments in the state (plan 4.13, A4). */
export function countComments(state: State, targetType: 'task' | 'update', targetId: string): number {
  const counted = state.counts?.[commentCountKey(targetId)];
  if (counted !== undefined) return counted;
  return Object.values(state.comments).filter((c) => c.targetType === targetType && c.targetId === targetId).length;
}

/** The files of a task, from State.counts first, as countComments. */
export function countFiles(state: State, taskId: string): number {
  const counted = state.counts?.[fileCountKey(taskId)];
  if (counted !== undefined) return counted;
  return Object.values(state.files).filter((f) => f.taskId === taskId).length;
}

/** Events that show in the project feed and on the card. Posts show as "update" items. */
export const FEED_VERBS = new Set([
  'project.created', 'project.stage_changed', 'project.leader_changed', 'project.code_changed', 'project.access_changed', 'task.created', 'task.status_changed',
  'task.approved', 'task.sent_back', 'task.version_opened', 'task.reopened', 'task.dates_shifted', 'file.added', 'file.version_added', 'member.added',
  'project.template_synced', 'project.template_applied', 'meeting.created', 'meeting.updated', 'meeting.cancelled',
  // The minutes of a meeting (wave 2): on the Tracker line of a project meeting, or on the meeting itself. The mark "meeting.settled" stays out.
  'tracker.minutes_saved', 'meeting.minutes_saved',
]);

function lastLetter(value: unknown): string {
  const versions = (value as { versions?: { letter: string }[] } | null)?.versions;
  return Array.isArray(versions) && versions.length > 0 ? versions[versions.length - 1].letter : '';
}

export function eventLabel(state: State, event: Event): { label: string; detail: Record<string, string> } {
  const after = (event.after ?? {}) as Record<string, unknown>;
  const before = (event.before ?? {}) as Record<string, unknown>;
  switch (event.targetType) {
    case 'task': {
      const title = state.tasks[event.targetId]?.title
        ?? (typeof after.title === 'string' ? after.title : typeof before.title === 'string' ? before.title : '');
      const detail: Record<string, string> = {};
      if (typeof after.status === 'string') detail.status = after.status;
      // A new lead, by name, for the meeting summary.
      if (typeof after.ownerId === 'string') Object.assign(detail, namesUnder('lead', state.users[after.ownerId]));
      return { label: title, detail };
    }
    case 'tracker': {
      // A client item: its title, what it waits for, and the person who replies, for the meeting summary.
      const entry = state.tracker?.[event.targetId];
      const title = entry?.title ?? (typeof after.title === 'string' ? after.title : typeof before.title === 'string' ? before.title : '');
      const detail: Record<string, string> = {};
      if (entry?.waiting) detail.waiting = entry.waiting;
      // The minutes of a meeting (wave 2): the kind of the meeting, so the feed says "site visit" for a site visit.
      if (event.verb === 'tracker.minutes_saved' && entry?.meetingId) detail.kind = state.meetings?.[entry.meetingId]?.kind ?? 'meeting';
      if (typeof after.replyTaskId === 'string') {
        const reply = state.tasks[after.replyTaskId];
        if (reply?.ownerId) Object.assign(detail, namesUnder('person', state.users[reply.ownerId]));
      }
      return { label: title, detail };
    }
    case 'file': {
      const letter = lastLetter(event.after);
      return { label: state.files[event.targetId]?.name ?? '', detail: letter ? { version: letter } : {} };
    }
    case 'project': {
      const name = state.projects[event.targetId]?.name ?? '';
      // The Arabic name goes in detail.labelAr, as the Arabic name of a member does (owner, 2026-10-26, fbk_062).
      const nameAr = state.projects[event.targetId]?.nameAr;
      const named = (detail: Record<string, string>) => ({ label: name, detail: nameAr ? { ...detail, labelAr: nameAr } : detail });
      if (event.verb === 'project.code_changed' && typeof after.code === 'string') return named({ code: after.code });
      // One cause line for the many changes of a template update (INT-13): the name of the template.
      if (event.verb === 'project.template_synced') {
        const templateId = (after.templateLink as { templateId?: string } | null | undefined)?.templateId;
        return named({ template: (templateId && projectTemplatesOf(state)[templateId]?.name) || '' });
      }
      // The apply of a template (fbk_020): the name of the template and what came in. The event keeps the numbers (addedParts).
      if (event.verb === 'project.template_applied') {
        const templateId = (after.templateLink as { templateId?: string } | null | undefined)?.templateId;
        const added = after.addedParts as { stages?: number; tasks?: number } | undefined;
        return named({ template: (templateId && projectTemplatesOf(state)[templateId]?.name) || '', stages: String(added?.stages ?? 0), tasks: String(added?.tasks ?? 0) });
      }
      if (typeof after.currentStageId === 'string') return named({ stage: state.stages[after.currentStageId]?.name ?? '' });
      if ('leaderId' in after) {
        return named(typeof after.leaderId === 'string' ? namesUnder('leader', state.users[after.leaderId]) : { leader: '' });
      }
      return named({});
    }
    case 'meeting': {
      // The title of the meeting, for the project feed and the History (fbk_022). The kind helps a screen choose its words.
      const meeting = state.meetings?.[event.targetId];
      const title = meeting?.title ?? (typeof after.title === 'string' ? after.title : typeof before.title === 'string' ? before.title : '');
      const kind = meeting?.kind ?? (typeof after.kind === 'string' ? after.kind : typeof before.kind === 'string' ? before.kind : '');
      return { label: title, detail: kind ? { kind } : {} };
    }
    case 'member': {
      const userId = event.targetId.split(':')[1] ?? '';
      const { label, labelAr } = namesUnder('label', state.users[userId]);
      return { label, detail: labelAr ? { labelAr } : {} };
    }
    default:
      return { label: '', detail: {} };
  }
}

/** True when the viewer may edit or delete this post or comment: its author, or the person its agent acted for (spec 7.2). */
function canEditContent(state: State, projectId: string, authorId: string, viewer: User): boolean {
  return can(viewer, 'post.editOwn', { projectRole: projectRoleOf(state, projectId, viewer.id), authorId: principalOf(state, authorId) });
}

export function updateItemOf(state: State, update: Update, viewer: User): FeedItem {
  return {
    kind: 'update', id: update.id, at: update.createdAt, author: cardOf(state, update.authorId), body: update.body,
    fileIds: update.fileIds, attachments: attachmentsOf(state, update.fileIds), editedAt: update.editedAt, commentCount: countComments(state, 'update', update.id),
    canEdit: canEditContent(state, update.projectId, update.authorId, viewer),
    ...(update.decision ? { decision: true as const } : {}),
  };
}

function newestFirst(a: FeedItem, b: FeedItem): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return b.id.localeCompare(a.id);
}

/** The order of newestFirst on the raw rows: the time, then the id. Posts and changes both carry createdAt and id. */
function newestRow(a: { id: string; createdAt: string }, b: { id: string; createdAt: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return b.id.localeCompare(a.id);
}

/** The "limit" newest of the rows, in newestRow order: the same rows as a sort of all of them cut to "limit". It sorts the array it gets. */
function newestOf<T extends { id: string; createdAt: string }>(rows: T[], limit: number): T[] {
  // A long limit, or a short list, gains nothing from the walk below.
  if (!Number.isInteger(limit) || limit < 1 || limit > 32 || rows.length <= limit) return rows.sort(newestRow).slice(0, limit);
  const kept: T[] = [];
  for (const row of rows) {
    if (kept.length === limit && newestRow(row, kept[limit - 1]) >= 0) continue;
    let at = kept.length;
    while (at > 0 && newestRow(row, kept[at - 1]) < 0) at -= 1;
    kept.splice(at, 0, row);
    if (kept.length > limit) kept.pop();
  }
  return kept;
}

/**
 * mayUndo comes from the history rules, so the feed offers Undo exactly when events.undo accepts it. It picks the newest "limit" posts and the
 * newest "limit" changes before it labels any (eventLabel and mayUndo run for those rows only): the newest "limit" rows of both together are
 * among them. "index" gives the rows of the project without a scan of the office, for a view of many projects.
 */
export function feedFor(
  state: State, projectId: string, filter: 'all' | 'posts' | 'decisions' | 'tasks' | 'files', limit: number, viewer: User,
  mayUndo: (event: Event) => boolean = () => false, index?: ViewIndex,
): FeedItem[] {
  const items: FeedItem[] = [];
  if (filter === 'all' || filter === 'posts' || filter === 'decisions') {
    const updates = (index ? index.updatesOf(projectId) : Object.values(state.updates).filter((update) => update.projectId === projectId))
      .filter((update) => filter !== 'decisions' || update.decision);
    for (const update of newestOf(updates, limit)) items.push(updateItemOf(state, update, viewer));
  }
  if (filter !== 'posts' && filter !== 'decisions') {
    const events = (index ? index.feedEventsOf(projectId) : Object.values(state.events).filter((event) => event.projectId === projectId))
      .filter((event) => !event.undoneBy && FEED_VERBS.has(event.verb))
      .filter((event) => filter !== 'tasks' || event.verb.startsWith('task.'))
      .filter((event) => filter !== 'files' || event.verb.startsWith('file.'));
    for (const event of newestOf(events, limit)) {
      const { label, detail } = eventLabel(state, event);
      items.push({
        kind: 'event', id: event.id, at: event.createdAt, author: cardOf(state, event.actorId), verb: event.verb,
        targetType: event.targetType, targetId: event.targetId, label, detail, canUndo: mayUndo(event),
      });
    }
  }
  return items.sort(newestFirst).slice(0, limit);
}

/** The six powers that the old post flag stood for. */
const POST_FLAGS = ['post.create', 'comment.create', 'project.links', 'file.upload', 'file.deliver', 'tracker.log'] as const;

function viewerCanOf(viewer: User, projectRole: ProjectRole, project: Pick<Project, 'kind'>): ProjectSummary['viewerCan'] {
  const r = { projectRole };
  // An internal project has no client: no payments, no Tracker, no delivery and no code to correct (fbk_044).
  const client = project.kind !== 'internal';
  return {
    // The old flag "edit" stays for the screens of today: all six powers of a project change (role rights version 2).
    edit: (['project.details', 'project.team', 'project.stages', 'project.deadlines', 'project.template', 'project.health'] as const).every((power) => can(viewer, power, r)),
    changeLeader: can(viewer, 'project.leader', r),
    archive: can(viewer, 'project.archive', r),
    delete: can(viewer, 'project.delete', r),
    healthOverride: can(viewer, 'project.health', r),
    createTaskForAnyone: can(viewer, 'task.add', r) && can(viewer, 'task.assign'),
    createTaskForSelf: can(viewer, 'task.add', r),
    // The old flag of the first release: true only when the person posts, comments, uploads, delivers, logs and adds links here.
    // The screens read the single flags below (postUpdate, comment, upload, deliver, logTracker, links).
    post: POST_FLAGS.every((action) => can(viewer, action, r)),
    review: can(viewer, 'task.review', r),
    payments: client && can(viewer, 'payment.view'),
    // The switch alone, as before: the code field sits inside the edit sheet, which opens only where editDetails is true. The call
    // projects.update asks project.code, which also needs the details scope.
    editCode: client && holdsRight(viewer, 'project.code'),
    // Role rights version 2: one flag for each gate that a screen hides.
    editDetails: can(viewer, 'project.details', r),
    editTeam: can(viewer, 'project.team', r),
    editStages: can(viewer, 'project.stages', r),
    editDeadlines: can(viewer, 'project.deadlines', r),
    applyTemplate: can(viewer, 'project.template', r),
    links: can(viewer, 'project.links', r),
    upload: can(viewer, 'file.upload', r),
    deliver: client && can(viewer, 'file.deliver', r),
    logTracker: client && can(viewer, 'tracker.log', r),
    access: can(viewer, 'project.access', r),
    postUpdate: can(viewer, 'post.create', r),
    comment: can(viewer, 'comment.create', r),
    addTask: can(viewer, 'task.add', r),
    planMeeting: can(viewer, 'meeting.plan', { projectRole, meeting: { organizerId: viewer.id, attendeeIds: [], noProject: false } }),
    deleteAnyFile: can(viewer, 'file.deleteAny', r),
    deleteAnyTracker: can(viewer, 'tracker.deleteAny', r),
    projectChat: can(viewer, 'chat.project', r),
    changeAnyTask: can(viewer, 'task.any', r),
  };
}

/**
 * The project as a screen reads it, without the copy of the template parts that its link keeps (ADM-01). Only the template update
 * reads that copy, on the server, so a project list does not carry up to 200 descriptions for each project. It also leaves out the folders
 * (fbk_066): they travel in ProjectDetail.folders, so a list never carries the folder names of a project.
 */
function withoutBase(project: Project): Project {
  const link = project.templateLink;
  const { folders: _folders, ...shown } = project;
  if (!link?.base) return shown;
  const { base: _base, ...rest } = link;
  return { ...shown, templateLink: rest };
}

/**
 * "viewer" is the person whose rights apply: the user, or the person an agent acts for. "index" holds the lookups of the call: a list of
 * many projects passes one, so no project scans the whole office. Without it the lookups are built here, for this one project.
 */
export function summaryOf(state: State, project: Project, today: string, viewer: User, index: ViewIndex = viewIndexOf(state)): ProjectSummary {
  const stages = stagesChrono(index.stagesOf(project.id));
  const tasks = index.tasksOf(project.id);
  const deadlines = index.deadlinesOf(project.id);
  const next = deadlines.find((d) => d.date >= today) ?? [...deadlines].reverse().find((d) => d.date < today) ?? null;
  const latest = feedFor(state, project.id, 'all', 2, viewer, undefined, index);
  const newest = latest[0]?.at;
  const health = computeHealth({ project, stages, tasks }, today);
  const viewerRole = projectRoleOf(state, project.id, viewer.id);
  const cover = project.coverFileId ? state.files[project.coverFileId] : undefined;
  // The tag follows the tasks, so it is computed here and never read from the saved value.
  const currentStage = stages.length > 0 ? stageTagOf(stages, tasks) : state.stages[project.currentStageId];
  const stageEndDate = project.status === 'active' ? currentStage?.endDate : null;
  return {
    project: withoutBase(project),
    client: project.clientId ? (state.clients[project.clientId] ?? null) : null,
    health,
    healthSetBy: health?.overridden && health.setBy ? cardOf(state, health.setBy) : null,
    pausedBy: project.status === 'on_hold' && project.pause ? cardOf(state, project.pause.by) : null,
    staleDays: staleDaysOf(state, project, today),
    coverLetter: cover ? cover.versions[cover.versions.length - 1].letter : null,
    stages,
    currentStage,
    latest,
    nextDeadline: next ? { id: next.id, name: next.name, date: next.date, daysLeft: diffDays(today, next.date) } : null,
    stageEnd: stageEndDate ? { date: stageEndDate, daysLeft: diffDays(today, stageEndDate) } : null,
    subCompanyId: project.subCompanyId ?? null,
    // A pin of its own (a point, or null for a removed pin) wins. Old data has none: its location link gives the place (PRJ-04).
    geo: project.geo === undefined ? pinFromLinks(project.links) : project.geo,
    leader: project.leaderId ? cardOf(state, project.leaderId) : null,
    team: index.membersOf(project.id)
      .filter((m) => m.userId !== project.leaderId)
      .map((m) => cardOf(state, m.userId))
      .sort((a, b) => a.name.localeCompare(b.name)),
    openTasks: tasks.filter((t) => t.status !== 'done').length,
    lastActivityAt: newest && newest > project.updatedAt ? newest : project.updatedAt,
    viewerRole,
    viewerCan: viewerCanOf(viewer, viewerRole, project),
    templateId: project.templateLink?.templateId ?? null,
  };
}


export function detailOf(state: State, project: Project, today: string, viewer: User, index: ViewIndex = viewIndexOf(state)): ProjectDetail {
  const summary = summaryOf(state, project, today, viewer, index);
  // A person leads a task or helps on it. Both count, as in members.remove and the Overview (audit 2026-10-03, PRJ-3).
  const projectTasks = index.tasksOf(project.id);
  const openBy = (userId: string) => projectTasks.filter((t) => involves(t, userId) && t.status !== 'done').length;
  // A person who was removed from the lists (owner, 2026-10-12) is not in the team either; their work keeps their name.
  const members = index.membersOf(project.id)
    .filter((m) => !state.users[m.userId]?.removed)
    .map((m) => ({
      user: cardOf(state, m.userId), discipline: m.discipline, isLeader: m.userId === project.leaderId, openTasks: openBy(m.userId),
      active: state.users[m.userId]?.active ?? false,
    }))
    .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.user.name.localeCompare(b.user.name));
  // The project chat, when the viewer may open it (an outsider gets null, and no id of the chat).
  const room = Object.values(state.conversations).find((c) => c.kind === 'project' && c.projectId === project.id);
  const chatId = room && canSeeConversation(state, room, viewer) ? room.id : null;
  return { ...summary, members, deadlines: [...index.deadlinesOf(project.id)], chatId, folders: structuredClone(project.folders ?? []) };
}

export function eventViewOf(state: State, event: Event): EventView {
  return { event, actor: cardOf(state, event.actorId) };
}

/** What an open task waits for. A done task waits for nothing, and a task with no prerequisites skips the scan. An office task waits for nothing. */
function waitingOf(state: State, task: Task, index: ViewIndex): TaskRow['waitingFor'] {
  if (task.projectId === null || task.stageId === null) return { tasks: [], stages: [] };
  const stage = state.stages[task.stageId];
  if (task.status === 'done' || ((task.prerequisiteIds ?? []).length === 0 && (stage?.prerequisiteIds ?? []).length === 0)) return { tasks: [], stages: [] };
  const tasks = index.tasksOf(task.projectId);
  return {
    tasks: openPrerequisites(task, tasks).map((t) => ({ id: t.id, title: t.title })),
    stages: openPrerequisiteStages(task, index.stagesOf(task.projectId), tasks).map((s) => ({ id: s.id, name: s.name })),
  };
}

/** "index" holds the lookups of the call: a list of many rows passes one, so a row that waits on others scans no more than its project. */
export function taskRowOf(state: State, task: Task, today: string, viewer: User, index: ViewIndex = viewIndexOf(state)): TaskRow {
  const project = task.projectId === null ? undefined : state.projects[task.projectId];
  const stage = task.stageId === null ? undefined : state.stages[task.stageId];
  const resource = taskResource(state, task, viewer.id);
  return {
    task,
    owner: task.ownerId === null ? null : cardOf(state, task.ownerId),
    helpers: helpersOf(task).map((id) => cardOf(state, id)),
    // An office task has no project and no stage (owner, 2026-10-06).
    project: task.projectId === null ? null : projectRef({ id: task.projectId, code: project?.code ?? '', name: project?.name ?? '', nameAr: project?.nameAr, mark: project?.mark, shape: project?.shape }),
    stage: task.stageId === null ? null : { id: task.stageId, name: stage?.name ?? '' },
    commentCount: countComments(state, 'task', task.id),
    fileCount: countFiles(state, task.id),
    overdue: isOverdue(task, today),
    canMove: mayChangeTask(viewer, 'work', resource),
    canEditPeople: mayAssignTask(viewer, resource),
    waitingFor: waitingOf(state, task, index),
  };
}

export function taskDetailOf(state: State, task: Task, today: string, viewer: User): TaskDetail {
  const r = taskResource(state, task, viewer.id);
  // The changes of this task are read once. The history and the take check of the delete flag both use them.
  const taskEvents = Object.values(state.events).filter((e) => e.targetType === 'task' && e.targetId === task.id);
  const history = [...taskEvents].sort((a, b) => b.seq - a.seq).map((e) => eventViewOf(state, e));
  const link = (t: Task) => ({ id: t.id, title: t.title, status: t.status });
  const index = viewIndexOf(state);
  // An office task needs no task and unlocks none (owner, 2026-10-06).
  const inProject = task.projectId === null ? [] : index.tasksOf(task.projectId);
  const stages = task.projectId === null ? [] : index.stagesOf(task.projectId);
  const ids = new Set(task.prerequisiteIds ?? []);
  // Each kind of change is asked once. Six flags below read these three answers.
  const mayDetails = mayChangeTask(viewer, 'details', r);
  const mayDates = mayChangeTask(viewer, 'dates', r);
  const mayWork = mayChangeTask(viewer, 'work', r);
  return {
    ...taskRowOf(state, task, today, viewer, index),
    needsFirst: tasksChrono(inProject.filter((t) => ids.has(t.id)), stages).map(link),
    unlocks: tasksChrono(inProject.filter((t) => (t.prerequisiteIds ?? []).includes(task.id)), stages).map(link),
    viewerCan: {
      // edit: the old flag for the person who changes every kind of field; the flags editDetails, editDates and work below split it.
      edit: mayDetails && mayDates && mayWork,
      editAll: mayAssignTask(viewer, r),
      complete: mayWork && task.status !== 'done',
      review: can(viewer, 'task.review', r) && task.status === 'in_review',
      setNeedsReview: can(viewer, 'task.review', r),
      // A lead who took the task themselves does not delete it (security review 2026-10-20).
      delete: mayDeleteTask(viewer, r) && (can(viewer, 'task.any', r) || isTaskMaker(viewer, r) || !leadTookTask(state, task, taskEvents)),
      contribute: mayTickChecklist(viewer, r),
      newVersion: task.status === 'done' && mayWork,
      // A template belongs to a stage, so an office task never becomes one. It serves the whole office, so the leader and the
      // Admin save it, never the maker alone (the rule of taskTemplates.save).
      saveTemplate: task.stageId !== null && can(viewer, 'templates.taskSave', { projectRole: r.projectRole }),
      take: task.ownerId === null && task.status !== 'done' && can(viewer, 'task.take', r),
      // Joins as a helper with one tap: a person on the team who neither leads nor helps, on a project task (fbk_035).
      help: task.projectId !== null && task.ownerId !== viewer.id && !helpersOf(task).includes(viewer.id) && can(viewer, 'task.help', r),
      // Role rights version 2: one flag for each gate of the task panel. A change of any to-do (task.any) passes every kind of change.
      editDetails: mayDetails,
      editDates: mayDates,
      work: mayWork,
      comment: can(viewer, 'comment.create', r),
      upload: can(viewer, 'file.upload', r),
    },
    history,
  };
}

/** The files of a comment or a message. A deleted file keeps its place with no name and no type. */
export function attachmentsOf(state: State, fileIds: string[] | undefined): Attachment[] {
  return (fileIds ?? []).map((id) => {
    const file = state.files[id];
    return file ? { id, name: file.name, mimeType: file.versions[file.versions.length - 1].mimeType } : { id, name: null };
  });
}

/**
 * The resource of a comment or a file of an office task: the people of that task (owner, 2026-10-06). A task that is gone leaves
 * an office resource with nobody on it, so only the Admin holds rights there.
 */
export function officeResource(state: State, taskId: string | null, viewerId: string): Resource {
  const task = taskId === null ? undefined : state.tasks[taskId];
  return task ? taskResource(state, task, viewerId) : { office: true };
}

export function commentViewOf(state: State, comment: Comment, viewer: User): CommentView {
  const target = comment.targetType === 'task' ? state.tasks[comment.targetId] : state.updates[comment.targetId];
  const authorId = principalOf(state, comment.authorId);
  return {
    comment,
    author: cardOf(state, comment.authorId),
    canEdit: !target ? false : target.projectId === null
      ? can(viewer, 'post.editOwn', { ...officeResource(state, target.id, viewer.id), authorId })
      : canEditContent(state, target.projectId, comment.authorId, viewer),
    files: attachmentsOf(state, comment.fileIds),
    kind: lineKindOf(comment),
    replyTo: replyRefOf(state, comment, viewer.id),
    namesMe: namesPerson(state, comment, viewer.id),
  };
}

/**
 * The person who uploaded the file (or the person their agent acted for) while still on the project, the leader or the Admin. For
 * a file of an office task: its uploader while on the task, the maker of the task or the Admin (owner, 2026-10-06).
 */
export function mayDeleteFile(state: State, viewer: User, file: FileRec): boolean {
  // A file of a direct chat or a group stays with its messages: nobody deletes it (owner, 2026-10-19). The same for a file of a meeting.
  if (file.conversationId !== undefined || file.meetingId !== undefined) return false;
  // Both rules read switches (task.officeAll, the scope rights), so they need the attached office rights.
  const actor = ensureRights(state, viewer);
  const resource = file.projectId === null ? officeResource(state, file.taskId, viewer.id) : { projectRole: projectRoleOf(state, file.projectId, viewer.id) };
  return can(actor, 'file.deleteAny', resource)
    || can(actor, 'file.deleteOwn', { ...resource, authorId: principalOf(state, file.versions[0].uploadedBy) });
}

/**
 * True when the person may see a file: every file of a project, a file of an office task only for the people of that task, a file
 * of a direct chat or a group only for the people who read the messages of that chat (owner, 2026-10-19), and a file of a meeting
 * only for the people who see that meeting (wave 2). The Admin who is not in the chat or not invited to the meeting does not read it,
 * and a chat or a meeting that is gone leaves its files to nobody.
 */
export function mayViewFile(state: State, viewer: User, file: FileRec): boolean {
  if (file.conversationId !== undefined) {
    const conversation = state.conversations[file.conversationId];
    return conversation !== undefined && canSeeConversation(state, conversation, viewer);
  }
  if (file.meetingId !== undefined) {
    const meeting = state.meetings?.[file.meetingId];
    return meeting !== undefined && mayViewMeeting(state, viewer, meeting);
  }
  // A file of a project reads like the project: a hidden project leaves its files to the people who see it (hidden projects, owner 2026-10-22).
  if (file.projectId !== null) return can(ensureRights(state, viewer), 'project.view', projectResource(state, file.projectId, viewer.id));
  return can(ensureRights(state, viewer), 'task.view', officeResource(state, file.taskId, viewer.id));
}

/**
 * True when the actor may open the data of a file: the person who may view it. An agent acts with the rights of its person, so it opens a file
 * of a direct chat or a group when its person may (owner, 2026-10-26; before, an agent never did). It still never opens the file of a meeting
 * with no project: it reads the name in the minutes, and nothing more (owner, 2026-10-19).
 */
export function mayOpenFile(state: State, viewer: User, actor: User, file: FileRec): boolean {
  return mayViewFile(state, viewer, file) && !(file.meetingId !== undefined && actor.kind === 'agent');
}

/**
 * A file of a direct chat or a group is chat data: the agent of a member opens it only when its person holds the AI switch "AI reads chats",
 * as chats.messages needs it (security review 2026-10-26). Call it after mayOpenFile, so a person who is no member keeps the answer of a
 * missing file and learns nothing from the switch. A person at the screen needs no switch. It throws the ai_off refusal.
 */
export function assertAgentMayOpenChatFile(state: State, actor: User, viewer: User, file: FileRec): void {
  if (file.conversationId !== undefined) assertAiSwitch(actor, ensureRights(state, viewer), 'ai.readChats');
}

export function fileViewOf(state: State, file: FileRec, viewer: User): FileView {
  const latest = file.versions[file.versions.length - 1];
  return { file, latest, uploader: cardOf(state, latest.uploadedBy), canDelete: mayDeleteFile(state, viewer, file) };
}

/**
 * True when this person may delete the entry: its author (or the person an agent author acted for), the leader or the Admin. The line
 * that Madar made for a meeting (auto 'meeting') has no author delete: only the leader or the Admin deletes it, the organizer too has no
 * author right on it (security fix, 2026-10-19). The Undo of its log follows this rule too (history.ts).
 */
export function mayDeleteTracker(state: State, viewer: User, entry: TrackerEntry): boolean {
  if (!viewer.active) return false;
  const projectRole = projectRoleOf(state, entry.projectId, viewer.id);
  if (can(viewer, 'tracker.deleteAny', { projectRole })) return true;
  return entry.auto !== 'meeting' && can(viewer, 'tracker.deleteOwn', { projectRole, authorId: principalOf(state, entry.createdBy) });
}

/** The reply task of an entry. A task that was deleted counts as no task. */
export function replyTaskOf(state: State, entry: TrackerEntry): TrackerRow['replyTask'] {
  const task = entry.replyTaskId ? state.tasks[entry.replyTaskId] : undefined;
  return task ? { id: task.id, title: task.title, status: task.status, dueDate: task.dueDate, owner: task.ownerId === null ? null : cardOf(state, task.ownerId) } : null;
}

/**
 * The minutes as a screen reads them (wave 2): the text, the files that the viewer may see, and who wrote them last. A file that was
 * deleted shows with no name; a file that the viewer may not see is left out.
 */
export function minutesViewOf(state: State, minutes: MeetingMinutes, viewer: User): MinutesView {
  const visible = minutes.fileIds.filter((id) => {
    const file = state.files[id];
    return file === undefined || mayViewFile(state, viewer, file);
  });
  return { text: minutes.text, files: attachmentsOf(state, visible), updatedBy: cardOf(state, minutes.updatedBy), updatedAt: minutes.updatedAt };
}

export function trackerRowOf(state: State, entry: TrackerEntry, viewer: User): TrackerRow {
  const mayPost = can(viewer, 'tracker.log', { projectRole: projectRoleOf(state, entry.projectId, viewer.id) });
  // A close that finishes the open reply to-do also needs the switch to work on to-dos (the call asks the same).
  const replyTask = entry.replyTaskId ? state.tasks[entry.replyTaskId] : undefined;
  const mayFinishReply = !replyTask || replyTask.status === 'done' || holdsRight(viewer, 'task.work') || can(viewer, 'task.any', taskResource(state, replyTask, viewer.id));
  // The line that Madar made for a meeting that ended (wave 2) also gives the meeting, the minutes and the right to write them.
  const meeting = entry.auto === 'meeting' && entry.meetingId ? state.meetings?.[entry.meetingId] : undefined;
  const minutesPart = entry.auto === 'meeting' ? {
    meeting: entry.meetingId ? { id: entry.meetingId, title: meeting?.title ?? entry.title } : null,
    minutes: entry.minutes ? minutesViewOf(state, entry.minutes, viewer) : null,
    canEditMinutes: meeting !== undefined && meeting.status === 'scheduled' && mayWriteMinutes(viewer, meetingResource(state, meeting, viewer.id)),
  } : {};
  return {
    entry,
    createdBy: cardOf(state, entry.createdBy),
    closedBy: entry.closedBy ? cardOf(state, entry.closedBy) : null,
    people: entry.peopleIds.map((id) => cardOf(state, id)),
    files: attachmentsOf(state, entry.fileIds),
    replyTask: replyTaskOf(state, entry),
    canClose: mayPost && entry.waiting !== null && entry.closedAt === null && mayFinishReply,
    canEdit: mayPost,
    canDelete: mayDeleteTracker(state, viewer, entry),
    ...minutesPart,
  };
}

/** A milestone is overdue when its day has passed and the money has not arrived. */
export function paymentRowOf(state: State, payment: Payment, today: string): PaymentRow {
  const dueInDays = diffDays(today, payment.dueDate);
  return {
    payment,
    status: payment.receivedOn ? 'received' : dueInDays < 0 ? 'overdue' : 'awaiting',
    dueInDays,
    createdBy: cardOf(state, payment.createdBy),
  };
}
