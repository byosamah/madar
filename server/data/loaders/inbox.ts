import type { Notification } from '../../../src/api/contract/entities';
import type { Load } from './build';

/**
 * The Inbox loader (plan 4.6): the notices of the person U. The badge and the list read only the unread notices and the newest
 * read ones, never every notice. Each notice brings its target row by id, so a live task never reads as deleted (AM 6, row 7),
 * and the list brings the delete event of each target that is gone (deletedCopy, AM 7.9).
 */

type Input = Record<string, unknown>;

async function unreadOf(L: Load, userId: string): Promise<void> {
  await L.select({ c: 'notifications', where: [{ col: 'user_id', in: [userId] }, { col: 'read', eq: false }] });
}

/**
 * The target of each notice that is not an office row: a task, a post or a report. Projects and chats are in the office. A report
 * notice reads as gone when its report is gone, so it needs the row, but the view takes no words from it (review 2026-10-07).
 */
async function targets(L: Load): Promise<void> {
  const notices = L.list<Notification>('notifications');
  await L.byKey('tasks', notices.filter((n) => n.targetType === 'task').map((n) => n.targetId));
  await L.byKey('updates', notices.filter((n) => n.targetType === 'update').map((n) => n.targetId));
  await L.byKey('feedback', notices.filter((n) => n.targetType === 'feedback').map((n) => n.targetId));
}

/** notifications.count, markAllRead, and the count that markRead and markUnread return. */
export async function inboxCount(L: Load, input: Input): Promise<void> {
  if (!L.authority) return;
  await unreadOf(L, L.authority.id);
  await L.byKey('notifications', (input.ids as string[] | undefined) ?? []);
  await targets(L);
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
  if (gone.length === 0) return;
  await L.select({
    c: 'events',
    where: [{ col: 'target_id', in: gone.map((n) => n.targetId) }, { col: 'verb', in: ['task.deleted', 'update.deleted', 'project.deleted'] }],
  });
}
