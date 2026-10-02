import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { Notification, NotificationId, Trigger, User, type Event } from '../contract/entities';
import { UserCard } from '../contract/views';
import { forbidden, notFound } from '../errors';
import { canSeeConversation } from '../chatState';
import { applyPatch } from '../events';
import type { State } from '../store';
import { can, projectRoleOf } from '../permissions';
import { cardOf } from '../views';
import { markOf } from '../../lib/projectMark';

/** The Inbox badge counts only unread items of these kinds (spec 3.2). */
export const ACTION_TRIGGERS: ReadonlySet<string> = new Set([
  'task_assigned', 'mention', 'due_tomorrow', 'overdue', 'review_requested', 'task_sent_back',
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

function viewOf(state: State, n: Notification, viewer: User): NotificationView {
  let target = '';
  let projectCode: string | null = null;
  let tile: { id: string; name: string; mark: number } | null = null;
  let link = '/notifications';
  let canApprove = false;
  let gone = false;
  if (n.targetType === 'task') {
    const task = state.tasks[n.targetId];
    const copy: Copy | null = task ?? deletedCopy(state, 'task', n.targetId);
    const project = state.projects[text(copy?.projectId)];
    target = text(copy?.title);
    projectCode = project?.code ?? null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    gone = !task;
    if (task) link = `/projects/${task.projectId}?tab=tasks&task=${task.id}`;
    canApprove = n.trigger === 'review_requested' && task?.status === 'in_review'
      && can(viewer, 'task.review', { projectRole: projectRoleOf(state, task.projectId, viewer.id) });
  } else if (n.targetType === 'update') {
    const update = state.updates[n.targetId];
    const copy: Copy | null = update ?? deletedCopy(state, 'update', n.targetId);
    const project = state.projects[text(copy?.projectId)];
    target = project?.name ?? '';
    projectCode = project?.code ?? null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    gone = !update;
    if (update) link = `/projects/${update.projectId}?tab=activity&update=${update.id}`;
  } else if (n.targetType === 'chat') {
    const conversation = state.conversations[n.targetId];
    const project = conversation?.projectId ? state.projects[conversation.projectId] : undefined;
    const otherId = conversation?.memberIds.find((id) => id !== viewer.id);
    target = project?.name ?? (otherId ? (state.users[otherId]?.name ?? '') : '');
    projectCode = project?.code ?? null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    gone = !conversation || !canSeeConversation(state, conversation, viewer);
    if (!gone) link = `/inbox/${n.targetId}`;
  } else if (n.targetType === 'project') {
    const project = state.projects[n.targetId];
    const copy: Copy | null = project ?? deletedCopy(state, 'project', n.targetId);
    target = text(copy?.name);
    projectCode = copy ? text(copy.code) || null : null;
    tile = project ? { id: project.id, name: project.name, mark: markOf(project) } : null;
    gone = !project;
    if (project) link = `/projects/${project.id}`;
  }
  return {
    notification: n, actor: n.actorId ? cardOf(state, n.actorId) : null, target, projectCode, project: tile, link,
    needsAction: ACTION_TRIGGERS.has(n.trigger), canApprove, gone,
  };
}

const mine = (ctx: Ctx) => Object.values(ctx.state.notifications).filter((n) => n.userId === ctx.authority.id);

function counts(ctx: Ctx): { unread: number; badge: number } {
  const unread = mine(ctx).filter((n) => !n.read);
  // A notice of a deleted item has nothing to open and nothing to do, so the badge leaves it out (audit 2026-10-03, SHL-12).
  const badge = unread.filter((n) => ACTION_TRIGGERS.has(n.trigger) && !viewOf(ctx.state, n, ctx.authority).gone);
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

export const notificationsUpdateSettings = defineCall({
  input: z.object({ trigger: Trigger, on: z.boolean() }),
  output: User,
  run(input, ctx) {
    const prefs = ctx.authority.preferences;
    const next = { ...prefs, notifications: { ...prefs.notifications, [input.trigger]: input.on } };
    applyPatch(ctx, ctx.authority, { preferences: next }, { projectId: null, verb: 'user.preferences_changed', targetType: 'user', targetId: ctx.authority.id });
    return ctx.authority;
  },
});

export const notificationCalls = {
  'notifications.list': notificationsList,
  'notifications.count': notificationsCount,
  'notifications.markRead': notificationsMarkRead,
  'notifications.markAllRead': notificationsMarkAllRead,
  'notifications.updateSettings': notificationsUpdateSettings,
};
