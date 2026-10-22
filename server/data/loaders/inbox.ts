import type { Event, Notification, Task, Update } from '../../../src/api/contract/entities';
import type { Load } from './build';
import { pickedByKey } from './steps';

/**
 * The Inbox loader (plan 4.6): the notices of the person U. The badge and the list read only the unread notices and the newest
 * read ones, never every notice. Each notice brings its target row by id, so a live task never reads as deleted (AM 6, row 7),
 * and the list brings the delete event of each target that is gone (deletedCopy, AM 7.9).
 */

type Input = Record<string, unknown>;

/**
 * The task fields that the bell reads (notifications.count, performance audit DB-M2): isGone and hiddenTask (notifications.ts)
 * read whether the task is there, and for an office task its view rule (mayViewTask): the project, the lead, the helpers and the
 * maker. A post or a report counts only by being there (feedbackNoticeHidden reads the notice alone), so it needs its id only.
 */
export const INBOX_TASK_FIELDS = ['id', 'projectId', 'ownerId', 'helperIds', 'createdBy'] as const;
/**
 * The post fields that the bell reads (hidden projects, owner 2026-10-22): whether the post is there, and its project (noticeProjectHidden,
 * src/api/hiddenNotice.ts), so the bell never counts a notice of a hidden project that the list shows as gone.
 */
export const INBOX_UPDATE_FIELDS = ['id', 'projectId'] as const;
/** The meeting fields that the bell reads (fbk_022): whether the meeting is there, and its view rule (mayViewMeeting). */
export const INBOX_MEETING_FIELDS = ['id', 'projectId', 'organizerId', 'attendeeIds'] as const;

/**
 * The notice fields that the bell count reads (notifications.count, performance audit DB-8, perf2): counts() reads the person, the read
 * mark and the trigger, isGone reads the target, and feedbackNoticeHidden reads the trigger and the report excerpt of a report notice.
 */
export const INBOX_COUNT_NOTICE_FIELDS = ['id', 'userId', 'read', 'trigger', 'targetType', 'targetId', 'feedback'] as const;

/** The unread notices of the person: whole rows, or only the fields of the count when "counted" (a read that never saves). */
async function unreadOf(L: Load, userId: string, counted = false): Promise<void> {
  await L.select({ c: 'notifications', where: [{ col: 'user_id', in: [userId] }, { col: 'read', eq: false }], ...(counted ? { pick: INBOX_COUNT_NOTICE_FIELDS } : {}) });
}

/**
 * The target of each notice that is not an office row: a task, a post, a meeting or a report. Projects and chats are in the office. A report
 * notice reads as gone when its report is gone, so it needs the row, but the view takes no words from it (review 2026-10-07).
 * counted: the read of the bell, which takes only the fields that its count reads (performance audit DB-M2). The list and the
 * writes keep whole rows.
 */
async function targets(L: Load, counted = false): Promise<void> {
  const notices = L.list<Notification>('notifications');
  const of = (type: Notification['targetType']) => notices.filter((n) => n.targetType === type).map((n) => n.targetId);
  if (counted) {
    await pickedByKey(L, 'tasks', of('task'), INBOX_TASK_FIELDS);
    await pickedByKey(L, 'updates', of('update'), INBOX_UPDATE_FIELDS);
    await pickedByKey(L, 'feedback', of('feedback'), ['id']);
    await pickedByKey(L, 'meetings', of('meeting'), INBOX_MEETING_FIELDS);
    return;
  }
  await L.byKey('tasks', of('task'));
  await L.byKey('updates', of('update'));
  await L.byKey('meetings', of('meeting'));
  await L.byKey('feedback', of('feedback'));
}

/**
 * The delete event of each project that a notice names through its item and that the office no longer holds (hidden projects, owner
 * 2026-10-22). noticeProjectHidden reads the last copy of such a project, and fails closed when it finds none, so the loader brings the
 * event of every project it needs: the project of a live to-do or post, and of the last copy of a deleted one (the events already loaded).
 */
async function deletedProjects(L: Load): Promise<void> {
  const notices = L.list<Notification>('notifications');
  const projectIds = new Set<string>();
  for (const n of notices) {
    if (n.targetType === 'task') {
      const task = L.get<Pick<Task, 'projectId'>>('tasks', n.targetId);
      if (task?.projectId) projectIds.add(task.projectId);
    } else if (n.targetType === 'update') {
      const update = L.get<Pick<Update, 'projectId'>>('updates', n.targetId);
      if (update?.projectId) projectIds.add(update.projectId);
    }
  }
  for (const event of L.list<Event>('events')) {
    if (event.verb !== 'task.deleted' && event.verb !== 'update.deleted') continue;
    const projectId = (event.before as { projectId?: unknown } | null)?.projectId;
    if (typeof projectId === 'string' && projectId !== '') projectIds.add(projectId);
  }
  const missing = [...projectIds].filter((id) => !L.get('projects', id));
  if (missing.length === 0) return;
  await L.select({ c: 'events', where: [{ col: 'target_id', in: missing }, { col: 'verb', in: ['project.deleted'] }] });
}

/** notifications.count, markAllRead, and the count that markRead and markUnread return. */
export async function inboxCount(L: Load, input: Input): Promise<void> {
  if (!L.authority) return;
  await unreadOf(L, L.authority.id, !L.write);
  await L.byKey('notifications', (input.ids as string[] | undefined) ?? []);
  await targets(L, !L.write);
  await deletedProjects(L);
}

/** notifications.list: every unread notice, the newest "limit" read ones, their targets, and the delete event of each gone target. */
export async function inboxList(L: Load, input: Input): Promise<void> {
  if (!L.authority) return;
  const userId = L.authority.id;
  await unreadOf(L, userId);
  if (input.unreadOnly !== true) {
    await L.select({
      c: 'notifications', where: [{ col: 'user_id', in: [userId] }, { col: 'read', eq: true }],
      order: { col: 'created_at', desc: true, id: true }, limit: (input.limit as number | undefined) ?? 100,
    });
  }
  await targets(L);
  const gone = L.list<Notification>('notifications').filter((n) => {
    if (n.targetType === 'task') return !L.get('tasks', n.targetId);
    if (n.targetType === 'update') return !L.get('updates', n.targetId);
    if (n.targetType === 'project') return !L.get('projects', n.targetId);
    return false;
  });
  if (gone.length > 0) {
    await L.select({
      c: 'events',
      where: [{ col: 'target_id', in: gone.map((n) => n.targetId) }, { col: 'verb', in: ['task.deleted', 'update.deleted', 'project.deleted'] }],
    });
  }
  await deletedProjects(L);
}
