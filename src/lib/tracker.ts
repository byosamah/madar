import type { TrackerEntry } from '../api/contract/entities';
import { addDays, diffDays, weekStartOf } from './dates';

/** An open loop: the entry waits for someone and nobody closed it. */
export function isOpen(entry: Pick<TrackerEntry, 'waiting' | 'closedAt'>): boolean {
  return entry.waiting !== null && entry.closedAt === null;
}

/** How many whole days ago the exchange was. An entry dated in the future counts as 0. */
export function ageInDays(date: string, today: string): number {
  return Math.max(0, diffDays(date, today));
}

export type WeekGroup<T> = { weekStart: string; label: 'this' | 'last' | 'date'; items: T[] };

/** Groups entries that are already newest first by office week (Sunday to Saturday). */
export function groupByWeek<T>(items: T[], dateOf: (item: T) => string, today: string): WeekGroup<T>[] {
  const thisWeek = weekStartOf(today);
  const lastWeek = addDays(thisWeek, -7);
  const out: WeekGroup<T>[] = [];
  for (const item of items) {
    const weekStart = weekStartOf(dateOf(item));
    const last = out[out.length - 1];
    if (last?.weekStart === weekStart) {
      last.items.push(item);
      continue;
    }
    out.push({ weekStart, label: weekStart === thisWeek ? 'this' : weekStart === lastWeek ? 'last' : 'date', items: [item] });
  }
  return out;
}
