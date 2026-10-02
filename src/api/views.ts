import type { Comment, Deadline, Event, FileRec, Payment, Project, Stage, Task, TrackerEntry, Update, User } from './contract/entities';
import type {
  Attachment, CommentView, EventView, FeedItem, FileView, ProjectDetail, ProjectSummary, PaymentRow, TaskDetail, TaskRow, TrackerRow, UserCard,
} from './contract/views';
import { computeHealth, isOverdue } from './health';
import { can, principalOf, projectRoleOf, type ProjectRole } from './permissions';
import type { State } from './store';
import { diffDays } from '../lib/dates';
import { markOf } from '../lib/projectMark';
import { helpersOf, involves } from '../lib/taskPeople';
import { openPrerequisites, openPrerequisiteStages, stagesChrono, stageTagOf, tasksChrono } from '../lib/stageFlow';
import { staleDaysOf } from './pause';

export function userCard(user: User): UserCard {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl, kind: user.kind, discipline: user.discipline, gender: user.gender };
}

export function cardOf(state: State, userId: string): UserCard {
  const user = state.users[userId];
  return user ? userCard(user) : { id: userId, name: '?', avatarUrl: null, kind: 'human', discipline: '' };
}

/** The stages in the order the office gave them. */
export function stagesOf(state: State, projectId: string): Stage[] {
  return Object.values(state.stages).filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
}

/** The stages in time order, which is how every screen lists them (owner, 2026-10-02). */
export function stagesInTime(state: State, projectId: string): Stage[] {
  return stagesChrono(stagesOf(state, projectId));
}

export function deadlinesOf(state: State, projectId: string): Deadline[] {
  return Object.values(state.deadlines)
    .filter((d) => d.projectId === projectId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function countComments(state: State, targetType: 'task' | 'update', targetId: string): number {
  return Object.values(state.comments).filter((c) => c.targetType === targetType && c.targetId === targetId).length;
}

/** Events that show in the project feed and on the card. Posts show as "update" items. */
export const FEED_VERBS = new Set([
  'project.created', 'project.stage_changed', 'project.leader_changed', 'task.created', 'task.status_changed',
  'task.approved', 'task.sent_back', 'task.version_opened', 'task.reopened', 'task.dates_shifted', 'file.added', 'file.version_added', 'member.added',
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
      if (typeof after.ownerId === 'string') detail.lead = state.users[after.ownerId]?.name ?? '';
      return { label: title, detail };
    }
    case 'tracker': {
      // A client item: its title, what it waits for, and the person who replies, for the meeting summary.
      const entry = state.tracker?.[event.targetId];
      const title = entry?.title ?? (typeof after.title === 'string' ? after.title : typeof before.title === 'string' ? before.title : '');
      const detail: Record<string, string> = {};
      if (entry?.waiting) detail.waiting = entry.waiting;
      if (typeof after.replyTaskId === 'string') {
        const reply = state.tasks[after.replyTaskId];
        if (reply) detail.person = state.users[reply.ownerId]?.name ?? '';
      }
      return { label: title, detail };
    }
    case 'file': {
      const letter = lastLetter(event.after);
      return { label: state.files[event.targetId]?.name ?? '', detail: letter ? { version: letter } : {} };
    }
    case 'project': {
      const name = state.projects[event.targetId]?.name ?? '';
      if (typeof after.currentStageId === 'string') return { label: name, detail: { stage: state.stages[after.currentStageId]?.name ?? '' } };
      if ('leaderId' in after) {
        const leader = typeof after.leaderId === 'string' ? (state.users[after.leaderId]?.name ?? '') : '';
        return { label: name, detail: { leader } };
      }
      return { label: name, detail: {} };
    }
    case 'member': {
      const userId = event.targetId.split(':')[1] ?? '';
      return { label: state.users[userId]?.name ?? '', detail: {} };
    }
    default:
      return { label: '', detail: {} };
  }
}

/** True when the viewer may edit or delete this post or comment: its author, or the person its agent acted for (spec 7.2). */
function canEditContent(state: State, projectId: string, authorId: string, viewer: User): boolean {
  return can(viewer, 'content.editOwn', { projectRole: projectRoleOf(state, projectId, viewer.id), authorId: principalOf(state, authorId) });
}

export function updateItemOf(state: State, update: Update, viewer: User): FeedItem {
  return {
    kind: 'update', id: update.id, at: update.createdAt, author: cardOf(state, update.authorId), body: update.body,
    fileIds: update.fileIds, editedAt: update.editedAt, commentCount: countComments(state, 'update', update.id),
    canEdit: canEditContent(state, update.projectId, update.authorId, viewer),
    ...(update.decision ? { decision: true as const } : {}),
  };
}

function newestFirst(a: FeedItem, b: FeedItem): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return b.id.localeCompare(a.id);
}

