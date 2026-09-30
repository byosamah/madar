import type { Event, Notification } from '../api/contract/entities';
import type { State } from '../api/store';
import { addDays, diffDays, nowStamp, weekStartOf } from '../lib/dates';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_TEXT = /\d{4}-\d{2}-\d{2}/g;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

/** Only these fields hold dates. Text that people type never moves, even when it looks like a date. */
const DAY_FIELDS = new Set(['seededOn', 'startDate', 'targetEndDate', 'endDate', 'date', 'dueDate']);
const STAMP_FIELDS = new Set(['createdAt', 'updatedAt', 'completedAt', 'editedAt', 'uploadedAt', 'setAt']);

function shiftDay(value: unknown, days: number): unknown {
  return typeof value === 'string' && DAY.test(value) ? addDays(value, days) : value;
}

function shiftStamp(value: unknown, days: number): unknown {
  return typeof value === 'string' && STAMP.test(value) ? nowStamp(new Date(new Date(value).getTime() + days * DAY_MS)) : value;
}

function shiftFields<T>(value: T, days: number): T {
  if (Array.isArray(value)) return value.map((item) => shiftFields(item, days)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    DAY_FIELDS.has(key) ? shiftDay(item, days) : STAMP_FIELDS.has(key) ? shiftStamp(item, days) : shiftFields(item, days),
  ])) as T;
}

/**
 * Moves every date in the state by a number of days, so saved sample data stays relative to today.
 * Hours move by whole weeks, so each entry keeps its weekday, and hours that would land after today go.
 */
export function shiftState(state: State, days: number): State {
  if (days === 0) return state;
  const today = addDays(state.seededOn, days);
  const weeks = diffDays(weekStartOf(state.seededOn), weekStartOf(today));
  const { time, timeRows, weekUnlocks, events, notifications, ...rest } = state;
  const next = { ...shiftFields(rest, days), time: {}, timeRows: {}, events: {}, notifications: {} } as State;

  for (const entry of Object.values(time)) {
    const date = addDays(entry.date, weeks);
    if (date <= today) next.time[entry.id] = { ...entry, date };
  }
  for (const row of Object.values(timeRows)) {
    const weekStart = weekStartOf(addDays(row.weekStart, weeks));
    const key = `${row.userId}|${weekStart}|${row.projectId}|${row.stageId}|${row.taskId ?? '-'}`;
    next.timeRows[key] = { ...row, key, weekStart };
  }
  next.weekUnlocks = weekUnlocks.map((unlock) => ({ ...unlock, weekStart: weekStartOf(addDays(unlock.weekStart, weeks)) }));

  for (const event of Object.values(events)) {
    const moved: Event = shiftFields(event, days);
    if (event.targetType === 'time') {
      moved.before = shiftFields(event.before, weeks);
      moved.after = shiftFields(event.after, weeks);
    }
    next.events[event.id] = moved;
  }
  for (const notification of Object.values(notifications)) {
    const moved: Notification = shiftFields(notification, days);
    const delta = notification.targetType === 'week' ? weeks : days;
    if (notification.targetType === 'week') moved.targetId = addDays(notification.targetId, weeks);
    // The dedupe key holds the date it was sent for, so the reminder does not come back after the shift.
    if (notification.dedupeKey) moved.dedupeKey = notification.dedupeKey.replace(DAY_IN_TEXT, (day) => addDays(day, delta));
    next.notifications[notification.id] = moved;
  }
  return next;
}
