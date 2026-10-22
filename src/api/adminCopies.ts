import type { Notification, Trigger, User } from './contract/entities';
import { adminReachOf, canSeeConversation } from './chatState';
import { inAppOn, type NotifyInput } from './notify';
import { mayViewMeeting, mayViewTask } from './permissions';
import { ensureRights } from './rights';
import { nextId, type State } from './store';
import type { Ctx } from './registry';

/**
 * The copies for an Admin who picked "Everything" (owner, 2026-10-23). A copy is a notice of the office that the Admin did not get
 * as a recipient: the bell shows it with the names of the people the original went to. A copy sends no push and no mail (the push and
 * mail producers skip a notice with `forUserIds`), and it joins the story of the call, so an Undo of the story takes it back.
 *
 * The triggers that make a copy. A reminder (due_tomorrow, overdue, resume_due, meeting_soon), a private notice (added_to_group, and a
 * mention in a direct chat, a group, or a post) and a report notice (feedback_sent, feedback_done) never do: they would flood the bell.
 */
export const COPY_TRIGGERS: ReadonlySet<Trigger> = new Set<Trigger>([
  'task_assigned', 'review_requested', 'task_approved', 'task_sent_back', 'stage_changed', 'added_to_project', 'meeting_invited',
  'helper_joined', 'task_deleted', 'mention',
]);

/**
 * True when a notice call makes copies: its trigger is a copy trigger, and a mention is one only for a project chat message or a task
 * comment. A mention in a direct chat, a group or a project post is private or small, so it makes none.
 */
export function makesCopies(state: Pick<State, 'conversations'>, input: Pick<NotifyInput, 'trigger' | 'targetType' | 'targetId' | 'messageId' | 'everyone'>): boolean {
  if (!COPY_TRIGGERS.has(input.trigger)) return false;
  // An @everyone notice makes no copy (owner, 2026-10-22): it would name every person of the chat in one line for each message.
  if (input.everyone) return false;
  if (input.trigger !== 'mention') return true;
  if (input.targetType === 'chat') return state.conversations[input.targetId]?.kind === 'project';
  return input.targetType === 'task' && input.messageId !== undefined && input.messageId.startsWith('cmt_');
}

/** True when the Admin may see the target of the notice, by the rules that notify uses for the people it tells. */
function mayView(state: State, admin: User, input: NotifyInput): boolean {
  if (input.targetType === 'task') {
    const task = state.tasks[input.targetId];
    return task !== undefined && (task.projectId !== null || mayViewTask(state, ensureRights(state, admin), task));
  }
  if (input.targetType === 'meeting') {
    const meeting = state.meetings?.[input.targetId];
    return meeting !== undefined && mayViewMeeting(state, admin, meeting);
  }
  if (input.targetType === 'chat') {
    const conversation = state.conversations[input.targetId];
    return conversation !== undefined && canSeeConversation(state, conversation, admin);
  }
  return state.projects[input.targetId] !== undefined;
}

/**
 * Makes the copies of one notice call. "told" are the notices that the call made. One copy for each active human Admin who picked
 * "Everything", who is not a recipient of the call, not the actor and not the person behind an agent actor, who has the in-app switch
 * of the trigger on, and who may see the target. The copy names the people who got the original (forUserIds). The copies are not part
 * of the answer of notify: the caller of notify still sees only the original notices.
 */
export function copyForAdmins(state: State, actor: User | null, stamp: string, input: NotifyInput, told: readonly Notification[]): void {
  if (told.length === 0 || !makesCopies(state, input)) return;
  const forUserIds = [...new Set(told.map((n) => n.userId))];
  const recipients = new Set([...input.userIds, ...forUserIds]);
  for (const admin of Object.values(state.users)) {
    if (admin.kind !== 'human' || !admin.active || adminReachOf(admin) !== 'all') continue;
    if (recipients.has(admin.id)) continue;
    if (actor && (admin.id === actor.id || admin.id === actor.ownerId)) continue;
    if (!inAppOn(admin.preferences, input.trigger)) continue;
    if (!mayView(state, admin, input)) continue;
    const id = nextId(state, 'ntf');
    state.notifications[id] = {
      id, userId: admin.id, trigger: input.trigger, actorId: actor?.id ?? null, targetType: input.targetType, targetId: input.targetId,
      read: false, createdAt: stamp, dedupeKey: null,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
      ...(input.messageId ? { messageId: input.messageId } : {}),
      ...(input.reply ? { reply: true as const } : {}),
      ...(input.meeting ? { meeting: { ...input.meeting } } : {}),
      forUserIds,
    };
  }
}

/**
 * True for a copy. The push and mail producers use the same test on a stored notice: a copy has `forUserIds`.
 */
export const isCopy = (n: Pick<Notification, 'forUserIds'>): boolean => n.forUserIds !== undefined;

/**
 * Marks the copies of one message or comment that this call made as read. The restore of a deleted chat message makes its mention
 * notices again, already read, so it sends no second push and no second mail (chats.deleteMessage). The copies follow the same rule.
 */
export function readCopiesOf(ctx: Ctx, messageId: string): void {
  for (const n of Object.values(ctx.state.notifications)) {
    if (isCopy(n) && n.messageId === messageId && n.correlationId === ctx.correlationId) n.read = true;
  }
}