/** mayUndo comes from the history rules, so the feed offers Undo exactly when events.undo accepts it. */
export function feedFor(
  state: State, projectId: string, filter: 'all' | 'posts' | 'decisions' | 'tasks' | 'files', limit: number, viewer: User,
  mayUndo: (event: Event) => boolean = () => false,
): FeedItem[] {
  const items: FeedItem[] = [];
  if (filter === 'all' || filter === 'posts' || filter === 'decisions') {
    for (const update of Object.values(state.updates)) {
      if (update.projectId !== projectId || (filter === 'decisions' && !update.decision)) continue;
      items.push(updateItemOf(state, update, viewer));
    }
  }
  if (filter !== 'posts' && filter !== 'decisions') {
    for (const event of Object.values(state.events)) {
      if (event.projectId !== projectId || event.undoneBy || !FEED_VERBS.has(event.verb)) continue;
      if (filter === 'tasks' && !event.verb.startsWith('task.')) continue;
      if (filter === 'files' && !event.verb.startsWith('file.')) continue;
      const { label, detail } = eventLabel(state, event);
      items.push({
        kind: 'event', id: event.id, at: event.createdAt, author: cardOf(state, event.actorId), verb: event.verb,
        targetType: event.targetType, targetId: event.targetId, label, detail, canUndo: mayUndo(event),
      });
    }
  }
  return items.sort(newestFirst).slice(0, limit);
}

function viewerCanOf(viewer: User, projectRole: ProjectRole): ProjectSummary['viewerCan'] {
  const r = { projectRole };
  return {
    edit: can(viewer, 'project.edit', r),
    changeLeader: can(viewer, 'project.changeLeader', r),
    archive: can(viewer, 'project.archive', r),
    delete: can(viewer, 'project.delete', r),
    healthOverride: can(viewer, 'project.healthOverride', r),
    createTaskForAnyone: can(viewer, 'task.createForAnyone', r),
    createTaskForSelf: can(viewer, 'task.createForSelf', r),
    post: can(viewer, 'content.post', r),
    review: can(viewer, 'task.review', r),
    payments: can(viewer, 'payment.manage'),
  };
}

