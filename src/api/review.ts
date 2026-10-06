import type { State } from './store';
import { stampDay } from '../lib/dates';

/**
 * The day each of these tasks last went to review: the newest change that set its status to in_review and that nobody undid.
 * A task that no change names (one saved before the History kept it) has no day here. Time in review is not the owner's lateness
 * (audit 2026-10-03, API-4), and the Dashboard shows how long a review waits (owner, 2026-10-06).
 */
export function sentToReviewOn(state: Pick<State, 'events'>, taskIds: ReadonlySet<string>): Map<string, string> {
  const newest = new Map<string, { seq: number; day: string }>();
  for (const event of Object.values(state.events)) {
    if (event.targetType !== 'task' || !taskIds.has(event.targetId) || event.verb === 'undo' || event.undoneBy) continue;
    if ((event.after as { status?: string } | null)?.status !== 'in_review') continue;
    const known = newest.get(event.targetId);
    if (!known || event.seq > known.seq) newest.set(event.targetId, { seq: event.seq, day: stampDay(event.createdAt) });
  }
  return new Map([...newest].map(([id, { day }]) => [id, day]));
}
