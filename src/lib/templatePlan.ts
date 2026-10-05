import { addDays } from './dates';
import { addWorkingDays, firstWorkingDay, isWorkingDay } from './workdays';

/**
 * The date plan of a project template (owner, 2026-10-05). A template counts in working days from day 0, the project
 * start. "start" is the working-day offset of an item, "days" its length in working days. A locked item keeps its length
 * when the template stretches or shrinks. Every other item stretches or shrinks with the free time around it.
 */
export type PlanItem = { id: string; start: number; days: number; locked: boolean };
export type PlacedItem = { id: string; start: number; days: number };
export type WarpResult = { ok: true; length: number; items: PlacedItem[] } | { ok: false; needs: number };

/** The last end of all items, in working days from day 0. */
export function templateLength(items: Pick<PlanItem, 'start' | 'days'>[]): number {
  return items.reduce((last, item) => Math.max(last, item.start + item.days), 0);
}

/** The locked intervals, sorted and joined where they touch or overlap. */
function lockedIntervals(items: PlanItem[]): [number, number][] {
  const sorted = items.filter((item) => item.locked).map((item): [number, number] => [item.start, item.start + item.days]).sort((a, b) => a[0] - b[0]);
  const joined: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = joined[joined.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else joined.push([from, to]);
  }
  return joined;
}

/** The number of days that locked items cover. A day that two locked items cover counts once. */
export function lockedSpan(items: PlanItem[]): number {
  return lockedIntervals(items).reduce((sum, [from, to]) => sum + (to - from), 0);
}

/**
 * Stretches or shrinks the template to a target length in working days. The time that locked items cover keeps its
 * length. All other time (free items and gaps) scales by one factor, so the order of the items stays the same and the
 * last end falls on the target. A free item keeps at least 1 day. When the locked items need more days than the target,
 * the result says how many they need. When every item is locked, the items stay as they are.
 */
export function warpItems(items: PlanItem[], target: number): WarpResult {
  const locked = lockedIntervals(items);
  const fixed = locked.reduce((sum, [from, to]) => sum + (to - from), 0);
  if (target < Math.max(fixed, 1)) return { ok: false, needs: Math.max(fixed, 1) };
  const length = templateLength(items);
  const free = length - fixed;
  const place = (item: PlanItem, start: number, end: number): PlacedItem => ({ id: item.id, start, days: Math.max(1, end - start) });
  if (free <= 0) {
    const placed = items.map((item) => place(item, item.start, item.start + item.days));
    return { ok: true, length: templateLength(placed), items: placed };
  }
  const factor = (target - fixed) / free;
  // The new position of a moment t: locked time before t counts 1 to 1, free time before t counts by the factor.
  const warp = (t: number) => {
    const lockedBefore = locked.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(t, to) - from), 0);
    return lockedBefore + factor * (t - lockedBefore);
  };
  const placed = items.map((item) => place(item, Math.round(warp(item.start)), Math.round(warp(item.start + item.days))));
  return { ok: true, length: templateLength(placed), items: placed };
}

/** The number of working days from "from" to "to", both days in. 0 when "to" comes before "from". */
export function workingDaysInclusive(from: string, to: string): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) if (isWorkingDay(day)) count += 1;
  return count;
}

/** Turns working-day offsets into calendar days. Day 0 is the first working day on or after the project start. */
export function planDates(projectStart: string, items: PlacedItem[]): { id: string; startDate: string; dueDate: string }[] {
  const day0 = firstWorkingDay(projectStart);
  return items.map((item) => ({
    id: item.id,
    startDate: addWorkingDays(day0, item.start),
    dueDate: addWorkingDays(day0, item.start + item.days - 1),
  }));
}
