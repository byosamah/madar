import { computeHealth } from '../api/health';
import type { State } from '../api/store';

/** Counts the health of every active project in a state. */
export function healthCounts(state: State, today: string): { on_track: number; at_risk: number; late: number } {
  const counts = { on_track: 0, at_risk: 0, late: 0 };
  for (const project of Object.values(state.projects)) {
    const health = computeHealth({
      project,
      stages: Object.values(state.stages).filter((s) => s.projectId === project.id),
      tasks: Object.values(state.tasks).filter((t) => t.projectId === project.id),
    }, today);
    if (health) counts[health.value] += 1;
  }
  return counts;
}
