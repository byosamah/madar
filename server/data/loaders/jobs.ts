import type { State } from '../../../src/api/store';
import { MEETING_SOON_MS } from '../../../src/api/notify';
import { Load, type LoadCtx } from './build';

/**
 * The jobs loader (plan 4.6, the 15-minute job of track N3; not a call): the open tasks of active projects and the open office
 * tasks, which the due and overdue reminders read. Paused projects with a restart day, the reviewers and the people are in the
 * office. The job passes notify a dedupe lookup backed by the unique index (plan 4.13, A3), so it loads no notices.
 * It also loads the scheduled meetings that start in the next hour (fbk_022), for the reminder of 30 minutes before the start. The job
 * passes the time of its run (LoadCtx.now); without it no meeting is read.
 */
export async function loadJobs(lx: Omit<LoadCtx, 'actorId' | 'write'>): Promise<State> {
  const L = new Load({ ...lx, actorId: '', write: true });
  const active = Object.values(L.office.projects).filter((p) => p.status === 'active').map((p) => p.id);
  await L.select({ c: 'tasks', where: [{ col: 'project_id', in: active }, { col: 'status', in: ['todo', 'in_progress'] }] });
  // An office task has no project, so its reminders always run (owner, 2026-10-06).
  await L.select({ c: 'tasks', where: [{ col: 'project_id', eq: null }, { col: 'status', in: ['todo', 'in_progress'] }] });
  if (lx.now) {
    // The window is twice the reminder: the job runs every 15 minutes, and a late run still falls inside it.
    const hour = new Date(lx.now.getTime() + 2 * MEETING_SOON_MS).toISOString();
    await L.select({ c: 'meetings', where: [{ col: 'status', eq: 'scheduled' }, { col: 'starts_at', atOrAfter: lx.now.toISOString() }, { col: 'starts_at', atBefore: hour }] });
  }
  return L.state();
}
