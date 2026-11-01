import { addDays, weekStartOf } from './dates';

/** The part of a to-do row that the busy-week rule reads. A row of `tasks.list` has more; the rule keeps the whole row. */
export type BusyRow = {
  task: { id: string; title: string; ownerId: string | null; status: string; dueDate: string | null };
};

/** The statuses that count as open work for the rule. A to-do in review or done adds no load. */
export const BUSY_STATUSES = ['todo', 'in_progress'] as const;

/** The Saturday that ends the office week of a day. The week starts on Sunday (`weekStartOf`). */
export function weekEndOf(day: string): string {
  return addDays(weekStartOf(day), 6);
}

/**
 * The to-dos of one lead that cross the date of a new or changed to-do (tsk_499, owner, 2026-11-01).
 * `week`: open to-dos that the person leads, due from the Sunday to the Saturday of the week of `due`, sorted by due date.
 * `pastDue`: open to-dos that the person leads, due before `today`.
 * A to-do is in one list only. When the chosen week holds days before today, a to-do on those days is past due, not in the week.
 * A to-do due after today and before the week counts in neither list. `openId` is the to-do that the person has open: it never counts itself.
 * The rows come from `tasks.list`, whose `ownerId` filter also matches a helper: this rule keeps the lead only.
 */
export function splitBusy<T extends BusyRow>(
  rows: readonly T[] | undefined,
  { leadId, due, today, openId }: { leadId: string; due: string; today: string; openId?: string | null },
): { week: T[]; pastDue: T[] } {
  const first = weekStartOf(due);
  const last = weekEndOf(due);
  const week: T[] = [];
  const pastDue: T[] = [];
  for (const row of rows ?? []) {
    const { task } = row;
    if (task.id === openId || task.ownerId !== leadId || task.dueDate === null) continue;
    if (!(BUSY_STATUSES as readonly string[]).includes(task.status)) continue;
    if (task.dueDate < today) pastDue.push(row);
    else if (task.dueDate >= first && task.dueDate <= last) week.push(row);
  }
  week.sort((a, b) => (a.task.dueDate! < b.task.dueDate! ? -1 : a.task.dueDate! > b.task.dueDate! ? 1 : 0));
  return { week, pastDue };
}
