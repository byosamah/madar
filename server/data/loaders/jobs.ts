import type { State } from '../../../src/api/store';
import { MEETING_SOON_MS } from '../../../src/api/notify';
import { addDays, todayISO } from '../../../src/lib/dates';
import { Load, type LoadCtx } from './build';
import type { Cond } from './query';

/**
 * The task fields that the reminders read (runScheduledTriggers, notify, peopleOfTask, mayViewTask): the day and the status, the
 * project, and the lead, the helpers and the maker for the people of a task. The job writes no task, so it loads only these
 * (performance audit DB-2, perf2).
 */
export const JOB_TASK_FIELDS = ['id', 'projectId', 'status', 'dueDate', 'ownerId', 'helperIds', 'createdBy'] as const;

/**
 * A task due later than this many days from today has no reminder yet: "due tomorrow" goes out on the last working day before the due
 * day, and a weekend (Friday and Saturday) is two days, so a task due on Sunday is named on Thursday, 3 days before. One day more is
 * kept for the safety of the bound. A task with no due day has no reminder, so it is left out too.
 */
export const JOB_DUE_AHEAD_DAYS = 4;

/**
 * The jobs loader (plan 4.6, the 15-minute job of track N3; not a call): the open tasks of active projects and the open office
 * tasks, which the due and overdue reminders read. Paused projects with a restart day, the reviewers and the people are in the
 * office. The job passes notify a dedupe lookup backed by the unique index (plan 4.13, A3), so it loads no notices.
 * It also loads the scheduled meetings that start in the next hour (fbk_022), for the reminder of 30 minutes before the start. The job
 * passes the time of its run (LoadCtx.now); without it no meeting is read.
 * It also loads the open payments that fall due on the day of the run, for the due notice of the Daftra link (owner, 2026-10-26). The
 * check of a linked payment and of an internal project stays in runScheduledTriggers; the project comes from the office.
 */
export async function loadJobs(lx: Omit<LoadCtx, 'actorId' | 'write'>): Promise<State> {
  const L = new Load({ ...lx, actorId: '', write: true });
  const active = Object.values(L.office.projects).filter((p) => p.status === 'active').map((p) => p.id);
  // The bound on the due day needs the time of the run. The test is on the first instant of the day after the last day that is kept.
  const due: Cond[] = lx.now ? [{ col: 'due_date', atBefore: `${addDays(todayISO(lx.now), JOB_DUE_AHEAD_DAYS + 1)}T00:00:00+03:00` }] : [];
  const open: Cond = { col: 'status', in: ['todo', 'in_progress'] };
  await L.select({ c: 'tasks', where: [{ col: 'project_id', in: active }, open, ...due], pick: JOB_TASK_FIELDS });
  // An office task has no project, so its reminders always run (owner, 2026-10-06).
  await L.select({ c: 'tasks', where: [{ col: 'project_id', eq: null }, open, ...due], pick: JOB_TASK_FIELDS });
  if (lx.now) {
    // The window is twice the reminder: the job runs every 15 minutes, and a late run still falls inside it.
    const hour = new Date(lx.now.getTime() + 2 * MEETING_SOON_MS).toISOString();
    await L.select({ c: 'meetings', where: [{ col: 'status', eq: 'scheduled' }, { col: 'starts_at', atOrAfter: lx.now.toISOString() }, { col: 'starts_at', atBefore: hour }] });
  }
  if (lx.now) {
    // The due notice goes out on the due day only, so the load is the open payments of that one day. Both fields are plain doc fields.
    await L.select({ c: 'payments', where: [{ field: 'dueDate', in: [todayISO(lx.now)] }, { field: 'receivedOn', null: true }] });
  }
  return L.state();
}
