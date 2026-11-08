import type { TaskRow } from '../api/contract/views';
import { addDays, dayOfWeek, stampDay, weekStartOf } from './dates';

/**
 * The weekly question (fbk_088, owner 2026-11-08). The work week runs from Sunday to Thursday, in office time. On Sunday to Wednesday Home asks
 * for the plan, and on Thursday to Saturday it asks for the review. The week of an answer is the Sunday that starts it.
 */
export type WeekKind = 'plan' | 'review';

/** The question that Home shows on this day. */
export const weekKindOf = (today: string): WeekKind => (dayOfWeek(today) < 4 ? 'plan' : 'review');

/**
 * The question that the reminder asks at this moment, or null (fbk_088, owner 2026-11-08, office time). The plan goes from 08:00 on Sunday and the
 * review from 14:00 on Thursday, both until the work hours end at 17:00. The job runs every 15 minutes, so the first run of the window sends the
 * notice, and a later run of the same window sends none because the dedupe key holds the week.
 */
export function weekSlotAt(weekday: number, hour: number): WeekKind | null {
  if (weekday === 0 && hour >= 8 && hour < 17) return 'plan';
  if (weekday === 4 && hour >= 14 && hour < 17) return 'review';
  return null;
}

/** The Sunday that starts the week of a day. */
export const weekOf = weekStartOf;

/** The day on which the review of a week is due: its Thursday. The list of people who have not reviewed starts then. */
export const reviewDay = (week: string): string => addDays(week, 4);

/** True when the Sunday is a week that has begun by this day. A week to come has no answer. */
export const weekHasBegun = (week: string, today: string): boolean => week <= weekOf(today);

/**
 * The lines that the card offers (fbk_088). Sunday: the open to-dos of the person that fall due in this week, from Sunday to Saturday.
 * Thursday: the to-dos that the person finished since Sunday. A to-do with no project is left out, because an answer is read by everyone and
 * an office to-do is private to its people. The rows come from the Home list `tasks.list { filter: 'mine' }`, so the card asks the server for
 * nothing. The server drops what the card cannot know (a to-do of a hidden project), see `checkinItems` in handlers/checkins.ts.
 */
export function weekLines(kind: WeekKind, today: string, rows: readonly TaskRow[]): TaskRow[] {
  const from = weekOf(today);
  const to = addDays(from, 6);
  const shared = rows.filter((row) => row.project !== null);
  if (kind === 'plan') {
    return shared
      .filter((row) => (row.task.status === 'todo' || row.task.status === 'in_progress') && row.task.dueDate !== null && row.task.dueDate >= from && row.task.dueDate <= to)
      .sort((a, b) => (a.task.dueDate ?? '').localeCompare(b.task.dueDate ?? '') || a.task.title.localeCompare(b.task.title));
  }
  return shared
    .filter((row) => row.task.status === 'done' && row.task.completedAt !== null && stampDay(row.task.completedAt) >= from)
    .sort((a, b) => (a.task.completedAt ?? '').localeCompare(b.task.completedAt ?? '') || a.task.title.localeCompare(b.task.title));
}
