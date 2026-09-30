import type { Deadline, Event, Project, Stage, Update, User } from './contract/entities';
import type { FeedItem, ProjectDetail, ProjectSummary, UserCard } from './contract/views';
import { computeHealth } from './health';
import { can, projectRoleOf } from './permissions';
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

export function summaryOf(state: State, project: Project, today: string): ProjectSummary {
  const stages = stagesOf(state, project.id);
  const tasks = Object.values(state.tasks).filter((t) => t.projectId === project.id);
  const deadlines = deadlinesOf(state, project.id);
  const next = deadlines.find((d) => d.date >= today) ?? [...deadlines].reverse().find((d) => d.date < today) ?? null;
  const latest = feedFor(state, project.id, 'all', 2);
  const newest = latest[0]?.at;
  return {
    project,
    client: project.clientId ? (state.clients[project.clientId] ?? null) : null,
    health: computeHealth({ project, stages, tasks }, today),
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
  };
}

export function detailOf(state: State, project: Project, today: string, viewer: User): ProjectDetail {
  const role = projectRoleOf(state, project.id, viewer.id);
  const r = { projectRole: role };
  const openBy = (userId: string) =>
    Object.values(state.tasks).filter((t) => t.projectId === project.id && t.ownerId === userId && t.status !== 'done').length;
  const members = Object.values(state.members)
    .filter((m) => m.projectId === project.id)
    .map((m) => ({ user: cardOf(state, m.userId), discipline: m.discipline, isLeader: m.userId === project.leaderId, openTasks: openBy(m.userId) }))
    .sort((a, b) => Number(b.isLeader) - Number(a.isLeader) || a.user.name.localeCompare(b.user.name));
  return {
    ...summaryOf(state, project, today),
    members,
    deadlines: deadlinesOf(state, project.id),
    viewerRole: role,
    viewerCan: {
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
    },
  };
}
