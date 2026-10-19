import {
  ADMIN_ONLY_TRIGGERS, TRIGGERS, isEmailTrigger, type NoticeFeedback, type Notification, type NotificationTarget, type Preferences, type Task, type Trigger,
  type User,
} from './contract/entities';
import { can, mayViewTask, principalOf } from './permissions';
import { nextId, type State } from './store';
import { addDays, nowStamp, officeClock, weekStartOf } from '../lib/dates';
import { peopleOfTask } from '../lib/taskPeople';
import { isWorkingDay } from '../lib/workdays';
import type { Ctx } from './registry';

export type NotifyInput = {
  userIds: string[];
  trigger: Trigger;
  targetType: NotificationTarget;
  targetId: string;
  dedupeKey?: string;
  /** The story of the change, so an Undo can take the notice back (audit 2026-10-03, API-13). */
  correlationId?: string;
  /** The due day a reminder names (audit 2026-10-03, API-11). */
  dueDate?: string;
  /** The kind and the excerpt of a report (owner, 2026-10-07). */
  feedback?: NoticeFeedback;
};

/** True when the person gets the in-app notice of this trigger. A switch the person never set means on (owner, 2026-10-07). */
export function inAppOn(prefs: Preferences, trigger: Trigger): boolean {
  return prefs.notifications[trigger] ?? true;
}

/** The triggers that send an email when the person never set the switch (spec 2, section 10). */
export const EMAIL_DEFAULT_ON: ReadonlySet<Trigger> = new Set<Trigger>(['task_assigned', 'review_requested', 'mention']);

/**
 * True when the person gets an email for this trigger. A switch the person never set takes its default. A notice that stays in
 * the app never sends one, whatever a stored switch says (owner, 2026-10-07).
 */
export function emailOn(prefs: Preferences, trigger: Trigger): boolean {
  if (!isEmailTrigger(trigger)) return false;
  return prefs.email?.[trigger] ?? EMAIL_DEFAULT_ON.has(trigger);
}

/** Every active human with the Admin right: the people who get the notice of a new report (owner, 2026-10-07). */
export function activeAdmins(state: Pick<State, 'users'>): string[] {
  return Object.values(state.users).filter((u) => u.kind === 'human' && u.active && can(u, 'admin.manage')).map((u) => u.id);
}

/** The switches that the person sees in Settings: the switch of a new report only with the Admin right (owner, 2026-10-07). */
export function visibleTriggers(user: User): Trigger[] {
  return can(user, 'admin.manage') ? [...TRIGGERS] : TRIGGERS.filter((trigger) => !ADMIN_ONLY_TRIGGERS.has(trigger));
}

/**
 * True for the notice of a new report when the viewer no longer has the Admin right. It reads as gone and names nothing
 * (owner, 2026-10-07). A done notice always shows to its owner: its words are the owner's own message.
 */
export function feedbackNoticeHidden(n: Pick<Notification, 'targetType' | 'trigger'>, viewer: User): boolean {
  return n.targetType === 'feedback' && n.trigger === 'feedback_sent' && !can(viewer, 'admin.manage');
}

/** True when the person gets the morning summary email. A missing value means on. */
export function morningSummaryOn(prefs: Preferences): boolean {
  return prefs.morningSummary ?? true;
}

/**
 * How notify learns that a dedupe key is used. The prototype scans its notices. The server's job passes a lookup backed by the
 * unique index, so it never loads every notice (plan 4.13, A3; AM 7.3). Only the scheduled triggers pass dedupe keys.
 */
export type NotifyOptions = { dedupeUsed?(key: string): boolean };

/**
 * Skips the actor and the person an agent actor works for, agents, inactive people, people who turned the trigger off, repeats of
 * a dedupe key, and a person who does not see the office task of the notice (owner, 2026-10-06).
 */
