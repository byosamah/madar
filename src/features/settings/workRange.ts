import type { TFunction } from 'i18next';
import { clockFormat, localeFor, type Lang } from '../../lib/dates';
import { clockSteps, type Clock, type WorkRange } from '../../lib/quietHours';

/** The words of the weekdays and the times of the work range, for the Settings section and the Admin block (fbk_048). */

const WEEK = [0, 1, 2, 3, 4, 5, 6];

const weekdayFormats = new Map<string, Intl.DateTimeFormat>();
/** The name of a weekday (0 is Sunday): short ("Sun", «الأحد») or long. */
export function weekdayName(weekday: number, lang: Lang, style: 'short' | 'long' = 'short'): string {
  const key = `${lang}|${style}`;
  let format = weekdayFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(localeFor(lang), { weekday: style, timeZone: 'UTC' });
    weekdayFormats.set(key, format);
  }
  // 2026-10-04 is a Sunday.
  return format.format(new Date(Date.UTC(2026, 9, 4 + weekday)));
}

/** The seven weekdays in the order of the office week, from Sunday. */
export const WEEKDAYS: readonly number[] = WEEK;

/** A time of the day as the screens write it: "9:00 AM" and «9:00 ص». */
export function clockLabel(time: Clock, lang: Lang): string {
  return clockFormat(lang).format(new Date(`2026-10-04T${time}:00+03:00`));
}

/** The days as one phrase: "Sunday to Thursday" for a run of three days or more, else a list ("Sunday, Tuesday"). */
export function daysPhrase(days: readonly number[], lang: Lang, t: TFunction): string {
  const sorted = [...days].sort((a, b) => a - b);
  const run = sorted.length >= 3 && sorted.every((day, i) => i === 0 || day === sorted[i - 1] + 1);
  const name = (day: number) => weekdayName(day, lang, 'long');
  if (run) return t('quietHours.dayRange', { from: name(sorted[0]), to: name(sorted[sorted.length - 1]) });
  return sorted.map(name).join(lang === 'ar' ? '، ' : ', ');
}

/**
 * The 30-minute steps that a select offers for the start and for the end of a range. The start comes before the end by one step at least.
 * When a lock holds the range, the start stays at or before the start of the lock, and the end stays at or after the end of the lock. A
 * stored time outside the list stays in it, so a select never shows a blank.
 */
export function startOptions(value: WorkRange, lock?: { on: boolean; from: Clock }): Clock[] {
  const steps = clockSteps().filter((step) => step < value.to && (!lock?.on || step <= lock.from));
  return steps.includes(value.from) ? steps : [value.from, ...steps].sort();
}
export function endOptions(value: WorkRange, lock?: { on: boolean; to: Clock }): Clock[] {
  const steps = clockSteps().filter((step) => step > value.from && (!lock?.on || step >= lock.to));
  return steps.includes(value.to) ? steps : [...steps, value.to].sort();
}
