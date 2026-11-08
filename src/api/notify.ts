import {
  ADMIN_ONLY_TRIGGERS, TRIGGERS, isEmailTrigger, type NoticeFeedback, type Notification, type NotificationTarget, type Preferences, type Task, type Trigger,
  type User,
} from './contract/entities';
import { copyForAdmins } from './adminCopies';
import { can, canReview, holdsRight, mayViewMeeting, mayViewProject, mayViewTask, principalOf, taskResource, type Actor } from './permissions';
import { ensureRights, withRights } from './rights';
import { projectOfTarget } from './targetProject';
import { nextId, type State } from './store';
import { addDays, nowStamp, officeClock, weekStartOf } from '../lib/dates';
import { peopleOfTask } from '../lib/taskPeople';
import { isWorkingDay } from '../lib/workdays';
import { weekSlotAt } from '../lib/week';
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
  /** The chat message or the task comment that the notice points to, so a press opens the chat at that message (chat design item 17). */
  messageId?: string;
  /** True on the notice of a reply: the person wrote the message that this one answers (chat design item 10). */
  reply?: true;
  /** True on a mention notice that came from @everyone (owner, 2026-10-22, fbk_041): it sends a push and never an email. */
  everyone?: true;
  /** What happened to the meeting of a meeting_invited notice (fbk_022). */
  meeting?: Notification['meeting'];
  /** The payment of a payment_due notice: its id and its name (the Daftra link, owner 2026-10-26). */
  payment?: Notification['payment'];
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

/**
 * Every active human who holds the right to manage reports (feedback.manage, which the Admin holds): the people who get the notice of
 * a new report (owner, 2026-10-07; role-rights, 2026-10-23). The rights come from the office settings, so the list reads them.
 */
export function activeAdmins(state: Pick<State, 'users' | 'settings'>): string[] {
  return Object.values(state.users).filter((u) => u.kind === 'human' && u.active && can(withRights(state, u), 'feedback.manage')).map((u) => u.id);
}

/**
 * True for a person who gets the due notice of a payment (the Daftra link, owner 2026-10-26): not an Admin, and a holder of "See payments"
 * and "Link Daftra invoices". The Admin holds every switch, so the role test comes first: the Admin has Daftra switches but no copy of
 * this notice. The person comes with the office rights attached.
 */
export function getsPaymentDue(user: Actor): boolean {
  return user.systemRole !== 'admin' && can(user, 'payment.view') && can(user, 'payment.daftraLink');
}

/**
 * The switches that the person sees in Settings: the switch of a new report only with the right to manage reports (owner, 2026-10-07),
 * and the switch of a payment due day only for a person who gets that notice (the Daftra link, owner 2026-10-26).
 * The person comes with the office rights attached (session.get), so a person with none attached sees no such switch.
 */
export function visibleTriggers(user: Actor): Trigger[] {
  const reports = can(user, 'feedback.manage');
  const payments = getsPaymentDue(user);
  return TRIGGERS.filter((trigger) => (reports || !ADMIN_ONLY_TRIGGERS.has(trigger)) && (payments || trigger !== 'payment_due'));
}

/**
 * True for the notice of a new report when the viewer no longer holds the right to manage reports. It reads as gone and names nothing
 * (owner, 2026-10-07). A done notice always shows to its owner: its words are the owner's own message. The viewer comes with the office
 * rights attached (withRights); a viewer with none attached holds none, so the notice stays hidden.
 */
