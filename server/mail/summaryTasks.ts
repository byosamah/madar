import { addDays, dayOfWeek, weekStartOf } from '../../src/lib/dates';
import { projectKey } from '../../src/lib/projectCode';

/**
 * The open tasks of the morning email (fbk_021, owner 2026-10-19). The email lists the open tasks of a person in three groups:
 * Past due, Today and This week. The groups follow the Work screen (workGroupOf in src/lib/myWork.ts), and inside a group the
 * tasks follow the shared order of the screens (a task with a place first, then the date). The email shows at most
 * SUMMARY_LINES_MAX lines in all, the past due first, and counts the rest.
 */

export const SUMMARY_LINES_MAX = 8;
/** A title shows on one line of at most this many characters; a longer one ends with an ellipsis. */
export const TITLE_MAX = 90;

/** One open task of the person, as the statement or the SQLite reader gives it. projectCode is null for an office task. */
export type OpenTask = { id: string; title: string; dueDate: string; rank: number | null; projectCode: string | null };

/** One line of the email. where: the project key, or null for an office task. due: the day "YYYY-MM-DD". */
export type SummaryLine = { title: string; where: string | null; due: string };

export type SummaryTasks = { pastDue: SummaryLine[]; today: SummaryLine[]; week: SummaryLine[]; more: number };

/**
 * The last day of "This week". The office works Sunday to Thursday, so on Friday and Saturday the week left is days off and
 * "This week" means the coming Sunday to Saturday: the same rule as the Work screen.
 */
export function weekEndOf(today: string): string {
  const start = dayOfWeek(today) >= 5 ? addDays(weekStartOf(today), 7) : weekStartOf(today);
  return addDays(start, 6);
}

function oneLine(title: string): string {
  const text = title.replace(/\s+/g, ' ').trim();
  const letters = [...text];
  return letters.length > TITLE_MAX ? `${letters.slice(0, TITLE_MAX - 1).join('')}…` : text;
}

/** A task with a place first (lowest first), then the others; inside both, the due day, the title and the id. */
function inOrder(a: OpenTask, b: OpenTask): number {
  const aPlaced = typeof a.rank === 'number';
  const bPlaced = typeof b.rank === 'number';
  if (aPlaced !== bPlaced) return aPlaced ? -1 : 1;
  if (aPlaced && bPlaced && a.rank !== b.rank) return (a.rank as number) - (b.rank as number);
  return a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

export function groupOpenTasks(tasks: readonly OpenTask[], today: string): SummaryTasks {
  const end = weekEndOf(today);
  const groups = { pastDue: [] as OpenTask[], today: [] as OpenTask[], week: [] as OpenTask[] };
  for (const item of tasks) {
    if (item.dueDate < today) groups.pastDue.push(item);
    else if (item.dueDate === today) groups.today.push(item);
    else if (item.dueDate <= end) groups.week.push(item);
  }
  const total = groups.pastDue.length + groups.today.length + groups.week.length;
  let room = SUMMARY_LINES_MAX;
  const take = (list: OpenTask[]): SummaryLine[] => {
    const lines = [...list].sort(inOrder).slice(0, room).map((item) => ({
      title: oneLine(item.title),
      where: item.projectCode === null ? null : projectKey(item.projectCode),
      due: item.dueDate,
    }));
    room -= lines.length;
    return lines;
  };
  const pastDue = take(groups.pastDue);
  const todayLines = take(groups.today);
  const week = take(groups.week);
  return { pastDue, today: todayLines, week, more: total - pastDue.length - todayLines.length - week.length };
}