export function notify(state: State, actor: User | null, stamp: string, input: NotifyInput, options: NotifyOptions = {}): Notification[] {
  const used = options.dedupeUsed ?? ((key: string) => Object.values(state.notifications).some((n) => n.dedupeKey === key));
  const created: Notification[] = [];
  const task = input.targetType === 'task' ? state.tasks[input.targetId] : undefined;
  for (const userId of new Set(input.userIds)) {
    const user = state.users[userId];
    if (!user || !user.active || user.kind === 'agent') continue;
    if (task && task.projectId === null && !mayViewTask(state, user, task)) continue;
    if (actor && (user.id === actor.id || user.id === actor.ownerId)) continue;
    if (!inAppOn(user.preferences, input.trigger)) continue;
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${userId}` : null;
    if (dedupeKey && used(dedupeKey)) continue;
    const id = nextId(state, 'ntf');
    const notification: Notification = {
      id, userId, trigger: input.trigger, actorId: actor?.id ?? null, targetType: input.targetType,
      targetId: input.targetId, read: false, createdAt: stamp, dedupeKey,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      ...(input.feedback ? { feedback: { ...input.feedback } } : {}),
    };
    state.notifications[id] = notification;
    created.push(notification);
  }
  return created;
}

/** A notice from inside a call. It takes the actor, the time and the story from the call, so a story Undo takes the notice back too. */
export function notifyIn(ctx: Ctx, input: Omit<NotifyInput, 'correlationId'>): Notification[] {
  return notify(ctx.state, ctx.actor, ctx.stamp, { ...input, correlationId: ctx.correlationId });
}

/** The leader reviews. A project with no active leader goes to every active Admin (audit 2026-10-03, API-7). */
export function reviewersOf(state: State, projectId: string): string[] {
  const project = state.projects[projectId];
  if (project?.leaderId && state.users[project.leaderId]?.active) return [project.leaderId];
  return Object.values(state.users).filter((u) => u.systemRole === 'admin' && u.active).map((u) => u.id);
}

/**
 * The reviewers of one task. A project task: the reviewers of its project. An office task: its maker, or every active Admin when
 * the maker left the office (owner, 2026-10-06).
 */
export function reviewersOfTask(state: State, task: Pick<Task, 'projectId' | 'createdBy'>): string[] {
  if (task.projectId !== null) return reviewersOf(state, task.projectId);
  const maker = principalOf(state, task.createdBy);
  if (state.users[maker]?.active) return [maker];
  return Object.values(state.users).filter((u) => u.systemRole === 'admin' && u.active).map((u) => u.id);
}

export function projectPeople(state: State, projectId: string): string[] {
  const ids = Object.values(state.members).filter((m) => m.projectId === projectId).map((m) => m.userId);
  const leaderId = state.projects[projectId]?.leaderId;
  if (leaderId) ids.push(leaderId);
  return [...new Set(ids)];
}

/** The last working day before a day. The "due" reminder goes out on it, so a task due on Sunday is named on Thursday. */
function lastWorkingDayBefore(day: string): string {
  let out = addDays(day, -1);
  while (!isWorkingDay(out)) out = addDays(out, -1);
  return out;
}

/** Time-based triggers. The app runs them at start and every minute. Dedupe keys stop repeats. */
export function runScheduledTriggers(state: State, at: Date, options: NotifyOptions = {}): number {
  const clock = officeClock(at);
  const today = clock.day;
  const stamp = nowStamp(at);
  let count = 0;
  for (const task of Object.values(state.tasks)) {
    // An office task has no project, so its reminders always run (owner, 2026-10-06).
    if (task.projectId !== null && state.projects[task.projectId]?.status !== 'active') continue;
    if (!task.dueDate || (task.status !== 'todo' && task.status !== 'in_progress')) continue;
    // From the last working day before the due day, so nobody gets it first on a day off. Madar runs this only while it is open,
    // so a reminder that nobody saw on that day still goes out before the due day (audit 2026-10-03, API-11).
    if (task.dueDate > today && lastWorkingDayBefore(task.dueDate) <= today) {
      count += notify(state, null, stamp, {
        userIds: peopleOfTask(task), trigger: 'due_tomorrow', targetType: 'task', targetId: task.id, dedupeKey: `due_tomorrow:${task.id}:${task.dueDate}`, dueDate: task.dueDate,
      }, options).length;
    }
    if (task.dueDate < today) {
      count += notify(state, null, stamp, {
        userIds: peopleOfTask(task), trigger: 'overdue', targetType: 'task', targetId: task.id, dedupeKey: `overdue:${task.id}:${task.dueDate}`,
      }, options).length;
    }
  }
  // A paused project reaches its planned restart day: the people who may resume it get one notice (audit 2026-10-03, API-18). The
  // person who paused it gets it too (fbk_025, owner 2026-10-19). The date is a reminder: Madar never restarts a project by itself.
  // The notice keeps the day, so a notice that a person reads later says which day it named. A new date gives a new key.
  for (const project of Object.values(state.projects)) {
    const day = project.status === 'on_hold' ? project.pause?.resumeOn : null;
    if (!day || day > today || !project.pause) continue;
    count += notify(state, null, stamp, {
      userIds: [...reviewersOf(state, project.id), principalOf(state, project.pause.by)], trigger: 'resume_due', targetType: 'project', targetId: project.id,
      dedupeKey: `resume_due:${project.id}:${day}`, dueDate: day,
    }, options).length;
  }
  return count;
}