export function feedbackNoticeHidden(n: Pick<Notification, 'targetType' | 'trigger'>, viewer: Actor): boolean {
  return n.targetType === 'feedback' && n.trigger === 'feedback_sent' && !can(viewer, 'feedback.manage');
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
 * a dedupe key, a person who does not see the office task of the notice (owner, 2026-10-06), and a person who does not see the
 * meeting of the notice (fbk_022), and a person who does not see the project of the notice (hidden projects). Then copyForAdmins (adminCopies.ts) makes the copies for the Admins who picked "Everything".
 */
export function notify(state: State, actor: User | null, stamp: string, input: NotifyInput, options: NotifyOptions = {}): Notification[] {
  const used = options.dedupeUsed ?? ((key: string) => Object.values(state.notifications).some((n) => n.dedupeKey === key));
  const created: Notification[] = [];
  const task = input.targetType === 'task' ? state.tasks[input.targetId] : undefined;
  const meeting = input.targetType === 'meeting' ? state.meetings?.[input.targetId] : undefined;
  const project = projectOfTarget(state, input.targetType, input.targetId);
  for (const userId of new Set(input.userIds)) {
    const user = state.users[userId];
    if (!user || !user.active || user.kind === 'agent') continue;
    // The person comes from the office list with no rights attached: attach them, so a holder of task.officeAll still hears the notice.
    if (task && task.projectId === null && !mayViewTask(state, ensureRights(state, user), task)) continue;
    // A meeting with no project tells only the people who may see it (owner, 2026-10-19).
    if (meeting && !mayViewMeeting(state, user, meeting)) continue;
    // A project that the person does not see tells the person nothing (hidden projects, owner 2026-10-22).
    if (project && !mayViewProject(state, project, user)) continue;
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
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.reply ? { reply: true as const } : {}),
      ...(input.everyone ? { everyone: true as const } : {}),
      ...(input.meeting ? { meeting: { ...input.meeting } } : {}),
      ...(input.payment ? { payment: { ...input.payment } } : {}),
    };
    state.notifications[id] = notification;
    created.push(notification);
  }
  // An Admin who picked "Everything" gets a copy of the notice, with the names of the people who got it (owner, 2026-10-23).
  copyForAdmins(state, actor, stamp, input, created);
  return created;
}

/** A notice from inside a call. It takes the actor, the time and the story from the call, so a story Undo takes the notice back too. */
export function notifyIn(ctx: Ctx, input: Omit<NotifyInput, 'correlationId'>): Notification[] {
  return notify(ctx.state, ctx.actor, ctx.stamp, { ...input, correlationId: ctx.correlationId });
}

/** Every active Admin. */
const activeAdminIds = (state: Pick<State, 'users'>): string[] => Object.values(state.users).filter((u) => u.systemRole === 'admin' && u.active).map((u) => u.id);

/** The active leader of a project, or null. The person answers for the project: the review, the restart, the notices of its team. */
export function activeLeaderOf(state: Pick<State, 'users' | 'projects'>, projectId: string): string | null {
  const leaderId = state.projects[projectId]?.leaderId;
  return leaderId && state.users[leaderId]?.active ? leaderId : null;
}

/** The people who answer for a project: its active leader, or every active Admin when it has none. The restart notice goes to them. */
function leaderOrAdmins(state: Pick<State, 'users' | 'projects'>, projectId: string): string[] {
  const leaderId = activeLeaderOf(state, projectId);
  return leaderId ? [leaderId] : activeAdminIds(state);
}

/**
 * The leader reviews, when the leader holds the right to review the projects they lead (task.review.lead, role rights version 2). A
 * project with no active leader, or with a leader who lacks that right, goes to every active Admin (audit 2026-10-03, API-7).
 */
export function reviewersOf(state: State, projectId: string): string[] {
  const leaderId = activeLeaderOf(state, projectId);
  if (leaderId && canReview(ensureRights(state, state.users[leaderId]), 'leader')) return [leaderId];
  return activeAdminIds(state);
}

/** Every active Admin except one person. The person who sent a to-do to review is never its reviewer (fbk_087). */
const adminsExcept = (state: Pick<State, 'users'>, except: string): string[] => activeAdminIds(state).filter((id) => id !== except);

/**
 * THE rule: who reviews a to-do that the person `senderId` sent to review (fbk_087, owner 2026-11-08). The lead and the helpers are the
 * work side of the to-do. The person who does the work never approves it.
 * - The sender is not the lead (a helper, the maker, or anyone else who may send): the lead reviews.
 * - The sender is the lead of a project to-do: the project leader reviews. Nobody reviews when the lead is the project leader.
 * - The sender is the lead of an office to-do: the maker reviews. Nobody reviews when the lead is the maker.
 * A lead, a project leader or a maker who left the office is replaced by the active Admins, except the sender. An empty answer means
 * that nobody else can check the to-do, so it needs no review. Nobody is a reviewer only because they are an Admin, or (on a project
 * to-do) only because they made it. `senderId` is a person: use the person behind an agent. The SQL form of the morning summary
 * (server/mail/summary.ts) gives the same answer.
 */
