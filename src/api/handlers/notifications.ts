import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Day, isEmailTrigger, Notification, NotificationId, Trigger, User, type Event, type Task } from '../contract/entities';
import { UserCard } from '../contract/views';
import { forbidden, invalid, notFound } from '../errors';
import { canSeeConversation } from '../chatState';
import { applyPatch } from '../events';
import { feedbackNoticeHidden } from '../notify';
import type { State } from '../store';
import { can, mayViewTask, taskResource } from '../permissions';
import { cardOf } from '../views';
import { markOf } from '../../lib/projectMark';
import { taskLink } from '../../lib/params';

/**
 * The Inbox badge counts only unread items of these kinds (spec 3.2). A restart day asks the leader to act, as a due day does. The
 * Admin acts on a new report, and the sender tests a done one (owner, 2026-10-07).
 */
export const ACTION_TRIGGERS: ReadonlySet<string> = new Set([
  'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested', 'task_sent_back', 'resume_due', 'feedback_sent', 'feedback_done',
]);

export const NotificationView = z.object({
  notification: Notification,
  actor: UserCard.nullable(),
  target: z.string(),
  projectCode: z.string().nullable(),
  /** The project, for its color tile in the Inbox (redesign spec 3.7). Null for a timesheet notice or a deleted project. */
  project: z.object({ id: z.string(), name: z.string(), mark: z.number().int().nonnegative() }).nullable(),
  link: z.string(),
  needsAction: z.boolean(),
  canApprove: z.boolean(),
  /** The task, post or project is deleted. The sentence keeps its last name, and there is nothing to open. */
  gone: z.boolean(),
  /** The due day a reminder names, so the screen writes the day, never "tomorrow" (audit 2026-10-03, API-11). Null for other notices. */
  dueDate: Day.nullable(),
});
export type NotificationView = z.infer<typeof NotificationView>;

const Counts = z.object({ unread: z.number().int().min(0), badge: z.number().int().min(0) });

type Copy = Record<string, unknown>;

