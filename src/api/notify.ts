import type { Notification, NotificationTarget, Trigger, User } from './contract/entities';
import { nextId, type State } from './store';
import { addDays, nowStamp, officeClock, weekStartOf } from '../lib/dates';
import { peopleOfTask } from '../lib/taskPeople';

export type NotifyInput = {
  userIds: string[];
  trigger: Trigger;
  targetType: NotificationTarget;
  targetId: string;
  dedupeKey?: string;
};

/** Skips the actor and the person an agent actor works for, agents, inactive people, people who turned the trigger off, and repeats of a dedupe key. */
export function notify(state: State, actor: User | null, stamp: string, input: NotifyInput): Notification[] {
  const created: Notification[] = [];
  for (const userId of new Set(input.userIds)) {
    const user = state.users[userId];
    if (!user || !user.active || user.kind === 'agent') continue;
    if (actor && (user.id === actor.id || user.id === actor.ownerId)) continue;
    if (!user.preferences.notifications[input.trigger]) continue;
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${userId}` : null;
    if (dedupeKey && Object.values(state.notifications).some((n) => n.dedupeKey === dedupeKey)) continue;
    const id = nextId(state, 'ntf');
    const notification: Notification = {
      id, userId, trigger: input.trigger, actorId: actor?.id ?? null, targetType: input.targetType,
      targetId: input.targetId, read: false, createdAt: stamp, dedupeKey,
    };
    state.notifications[id] = notification;
    created.push(notification);
  }
  return created;
}

/** The leader reviews. A project with no leader goes to every active Admin. */
export function reviewersOf(state: State, projectId: string): string[] {
  const project = state.projects[projectId];
  if (project?.leaderId) return [project.leaderId];
  return Object.values(state.users).filter((u) => u.systemRole === 'admin' && u.active).map((u) => u.id);
}

export function projectPeople(state: State, projectId: string): string[] {
  const ids = Object.values(state.members).filter((m) => m.projectId === projectId).map((m) => m.userId);
  const leaderId = state.projects[projectId]?.leaderId;
  if (leaderId) ids.push(leaderId);
  return [...new Set(ids)];
}

/** Time-based triggers. The app runs them at start and every minute. Dedupe keys stop repeats. */
export function runScheduledTriggers(state: State, at: Date): number {
  const clock = officeClock(at);
  const today = clock.day;
  const tomorrow = addDays(today, 1);
  const stamp = nowStamp(at);
  let count = 0;
  for (const task of Object.values(state.tasks)) {
    if (state.projects[task.projectId]?.status !== 'active') continue;
    if (!task.dueDate || (task.status !== 'todo' && task.status !== 'in_progress')) continue;
    if (task.dueDate === tomorrow) {
      count += notify(state, null, stamp, {
        userIds: peopleOfTask(task), trigger: 'due_tomorrow', targetType: 'task', targetId: task.id, dedupeKey: `due_tomorrow:${task.id}:${task.dueDate}`,
      }).length;
    }
    if (task.dueDate < today) {
      count += notify(state, null, stamp, {
        userIds: peopleOfTask(task), trigger: 'overdue', targetType: 'task', targetId: task.id, dedupeKey: `overdue:${task.id}:${task.dueDate}`,
      }).length;
    }
  }
  return count;
}