export function reviewersAfterSend(state: State, task: Pick<Task, 'projectId' | 'createdBy' | 'ownerId'>, senderId: string): string[] {
  const leadId = task.ownerId;
  if (leadId !== senderId) return leadId !== null && state.users[leadId]?.active ? [leadId] : adminsExcept(state, senderId);
  if (task.projectId !== null) {
    const leaderId = activeLeaderOf(state, task.projectId);
    if (leaderId === null) return adminsExcept(state, senderId);
    return leaderId === senderId ? [] : [leaderId];
  }
  const maker = principalOf(state, task.createdBy);
  if (!state.users[maker]?.active) return adminsExcept(state, senderId);
  return maker === senderId ? [] : [maker];
}

/**
 * The reviewers of one task. A to-do in review that has a stored sender follows reviewersAfterSend. Any other to-do keeps the old rule
 * (a to-do that went to review before the sender was stored keeps it until it is sent again): a project task goes to the reviewers of its
 * project, and an office task goes to its maker, or to every active Admin when the maker left the office (owner, 2026-10-06).
 */
export function reviewersOfTask(state: State, task: Pick<Task, 'projectId' | 'createdBy'> & Partial<Pick<Task, 'ownerId' | 'status' | 'reviewSentBy'>>): string[] {
  if (task.status === 'in_review' && task.reviewSentBy) return reviewersAfterSend(state, { projectId: task.projectId, createdBy: task.createdBy, ownerId: task.ownerId ?? null }, task.reviewSentBy);
  if (task.projectId !== null) return reviewersOf(state, task.projectId);
  const maker = principalOf(state, task.createdBy);
  if (state.users[maker]?.active) return [maker];
  return activeAdminIds(state);
}

/**
 * Where a tick or a Done by `viewer` lands (fbk_087, owner 2026-11-08): true for In review, false for Done. The call (tasks.complete,
 * tasks.move) and the flag of the view (viewerCan.sendToReview) both read this one answer, so a button never says "Mark done" for a tick
 * that goes to review.
 * - No review need (an office to-do that its maker leads needs none): Done.
 * - A to-do in review: Done only for a person who may approve it (mayReviewTask), never for the sender.
 * - A person who is not on the work side (lead and helpers) and holds the review right (the project leader, the Admin, on an office
 *   to-do the maker or a holder of task.officeAll): Done, an approval as before.
 * - Any other person: the reviewer is worked out as if this person sent it (reviewersAfterSend). Nobody to review: Done.
 */
export function tickLandsInReview(state: State, viewer: Actor, task: Pick<Task, 'projectId' | 'createdBy' | 'ownerId' | 'helperIds' | 'status' | 'reviewSentBy' | 'needsReview'>): boolean {
  if (!task.needsReview || (task.projectId === null && task.ownerId === principalOf(state, task.createdBy))) return false;
  if (task.status === 'in_review') return !mayReviewTask(state, viewer, task);
  const worksOnIt = task.ownerId === viewer.id || (task.helperIds ?? []).includes(viewer.id);
  if (!worksOnIt && can(viewer, 'task.review', taskResource(state, task, viewer.id))) return false;
  return reviewersAfterSend(state, task, viewer.id).length > 0;
}

/**
 * True when the person may approve or send back the to-do that waits for review (fbk_087, rules 2 and 4). `viewer` is the person, with
 * the rights attached. The sender never may. The named reviewer may, with no switch. A holder of the review right of the project may as
 * a backup, and on an office to-do a holder of task.officeAll. A to-do with no stored sender keeps the old gate (the review right).
 */
export function mayReviewTask(state: State, viewer: Actor, task: Pick<Task, 'projectId' | 'createdBy' | 'ownerId' | 'helperIds' | 'status' | 'reviewSentBy'>): boolean {
  if (task.status !== 'in_review') return false;
  const resource = taskResource(state, task, viewer.id);
  if (!task.reviewSentBy) return can(viewer, 'task.review', resource);
  if (viewer.id === task.reviewSentBy) return false;
  if (reviewersOfTask(state, task).includes(viewer.id)) return true;
  return task.projectId === null ? holdsRight(viewer, 'task.officeAll') : can(viewer, 'task.review', resource);
}