/** The last copy of a deleted task, post or project, from its delete event, so an old notice still reads as a whole sentence. */
function deletedCopy(state: State, targetType: string, id: string): Copy | null {
  let found: Event | null = null;
  for (const event of Object.values(state.events)) {
    if (event.verb === `${targetType}.deleted` && event.targetId === id && !event.undoneBy && (!found || event.seq > found.seq)) found = event;
  }
  return found && found.before !== null && typeof found.before === 'object' ? (found.before as Copy) : null;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * A task of a notice that the viewer may not see: an office task that the viewer is no longer on, live or deleted (owner,
 * 2026-10-06). Its notice reads as gone and names nothing.
 */
function hiddenTask(state: State, n: Notification, viewer: User): boolean {
  if (n.targetType !== 'task') return false;
  const task = state.tasks[n.targetId] ?? (deletedCopy(state, 'task', n.targetId) as Task | null);
  return task !== null && task.projectId === null && !mayViewTask(state, viewer, task);
}

/** True when the item of a notice is gone, or is a chat the viewer can no longer see. It builds no text, so the badge count stays cheap. */
function isGone(state: State, n: Notification, viewer: User): boolean {
  if (n.targetType === 'task') return !state.tasks[n.targetId] || hiddenTask(state, n, viewer);
  if (n.targetType === 'update') return !state.updates[n.targetId];
  if (n.targetType === 'project') return !state.projects[n.targetId];
  if (n.targetType === 'chat') {
    const conversation = state.conversations[n.targetId];
    return !conversation || !canSeeConversation(state, conversation, viewer);
  }
  // A report notice reads as gone when it is hidden from the viewer (owner, 2026-10-07), or when its report is gone, as for a task.
  // An Undo of the send deletes the report but keeps a hidden notice, which must not show again when its person is an Admin again
  // (review 2026-10-07).
  if (n.targetType === 'feedback') return feedbackNoticeHidden(n, viewer) || !state.feedback?.[n.targetId];
  return false;
}

function viewOf(state: State, n: Notification, viewer: User): NotificationView {
  let target = '';
  let projectCode: string | null = null;
  let tile: { id: string; name: string; mark: number } | null = null;
  let link = '/notifications';
  let canApprove = false;
  const gone = isGone(state, n, viewer);
  let dueDate: string | null = null;
  if (n.targetType === 'task' && hiddenTask(state, n, viewer)) {
    // Nothing of an office task that the viewer no longer sees: no title, no day, no link (owner, 2026-10-06).
  } else if (n.targetType === 'task') {
    const task = state.tasks[n.targetId];
    const copy: Copy | null = task ?? deletedCopy(state, 'task', n.targetId);
    const project = state.projects[text(copy?.projectId)];
    target = text(copy?.title);
    projectCode = project?.code ?? null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    if (task) link = taskLink(task.projectId, task.id);
    // A reminder saved before it kept its day names the due day of the task.
    if (n.trigger === 'due_tomorrow') dueDate = n.dueDate ?? (text(copy?.dueDate) || null);
    canApprove = n.trigger === 'review_requested' && task?.status === 'in_review'
      && can(viewer, 'task.review', taskResource(state, task, viewer.id));
  } else if (n.targetType === 'update') {
    const update = state.updates[n.targetId];
    const copy: Copy | null = update ?? deletedCopy(state, 'update', n.targetId);
    const project = state.projects[text(copy?.projectId)];
    target = project?.name ?? '';
    projectCode = project?.code ?? null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    if (update) link = `/projects/${update.projectId}?tab=activity&update=${update.id}`;
  } else if (n.targetType === 'chat') {
    const conversation = state.conversations[n.targetId];
    const project = conversation?.projectId ? state.projects[conversation.projectId] : undefined;
    // A direct chat has no name of its own, and its other member is the sender, so the target stays empty and the
    // screen says "a direct message" (audit 2026-10-03, SHL-14).
    target = project?.name ?? '';
    projectCode = project?.code ?? null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    if (!gone) link = `/inbox/${n.targetId}`;
  } else if (n.targetType === 'project') {
    const project = state.projects[n.targetId];
    const copy: Copy | null = project ?? deletedCopy(state, 'project', n.targetId);
    target = text(copy?.name);
    projectCode = copy ? text(copy.code) || null : null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    if (project) link = `/projects/${project.id}`;
  } else if (n.targetType === 'feedback') {
    if (gone) {
      // A former Admin reads nothing of the report: no words, no sender and no link (owner, 2026-10-07). The same for a report
      // that is gone, because the Undo of its send says that it never came (review 2026-10-07). The notice also loses the report id
      // and the story of the send: no screen reads them for a gone report notice, and targetId may not be empty (review 2026-10-07).
      const { feedback: _words, correlationId: _story, ...rest } = n;
      return {
        notification: { ...rest, actorId: null, targetId: 'hidden' }, actor: null, target: '', projectCode: null, project: null, link: '',
        needsAction: ACTION_TRIGGERS.has(n.trigger), canApprove: false, gone, dueDate: null,
      };
    }
    // The notice keeps the start of the message, so it needs no report row. A done notice opens nothing: it only tells the sender.
    target = n.feedback?.excerpt ?? '';
    link = n.trigger === 'feedback_sent' ? '/admin/feedback' : '';
  }
  return {
    notification: n, actor: n.actorId ? cardOf(state, n.actorId) : null, target, projectCode, project: tile, link,
    needsAction: ACTION_TRIGGERS.has(n.trigger), canApprove, gone, dueDate,
  };
}

const mine = (ctx: Ctx) => Object.values(ctx.state.notifications).filter((n) => n.userId === ctx.authority.id);

function counts(ctx: Ctx): { unread: number; badge: number } {
  const unread = mine(ctx).filter((n) => !n.read);
  // A notice of a deleted item has nothing to open and nothing to do, so the badge leaves it out (audit 2026-10-03, SHL-12).
  const badge = unread.filter((n) => ACTION_TRIGGERS.has(n.trigger) && !isGone(ctx.state, n, ctx.authority));
  return { unread: unread.length, badge: badge.length };
}

export const notificationsList = defineCall({
  input: z.object({ unreadOnly: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(100) }),
  output: z.array(NotificationView),
  readOnly: true,
  run(input, ctx) {
    const sorted = mine(ctx)
      .filter((n) => !input.unreadOnly || !n.read)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    // Every unread notice shows, so the bell never counts one that the list hides. The newest read ones fill the rest
    // of the limit, and the list keeps its order by time (audit 2026-10-03, SHL-13).
    let room = Math.max(0, input.limit - sorted.filter((n) => !n.read).length);
    return sorted
      .filter((n) => !n.read || room-- > 0)
      .map((n) => viewOf(ctx.state, n, ctx.authority));
  },
});

export const notificationsCount = defineCall({
  input: z.object({}),
  output: Counts,
  readOnly: true,
  run(_input, ctx) {
    return counts(ctx);
  },
});

export const notificationsMarkRead = defineCall({
  input: z.object({ ids: z.array(NotificationId).min(1).max(200) }),
  output: Counts,
  run(input, ctx) {
    for (const id of input.ids) {
      const n = ctx.state.notifications[id];
      if (!n) throw notFound('Notification', id);
      if (n.userId !== ctx.authority.id) throw forbidden('This notification belongs to someone else.');
      n.read = true;
    }
    return counts(ctx);
  },
});

export const notificationsMarkAllRead = defineCall({
  input: z.object({}),
  output: Counts,
  run(_input, ctx) {
    for (const n of mine(ctx)) n.read = true;
    return counts(ctx);
  },
});

/** Marks my notices unread again: the Undo of "Mark all read" (audit 2026-10-03, SHL-16). A notice that is gone by now is skipped. */
export const notificationsMarkUnread = defineCall({
  input: z.object({ ids: z.array(NotificationId).min(1).max(200) }),
  output: Counts,
  run(input, ctx) {
    for (const id of input.ids) {
      const n = ctx.state.notifications[id];
      if (n && n.userId !== ctx.authority.id) throw forbidden('This notification belongs to someone else.');
    }
    for (const id of input.ids) {
      const n = ctx.state.notifications[id];
      if (n) n.read = false;
    }
    return counts(ctx);
  },
});

/**
 * One switch at a time: an in-app switch ({ trigger, on }), an email switch ({ channel: 'email', trigger, on }), or the morning
 * summary ({ morningSummary }). The email switches and the summary are the real build's (plan 4.13, A7; spec 2, section 10).
 */
const SettingsChange = z.object({
  channel: z.enum(['app', 'email']).default('app'),
  trigger: Trigger.optional(),
  on: z.boolean().optional(),
  morningSummary: z.boolean().optional(),
}).refine(
  (change) => (change.trigger !== undefined && change.on !== undefined) !== (change.morningSummary !== undefined)
    && (change.morningSummary === undefined || (change.trigger === undefined && change.on === undefined)),
  { message: 'Name one switch: a trigger with on, or morningSummary.', path: ['trigger'] },
);

export const notificationsUpdateSettings = defineCall({
  input: SettingsChange,
  output: User,
  run(input, ctx) {
    const prefs = ctx.authority.preferences;
    const email = input.channel === 'email' || input.morningSummary !== undefined;
    // An email leaves the office, so only the person sets where their email goes. Their agent may not.
    if (email && ctx.actor.kind === 'agent') throw forbidden('Only the person changes their email settings.', { action: 'notifications.email' });
    // The notices of requests and bugs have no email switch (owner, 2026-10-07).
    if (input.channel === 'email' && input.trigger !== undefined && !isEmailTrigger(input.trigger)) {
      throw invalid('trigger', 'This notice stays in the app. It sends no email.', 'in_app_only');
    }
    const next = input.morningSummary !== undefined
      ? { ...prefs, morningSummary: input.morningSummary }
      : input.channel === 'email'
        ? { ...prefs, email: { ...prefs.email, [input.trigger!]: input.on! } }
        : { ...prefs, notifications: { ...prefs.notifications, [input.trigger!]: input.on! } };
    // The stored record takes the change. A change to the context copy is lost, because the copy holds the office rights.
    const me = ctx.state.users[ctx.authority.id];
    applyPatch(ctx, me, { preferences: next }, { projectId: null, verb: 'user.preferences_changed', targetType: 'user', targetId: ctx.authority.id });
    return me;
  },
});

export const notificationCalls = {
  'notifications.list': notificationsList,
  'notifications.count': notificationsCount,
  'notifications.markRead': notificationsMarkRead,
  'notifications.markAllRead': notificationsMarkAllRead,
  'notifications.markUnread': notificationsMarkUnread,
  'notifications.updateSettings': notificationsUpdateSettings,
};
