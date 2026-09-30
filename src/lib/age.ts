import { stampDay } from './dates';

export type Age = { unit: 'now' | 'minutes' | 'hours' | 'days' | 'weeks'; n: number } | { unit: 'date'; day: string };

/** How long ago a stamp was, in the largest whole unit. After four weeks, the office date shows instead. */
export function ageOf(stamp: string, now: Date): Age {
  const minutes = Math.floor((now.getTime() - new Date(stamp).getTime()) / 60_000);
  if (minutes < 1) return { unit: 'now', n: 0 };
  if (minutes < 60) return { unit: 'minutes', n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', n: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: 'days', n: days };
  const weeks = Math.floor(days / 7);
  if (weeks <= 4) return { unit: 'weeks', n: weeks };
  return { unit: 'date', day: stampDay(stamp) };
}
