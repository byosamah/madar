import { z } from 'zod';

/**
 * Long lists for agents (owner, 2026-10-26). projects.list and tasks.list took 65,000 to 150,000 characters of an agent's context. They now
 * take three arguments of the tool only (run.ts takes them out before the call, so the call itself does not change):
 *   limit  how many rows (default 50, at most 200)
 *   offset where the page starts (default 0)
 *   full   true gives the full rows as before; the default gives short rows
 * The answer keeps `output` as the array of rows and adds `page: { total, offset, limit, next }` beside it. next is the offset of the next
 * page, or null on the last page.
 */

export const PAGED_TOOLS: ReadonlySet<string> = new Set(['projects.list', 'tasks.list']);
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const PagingArgs = {
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe('How many rows (default 50, at most 200).'),
  offset: z.number().int().min(0).optional().describe('The row to start at (default 0). Use page.next of the last answer.'),
  full: z.boolean().optional().describe('True gives the full rows. Leave it out for short rows.'),
};

export type PageInfo = { total: number; offset: number; limit: number; next: number | null };
export type Paging = { limit: number; offset: number; full: boolean };

/** The three arguments of a paged list, with their defaults. A value out of range is cut to the nearest allowed one. */
export function pagingOf(args: Record<string, unknown>): Paging {
  const whole = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback);
  return {
    limit: Math.min(MAX_LIMIT, Math.max(1, whole(args.limit, DEFAULT_LIMIT))),
    offset: Math.max(0, whole(args.offset, 0)),
    full: args.full === true,
  };
}

/** The arguments of the call itself: the three paging arguments are taken out. */
export function withoutPaging(args: Record<string, unknown>): Record<string, unknown> {
  const { limit: _limit, offset: _offset, full: _full, ...rest } = args;
  return rest;
}

/** Cuts one page out of all the rows. */
export function pageOf<T>(rows: readonly T[], paging: Paging): { rows: T[]; page: PageInfo } {
  const { limit, offset } = paging;
  const end = offset + limit;
  return { rows: rows.slice(offset, end), page: { total: rows.length, offset, limit, next: end < rows.length ? end : null } };
}

type UserRef = { name: string } | null | undefined;
type TaskListRow = {
  task: { id: string; title: string; status: string; projectId: string | null; stageId: string | null; ownerId: string | null; dueDate: string | null; flagged: boolean };
  owner?: UserRef;
  project?: { code: string; name: string } | null;
  stage?: { name: string } | null;
};
type ProjectListRow = {
  project: { id: string; code: string; name: string; nameAr?: string | null; kind?: string; status: string };
  currentStage?: { name: string } | null;
  health?: { value: string } | null;
  leader?: UserRef;
  nextDeadline?: { name: string; date: string; daysLeft: number } | null;
};

/** A task row of tasks.list in short form: only what an agent needs to pick a to-do. */
export function shortTaskRow(row: TaskListRow) {
  const { task } = row;
  return {
    id: task.id, title: task.title, status: task.status,
    projectId: task.projectId, projectCode: row.project?.code ?? null, projectName: row.project?.name ?? null,
    stageId: task.stageId, stageName: row.stage?.name ?? null,
    ownerId: task.ownerId, ownerName: row.owner?.name ?? null,
    dueDate: task.dueDate, flagged: task.flagged,
  };
}

/** A project row of projects.list in short form. */
export function shortProjectRow(row: ProjectListRow) {
  const { project } = row;
  return {
    id: project.id, code: project.code, name: project.name, nameAr: project.nameAr ?? null, kind: project.kind ?? 'client', status: project.status,
    stageName: row.currentStage?.name ?? null, health: row.health?.value ?? null, leaderName: row.leader?.name ?? null,
    nextDeadline: row.nextDeadline ? { name: row.nextDeadline.name, date: row.nextDeadline.date, daysLeft: row.nextDeadline.daysLeft } : null,
  };
}

export function shortRows(name: string, rows: readonly unknown[]): unknown[] {
  if (name === 'tasks.list') return rows.map((row) => shortTaskRow(row as TaskListRow));
  if (name === 'projects.list') return rows.map((row) => shortProjectRow(row as ProjectListRow));
  return [...rows];
}