/** "viewer" is the person whose rights apply: the user, or the person an agent acts for. */
export function summaryOf(state: State, project: Project, today: string, viewer: User): ProjectSummary {
  const stages = stagesInTime(state, project.id);
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === project.id);
  const deadlines = deadlinesOf(state, project.id);
  const next = deadlines.find((d) => d.date >= today) ?? [...deadlines].reverse().find((d) => d.date < today) ?? null;
  const latest = feedFor(state, project.id, 'all', 2, viewer);
  const newest = latest[0]?.at;
  const health = computeHealth({ project, stages, tasks }, today);
  const viewerRole = projectRoleOf(state, project.id, viewer.id);
  const cover = project.coverFileId ? state.files[project.coverFileId] : undefined;
  return {
    project,
    client: project.clientId ? (state.clients[project.clientId] ?? null) : null,
    health,
    healthSetBy: health?.overridden && health.setBy ? cardOf(state, health.setBy) : null,
    pausedBy: project.status === 'on_hold' && project.pause ? cardOf(state, project.pause.by) : null,
    staleDays: staleDaysOf(state, project, today),
    coverLetter: cover ? cover.versions[cover.versions.length - 1].letter : null,
    stages,
    // The tag follows the tasks, so it is computed here and never read from the saved value.
    currentStage: stages.length > 0 ? stageTagOf(stages, tasks) : state.stages[project.currentStageId],
    latest,
    nextDeadline: next ? { id: next.id, name: next.name, date: next.date, daysLeft: diffDays(today, next.date) } : null,
    leader: project.leaderId ? cardOf(state, project.leaderId) : null,
    team: Object.values(state.members)
      .filter((m) => m.projectId === project.id && m.userId !== project.leaderId)
      .map((m) => cardOf(state, m.userId))
      .sort((a, b) => a.name.localeCompare(b.name)),
    openTasks: tasks.filter((t) => t.status !== 'done').length,
    lastActivityAt: newest && newest > project.updatedAt ? newest : project.updatedAt,
    viewerRole,
    viewerCan: viewerCanOf(viewer, viewerRole),
  };
}


export function detailOf(state: State, project: Project, today: string, viewer: User): ProjectDetail {
  const summary = summaryOf(state, project, today, viewer);
  // A person leads a task or helps on it. Both count, as in members.remove and the Overview (audit 2026-10-03, PRJ-3).
  const openBy = (userId: string) =>
    Object.values(state.tasks).filter((t) => t.projectId === project.id && involves(t, userId) && t.status !== 'done').length;
  const members = Object.values(state.members)
    .filter((m) => m.projectId === project.id)
    .map((m) => ({
      user: cardOf(state, m.userId), discipline: m.discipline, isLeader: m.userId === project.leaderId, openTasks: openBy(m.userId),
    }))
    .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.user.name.localeCompare(b.user.name));
  return { ...summary, members, deadlines: deadlinesOf(state, project.id) };
}

export function eventViewOf(state: State, event: Event): EventView {
  return { event, actor: cardOf(state, event.actorId) };
}

/** What an open task waits for. A done task waits for nothing, and a task with no prerequisites skips the scan. */
function waitingOf(state: State, task: Task): TaskRow['waitingFor'] {
  const stage = state.stages[task.stageId];
  if (task.status === 'done' || ((task.prerequisiteIds ?? []).length === 0 && (stage?.prerequisiteIds ?? []).length === 0)) return { tasks: [], stages: [] };
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === task.projectId);
  return {
    tasks: openPrerequisites(task, tasks).map((t) => ({ id: t.id, title: t.title })),
    stages: openPrerequisiteStages(task, stagesOf(state, task.projectId), tasks).map((s) => ({ id: s.id, name: s.name })),
  };
}

export function taskRowOf(state: State, task: Task, today: string, viewer: User): TaskRow {
  const project = state.projects[task.projectId];
  const stage = state.stages[task.stageId];
  return {
    task,
    owner: cardOf(state, task.ownerId),
    helpers: helpersOf(task).map((id) => cardOf(state, id)),
    project: { id: task.projectId, code: project?.code ?? '', name: project?.name ?? '', mark: markOf(project ?? { id: task.projectId }) },
    stage: { id: task.stageId, name: stage?.name ?? '' },
    commentCount: countComments(state, 'task', task.id),
    fileCount: Object.values(state.files).filter((f) => f.taskId === task.id).length,
    overdue: isOverdue(task, today),
    canMove: can(viewer, 'task.updateOwn', { projectRole: projectRoleOf(state, task.projectId, viewer.id), ownerId: task.ownerId }),
    waitingFor: waitingOf(state, task),
  };
}