export function projectPeople(state: State, projectId: string): string[] {
  const ids = Object.values(state.members).filter((m) => m.projectId === projectId).map((m) => m.userId);
  const leaderId = state.projects[projectId]?.leaderId;
  if (leaderId) ids.push(leaderId);
  return [...new Set(ids)];
}

/** The reminder of a meeting starts this long before its start (fbk_022, owner 2026-10-19). The 15-minute job has one run in the window. */
export const MEETING_SOON_MS = 30 * 60_000;

/** The last working day before a day. The "due" reminder goes out on it, so a task due on Sunday is named on Thursday. */
function lastWorkingDayBefore(day: string): string {
  let out = addDays(day, -1);
  while (!isWorkingDay(out)) out = addDays(out, -1);
  return out;
}

/**
 * The people who get the due notice of a payment: active people, not agents, whose role is not admin, who hold "See payments" and
 * "Link Daftra invoices" (the Daftra link, owner 2026-10-26). notify then skips a person who may not view the project.
 */
function paymentDuePeople(state: State): string[] {
  return Object.values(state.users).filter((u) => u.kind === 'human' && u.active && getsPaymentDue(withRights(state, u))).map((u) => u.id);
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
      userIds: [...leaderOrAdmins(state, project.id), principalOf(state, project.pause.by)], trigger: 'resume_due', targetType: 'project', targetId: project.id,
      dedupeKey: `resume_due:${project.id}:${day}`, dueDate: day,
    }, options).length;
  }
  // A meeting that starts within 30 minutes: its organizer and its attendees get one reminder. The key holds the start, so a meeting
  // that moves reminds again for its new start. A cancelled meeting sends none (fbk_022, owner 2026-10-19).
  for (const meeting of Object.values(state.meetings ?? {})) {
    if (meeting.status !== 'scheduled') continue;
    const start = Date.parse(meeting.startsAt);
    if (at.getTime() >= start || at.getTime() < start - MEETING_SOON_MS) continue;
    count += notify(state, null, stamp, {
      userIds: [meeting.organizerId, ...meeting.attendeeIds], trigger: 'meeting_soon', targetType: 'meeting', targetId: meeting.id,
      dedupeKey: `meeting_soon:${meeting.id}:${meeting.startsAt}`,
    }, options).length;
  }
  // A payment reaches its due day: Accounting gets one notice, to link the Daftra invoice (the Daftra link, owner 2026-10-26). Only the
  // due day counts: a payment that is past due on release day gets none. A linked or received payment, and a payment of an internal
  // project, get none. The key holds the day, so a payment that moves to a new day tells again. The state may have no payments list.
  let accounting: string[] | null = null;
  for (const payment of Object.values(state.payments ?? {})) {
    if (payment.dueDate !== today || payment.receivedOn !== null || payment.daftra !== undefined) continue;
    const project = state.projects[payment.projectId];
    if (!project || project.kind === 'internal') continue;
    accounting ??= paymentDuePeople(state);
    count += notify(state, null, stamp, {
      userIds: accounting, trigger: 'payment_due', targetType: 'project', targetId: project.id, dedupeKey: `payment_due:${payment.id}:${payment.dueDate}`,
      dueDate: payment.dueDate, payment: { id: payment.id, name: payment.name },
    }, options).length;
  }
  // The weekly question (fbk_088, owner 2026-11-08): on Sunday from 08:00 and on Thursday from 14:00, every active person who holds "Answer the weekly
  // question" and has not answered gets one notice, in the app and in push. The key holds the question and the week, so the person is asked once.
  const slot = weekSlotAt(clock.weekday, clock.hour);
  if (slot) {
    const week = weekStartOf(today);
    const answered = new Set(Object.values(state.checkins ?? {}).filter((one) => one.week === week && one.kind === slot).map((one) => one.userId));
    const asked = Object.values(state.users)
      .filter((user) => user.kind === 'human' && user.active && !answered.has(user.id) && can(withRights(state, user), 'checkin.answer'))
      .map((user) => user.id);
    count += notify(state, null, stamp, {
      userIds: asked, trigger: 'week_question', targetType: 'week', targetId: `${slot}:${week}`, dedupeKey: `week_question:${slot}:${week}`,
    }, options).length;
  }
  return count;
}
