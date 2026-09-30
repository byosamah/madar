import type { Comment, Deadline, Event, FileRec, Project, Stage, Task, Update, User } from './contract/entities';
import type {
  CommentView, EventView, FeedItem, FileView, ProjectDetail, ProjectSummary, TaskDetail, TaskRow, UserCard,
} from './contract/views';
import { computeHealth, isOverdue } from './health';
import { can, projectRoleOf, type ProjectRole } from './permissions';
import type { State } from './store';
import { diffDays } from '../lib/dates';

export function userCard(user: User): UserCard {
  return { id: user.id, name: user.name, avatarUrl: user.avatarUrl, kind: user.kind, discipline: user.discipline };
}

export function cardOf(state: State, userId: string): UserCard {
  const user = state.users[userId];
  return user ? userCard(user) : { id: userId, name: '?', avatarUrl: null, kind: 'human', discipline: '' };
}

export function stagesOf(state: State, projectId: string): Stage[] {
  return Object.values(state.stages).filter((s) => s.projectId === projectId).sort((a, b) => a.order - b.order);
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
  'task.approved', 'task.sent_back', 'file.added', 'file.version_added', 'member.added',
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
      return { label: title, detail: typeof after.status === 'string' ? { status: after.status } : {} };
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

export function updateItemOf(state: State, update: Update): FeedItem {
  return {
    kind: 'update', id: update.id, at: update.createdAt, author: cardOf(state, update.authorId), body: update.body,
    fileIds: update.fileIds, editedAt: update.editedAt, commentCount: countComments(state, 'update', update.id),
  };
}

function newestFirst(a: FeedItem, b: FeedItem): number {
  if (a.at !== b.at) return a.at < b.at ? 1 : -1;
  return b.id.localeCompare(a.id);
}

export function feedFor(state: State, projectId: string, filter: 'all' | 'posts' | 'tasks' | 'files', limit: number): FeedItem[] {
  const items: FeedItem[] = [];
  if (filter === 'all' || filter === 'posts') {
    for (const update of Object.values(state.updates)) if (update.projectId === projectId) items.push(updateItemOf(state, update));
  }
  if (filter !== 'posts') {
    for (const event of Object.values(state.events)) {
      if (event.projectId !== projectId || event.undoneBy || !FEED_VERBS.has(event.verb)) continue;
      if (filter === 'tasks' && !event.verb.startsWith('task.')) continue;
      if (filter === 'files' && !event.verb.startsWith('file.')) continue;
      const { label, detail } = eventLabel(state, event);
      items.push({
        kind: 'event', id: event.id, at: event.createdAt, author: cardOf(state, event.actorId), verb: event.verb,
        targetType: event.targetType, targetId: event.targetId, label, detail,
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
    logTime: can(viewer, 'time.logOnProject', r),
  };
}

/** "viewer" is the person whose rights apply: the user, or the person an agent acts for. */
export function summaryOf(state: State, project: Project, today: string, viewer: User): ProjectSummary {
  const stages = stagesOf(state, project.id);
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === project.id);
  const deadlines = deadlinesOf(state, project.id);
  const next = deadlines.find((d) => d.date >= today) ?? [...deadlines].reverse().find((d) => d.date < today) ?? null;
  const latest = feedFor(state, project.id, 'all', 2);
  const newest = latest[0]?.at;
  const health = computeHealth({ project, stages, tasks }, today);
  const viewerRole = projectRoleOf(state, project.id, viewer.id);
  const cover = project.coverFileId ? state.files[project.coverFileId] : undefined;
  return {
    project,
    client: project.clientId ? (state.clients[project.clientId] ?? null) : null,
    health,
    healthSetBy: health?.overridden && health.setBy ? cardOf(state, health.setBy) : null,
    coverLetter: cover ? cover.versions[cover.versions.length - 1].letter : null,
    stages,
    currentStage: state.stages[project.currentStageId] ?? stages[0],
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

/** Hours on the project this month, or null when the viewer may not see that person's hours (spec 5.8). */
function monthHours(state: State, projectId: string, today: string, viewer: User, projectRole: ProjectRole, userId: string): number | null {
  if (!can(viewer, 'time.viewPerson', { targetUserId: userId, projectRole })) return null;
  const monthStart = `${today.slice(0, 7)}-01`;
  return Object.values(state.time)
    .filter((e) => e.projectId === projectId && e.userId === userId && e.date >= monthStart && e.date <= today)
    .reduce((sum, e) => sum + e.hours, 0);
}

export function detailOf(state: State, project: Project, today: string, viewer: User): ProjectDetail {
  const summary = summaryOf(state, project, today, viewer);
  const openBy = (userId: string) =>
    Object.values(state.tasks).filter((t) => t.projectId === project.id && t.ownerId === userId && t.status !== 'done').length;
  const members = Object.values(state.members)
    .filter((m) => m.projectId === project.id)
    .map((m) => ({
      user: cardOf(state, m.userId), discipline: m.discipline, isLeader: m.userId === project.leaderId, openTasks: openBy(m.userId),
      hoursThisMonth: monthHours(state, project.id, today, viewer, summary.viewerRole, m.userId),
    }))
    .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.user.name.localeCompare(b.user.name));
  return { ...summary, members, deadlines: deadlinesOf(state, project.id) };
}

export function eventViewOf(state: State, event: Event): EventView {
  return { event, actor: cardOf(state, event.actorId) };
}

export function taskRowOf(state: State, task: Task, today: string, viewer: User): TaskRow {
  const project = state.projects[task.projectId];
  const stage = state.stages[task.stageId];
  return {
    task,
    owner: cardOf(state, task.ownerId),
    project: { id: task.projectId, code: project?.code ?? '', name: project?.name ?? '' },
    stage: { id: task.stageId, name: stage?.name ?? '' },
    commentCount: countComments(state, 'task', task.id),
    fileCount: Object.values(state.files).filter((f) => f.taskId === task.id).length,
    overdue: isOverdue(task, today),
    canMove: can(viewer, 'task.updateOwn', { projectRole: projectRoleOf(state, task.projectId, viewer.id), ownerId: task.ownerId }),
  };
}

export function taskDetailOf(state: State, task: Task, today: string, viewer: User): TaskDetail {
  const r = { projectRole: projectRoleOf(state, task.projectId, viewer.id), ownerId: task.ownerId };
  const history = Object.values(state.events)
    .filter((e) => e.targetType === 'task' && e.targetId === task.id)
    .sort((a, b) => b.seq - a.seq)
    .map((e) => eventViewOf(state, e));
  return {
    ...taskRowOf(state, task, today, viewer),
    hours: Object.values(state.time).filter((e) => e.taskId === task.id).reduce((sum, e) => sum + e.hours, 0),
    viewerCan: {
      edit: can(viewer, 'task.updateOwn', r),
      editAll: can(viewer, 'task.updateAny', r),
      complete: can(viewer, 'task.updateOwn', r) && task.status !== 'done',
      review: can(viewer, 'task.review', r) && task.status === 'in_review',
      delete: can(viewer, 'task.delete', r),
    },
    history,
  };
}

export function commentViewOf(state: State, comment: Comment): CommentView {
  return { comment, author: cardOf(state, comment.authorId) };
}

export function fileViewOf(state: State, file: FileRec): FileView {
  const latest = file.versions[file.versions.length - 1];
  return { file, latest, uploader: cardOf(state, latest.uploadedBy) };
}
