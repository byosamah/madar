import type { Event, Notification } from '../api/contract/entities';
import type { State } from '../api/store';
import { addDays, diffDays, nowStamp, todayISO, weekStartOf } from '../lib/dates';
import { dueFromDuration } from '../lib/workdays';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_TEXT = /\d{4}-\d{2}-\d{2}/g;
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const DAY_MS = 86_400_000;

/**
 * Only these fields hold dates. Text that people type never moves, even when it looks like a date. The read marks, the pause, the
 * "moved back" note, the date notes, the task versions and the report times move too (audit 2026-10-03, API-10).
 * The due day that a date note was made for moves with the due day of its task, so the two still match (audit 2026-10-03, V-3).
 */
const DAY_FIELDS = new Set(['seededOn', 'startDate', 'targetEndDate', 'contractStartDate', 'endDate', 'date', 'dueDate', 'receivedOn', 'resumeOn', 'forDueDate']);
const STAMP_FIELDS = new Set([
  'createdAt', 'updatedAt', 'completedAt', 'editedAt', 'uploadedAt', 'setAt', 'closedAt', 'lastReadAt', 'at', 'openedAt', 'finishedAt', 'doneAt',
]);

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
 * A dynamic task counts working days, and a shift can move the weekend under it. The due date stays where it is
 * (so the sample keeps its due words) and the start moves to the nearest day that gives the same due date.
 * When the due date falls on a weekend no start fits, so the due date is counted again from the start.
 */
function settleDynamicTasks(state: State): void {
  for (const task of Object.values(state.tasks)) {
    if (task.schedule !== 'dynamic' || !task.startDate || !task.durationDays || !task.dueDate) continue;
    if (dueFromDuration(task.startDate, task.durationDays) === task.dueDate) continue;
    const fit = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6]
      .map((step) => addDays(task.startDate as string, step))
      .find((start) => dueFromDuration(start, task.durationDays as number) === task.dueDate);
    if (fit) task.startDate = fit;
    else task.dueDate = dueFromDuration(task.startDate, task.durationDays);
  }
}

/** Gives every stamp field to "fn", in the same fields the shift moves. */
function mapStamps<T>(value: T, fn: (stamp: string) => string): T {
  if (Array.isArray(value)) return value.map((item) => mapStamps(item, fn)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    STAMP_FIELDS.has(key) && typeof item === 'string' && STAMP.test(item) ? fn(item) : mapStamps(item, fn),
  ])) as T;
}

/**
 * Nothing in the office happened later than "at" (audit 2026-10-03, BRW-4). The sample office is written at fixed hours of today,
 * and the daily shift moves yesterday's afternoon to today's. Every stamp later than "at" moves to just before it, in the same order,
 * one minute apart when there is room, after the latest earlier stamp of the same day. A stamp in the past stays as it is.
 */
export function settleFuture(state: State, at: Date): State {
  const limit = at.getTime();
  const future = new Set<string>();
  let floor = Date.parse(`${todayISO(at)}T00:00:00.000+03:00`);
  mapStamps(state, (stamp) => {
    const time = Date.parse(stamp);
    if (time > limit) future.add(stamp);
    else if (time > floor) floor = time;
    return stamp;
  });
  if (future.size === 0) return state;
  const order = [...future].sort((a, b) => Date.parse(a) - Date.parse(b));
  const step = Math.floor(Math.min(60_000, (limit - floor) / (order.length + 1)));
  const moved = new Map(order.map((stamp, i) => [stamp, nowStamp(new Date(limit - (order.length - i) * step))]));
  return mapStamps(state, (stamp) => moved.get(stamp) ?? stamp);
}

/**
 * Moves every date in the state by a number of days, so saved sample data stays relative to today.
 */
export function shiftState(state: State, days: number): State {
  if (days === 0) return state;
  const { events, notifications, ...rest } = state;
  const next = { ...shiftFields(rest, days), events: {}, notifications: {} } as State;


  settleDynamicTasks(next);
  for (const event of Object.values(events)) {
    next.events[event.id] = shiftFields(event, days) as Event;
  }
  for (const notification of Object.values(notifications)) {
    const moved: Notification = shiftFields(notification, days);
    // The dedupe key holds the date it was sent for, so the reminder does not come back after the shift.
    if (notification.dedupeKey) moved.dedupeKey = notification.dedupeKey.replace(DAY_IN_TEXT, (day) => addDays(day, days));
    next.notifications[notification.id] = moved;
  }
  return next;
}
