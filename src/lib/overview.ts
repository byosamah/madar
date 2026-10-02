import type { TaskRow } from '../api/contract/views';
import { diffDays } from './dates';
import { compareTasks } from './stageFlow';
import { involves } from './taskPeople';

const open = (row: TaskRow) => row.task.status === 'todo' || row.task.status === 'in_progress';
/** Time order (owner, 2026-10-02): start date, then due date, then the title. */
const byDue = (a: TaskRow, b: TaskRow) => compareTasks(a.task, b.task);

/**
 * What each person works on now (owner's request, 2026-10-01): the task in progress with the nearest date,
 * or else the next task to do. Also how many open tasks the person has.
 */
export function currentWork(rows: TaskRow[], userId: string): { now: TaskRow | null; open: number } {
  const mine = rows.filter((row) => involves(row.task, userId) && open(row)).sort(byDue);
  const doing = mine.filter((row) => row.task.status === 'in_progress');
  return { now: doing[0] ?? mine[0] ?? null, open: mine.length };
}

/** What needs the team's attention: past-due work, work that waits for review, and flagged work. */
export function needsAttention(rows: TaskRow[], today: string): { pastDue: TaskRow[]; review: TaskRow[]; flagged: TaskRow[] } {
  return {
    pastDue: rows.filter((row) => open(row) && row.task.dueDate !== null && row.task.dueDate < today).sort(byDue),
    review: rows.filter((row) => row.task.status === 'in_review').sort(byDue),
    flagged: rows.filter((row) => row.task.flagged && row.task.status !== 'done').sort(byDue),
  };
}

/** Where the project stands in its current stage: tasks done in the stage, and days to the stage's end (negative when late). */
export function stageStanding(rows: TaskRow[], stage: { id: string; endDate: string | null }, today: string): { done: number; total: number; daysLeft: number | null } {
  const inStage = rows.filter((row) => row.task.stageId === stage.id);
  return {
    done: inStage.filter((row) => row.task.status === 'done').length,
    total: inStage.length,
    daysLeft: stage.endDate ? diffDays(today, stage.endDate) : null,
  };
}
