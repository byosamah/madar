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
  'createdAt', 'updatedAt', 'completedAt', 'editedAt', 'uploadedAt', 'setAt', 'closedAt', 'lastReadAt', 'at', 'openedAt', 'finishedAt', 'doneAt', 'settledAt',
]);
/**
 * The start and the end of a meeting (fbk_022). A meeting is planned for later, so these stamps move with the days, but settleFuture
 * never pulls them back to before now.
 */
const PLANNED_FIELDS = new Set(['startsAt', 'endsAt']);

const isDay = (key: string, item: unknown): item is string => DAY_FIELDS.has(key) && typeof item === 'string' && DAY.test(item);
const isStamp = (key: string, item: unknown): item is string => STAMP_FIELDS.has(key) && typeof item === 'string' && STAMP.test(item);
const isPlanned = (key: string, item: unknown): item is string => PLANNED_FIELDS.has(key) && typeof item === 'string' && STAMP.test(item);

/** Builds a copy of a value. Each day field goes through "day" and each stamp field through "stamp", when that function is given. */
function mapDateFields<T>(value: T, fns: { day?: (day: string) => string; stamp?: (stamp: string) => string; planned?: (stamp: string) => string }): T {
  if (Array.isArray(value)) return value.map((item) => mapDateFields(item, fns)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    fns.day && isDay(key, item) ? fns.day(item)
      : fns.stamp && isStamp(key, item) ? fns.stamp(item)
        : fns.planned && isPlanned(key, item) ? fns.planned(item)
          : mapDateFields(item, fns),
  ])) as T;
}

/** Gives each stamp field to "visit". It only reads, so a scan builds no copy of the state. */
function eachStamp(value: unknown, visit: (stamp: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) eachStamp(item, visit);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (isStamp(key, item)) visit(item);
      else eachStamp(item, visit);
    }
  }
}

function shiftFields<T>(value: T, days: number): T {
  const moved = (stamp: string) => nowStamp(new Date(new Date(stamp).getTime() + days * DAY_MS));
  return mapDateFields(value, { day: (day) => addDays(day, days), stamp: moved, planned: moved });
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

/**
 * Nothing in the office happened later than "at" (audit 2026-10-03, BRW-4). The sample office is written at fixed hours of today,
 * and the daily shift moves yesterday's afternoon to today's. Every stamp later than "at" moves to just before it, in the same order,
 * one minute apart when there is room, after the latest earlier stamp of the same day. A stamp in the past stays as it is.
 */
export function settleFuture(state: State, at: Date): State {
  const limit = at.getTime();
  const future = new Set<string>();
  let floor = Date.parse(`${todayISO(at)}T00:00:00.000+03:00`);
  eachStamp(state, (stamp) => {
    const time = Date.parse(stamp);
    if (time > limit) future.add(stamp);
    else if (time > floor) floor = time;
  });
  if (future.size === 0) return state;
  const order = [...future].sort((a, b) => Date.parse(a) - Date.parse(b));
  const step = Math.floor(Math.min(60_000, (limit - floor) / (order.length + 1)));
  const moved = new Map(order.map((stamp, i) => [stamp, nowStamp(new Date(limit - (order.length - i) * step))]));
  return mapDateFields(state, { stamp: (stamp) => moved.get(stamp) ?? stamp });
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