export function taskDetailOf(state: State, task: Task, today: string, viewer: User): TaskDetail {
  const r = { projectRole: projectRoleOf(state, task.projectId, viewer.id), ownerId: task.ownerId };
  const history = Object.values(state.events)
    .filter((e) => e.targetType === 'task' && e.targetId === task.id)
    .sort((a, b) => b.seq - a.seq)
    .map((e) => eventViewOf(state, e));
  const link = (t: Task) => ({ id: t.id, title: t.title, status: t.status });
  const inProject = Object.values(state.tasks).filter((t) => t.projectId === task.projectId);
  const ids = new Set(task.prerequisiteIds ?? []);
  return {
    ...taskRowOf(state, task, today, viewer),
    needsFirst: tasksChrono(inProject.filter((t) => ids.has(t.id)), stagesOf(state, task.projectId)).map(link),
    unlocks: tasksChrono(inProject.filter((t) => (t.prerequisiteIds ?? []).includes(task.id)), stagesOf(state, task.projectId)).map(link),
    viewerCan: {
      edit: can(viewer, 'task.updateOwn', r),
      editAll: can(viewer, 'task.updateAny', r),
      complete: can(viewer, 'task.updateOwn', r) && task.status !== 'done',
      review: can(viewer, 'task.review', r) && task.status === 'in_review',
      delete: can(viewer, 'task.delete', r),
      contribute: can(viewer, 'task.contribute', { ...r, helperIds: helpersOf(task) }),
      newVersion: task.status === 'done' && can(viewer, 'task.updateOwn', r),
      saveTemplate: can(viewer, 'task.updateAny', r),
    },
    history,
  };
}

/** The files of a comment or a message. A deleted file keeps its place with no name. */
export function attachmentsOf(state: State, fileIds: string[] | undefined): Attachment[] {
  return (fileIds ?? []).map((id) => ({ id, name: state.files[id]?.name ?? null }));
}

export function commentViewOf(state: State, comment: Comment, viewer: User): CommentView {
  const target = comment.targetType === 'task' ? state.tasks[comment.targetId] : state.updates[comment.targetId];
  return {
    comment,
    author: cardOf(state, comment.authorId),
    canEdit: target ? canEditContent(state, target.projectId, comment.authorId, viewer) : false,
    files: attachmentsOf(state, comment.fileIds),
  };
}

export function fileViewOf(state: State, file: FileRec): FileView {
  const latest = file.versions[file.versions.length - 1];
  return { file, latest, uploader: cardOf(state, latest.uploadedBy) };
}

/** True when this person may delete the entry: its author (or the person an agent author acted for), the leader or the Admin. */
export function mayDeleteTracker(state: State, viewer: User, entry: TrackerEntry): boolean {
  if (!viewer.active) return false;
  return can(viewer, 'task.delete', { projectRole: projectRoleOf(state, entry.projectId, viewer.id) })
    || principalOf(state, entry.createdBy) === viewer.id;
}

/** The reply task of an entry. A task that was deleted counts as no task. */
export function replyTaskOf(state: State, entry: TrackerEntry): TrackerRow['replyTask'] {
  const task = entry.replyTaskId ? state.tasks[entry.replyTaskId] : undefined;
  return task ? { id: task.id, status: task.status, dueDate: task.dueDate, owner: cardOf(state, task.ownerId) } : null;
}

export function trackerRowOf(state: State, entry: TrackerEntry, viewer: User): TrackerRow {
  const mayPost = can(viewer, 'content.post', { projectRole: projectRoleOf(state, entry.projectId, viewer.id) });
  return {
    entry,
    createdBy: cardOf(state, entry.createdBy),
    closedBy: entry.closedBy ? cardOf(state, entry.closedBy) : null,
    people: entry.peopleIds.map((id) => cardOf(state, id)),
    files: attachmentsOf(state, entry.fileIds),
    replyTask: replyTaskOf(state, entry),
    canClose: mayPost && entry.waiting !== null && entry.closedAt === null,
    canEdit: mayPost,
    canDelete: mayDeleteTracker(state, viewer, entry),
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
