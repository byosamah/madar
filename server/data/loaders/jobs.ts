import type { State } from '../../../src/api/store';
import { Load, type LoadCtx } from './build';

/**
 * The jobs loader (plan 4.6, the 15-minute job of track N3; not a call): the open tasks of active projects, which the due and
 * overdue reminders read. Paused projects with a restart day, the reviewers and the people are in the office. The job passes
 * notify a dedupe lookup backed by the unique index (plan 4.13, A3), so it loads no notices.
 */
export async function loadJobs(lx: Omit<LoadCtx, 'actorId' | 'write'>): Promise<State> {
  const L = new Load({ ...lx, actorId: '', write: true });
  const active = Object.values(L.office.projects).filter((p) => p.status === 'active').map((p) => p.id);
  await L.select({ c: 'tasks', where: [{ col: 'project_id', in: active }, { col: 'status', in: ['todo', 'in_progress'] }] });
  return L.state();
}
