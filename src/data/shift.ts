import type { State } from '../api/store';
import { addDays, nowStamp, weekStartOf } from '../lib/dates';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

function shiftValue(value: unknown, days: number): unknown {
  if (typeof value === 'string') {
    if (DAY.test(value)) return addDays(value, days);
    if (STAMP.test(value)) return nowStamp(new Date(new Date(value).getTime() + days * DAY_MS));
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => shiftValue(item, days));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftValue(item, days)]));
  }
  return value;
}

/** Moves every date in the state by a number of days, so saved sample data stays relative to today. Weeks snap back to Sunday. */
export function shiftState(state: State, days: number): State {
  if (days === 0) return state;
  const next = shiftValue(state, days) as State;
  const rows: State['timeRows'] = {};
  for (const row of Object.values(next.timeRows)) {
    const weekStart = weekStartOf(row.weekStart);
    const key = `${row.userId}|${weekStart}|${row.projectId}|${row.stageId}|${row.taskId ?? '-'}`;
    rows[key] = { ...row, key, weekStart };
  }
  next.timeRows = rows;
  next.weekUnlocks = next.weekUnlocks.map((unlock) => ({ ...unlock, weekStart: weekStartOf(unlock.weekStart) }));
  for (const n of Object.values(next.notifications)) if (n.targetType === 'week') n.targetId = weekStartOf(n.targetId);
  return next;
}
