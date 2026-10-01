import { addDays, dayOfWeek } from './dates';

/** The office week is Sunday to Thursday. Friday and Saturday are the weekend. */
export function isWorkingDay(day: string): boolean {
  return dayOfWeek(day) <= 4;
}

/** The first working day on or after a day. A Friday or a Saturday moves to the next Sunday. */
export function firstWorkingDay(day: string): string {
  const weekday = dayOfWeek(day);
  return weekday <= 4 ? day : addDays(day, 7 - weekday);
}

/**
 * The due day of a task that starts on "start" and lasts a number of working days.
 * The first working day on or after the start is day 1, so 1 day ends on the day it starts.
 */
export function dueFromDuration(start: string, days: number): string {
  let day = firstWorkingDay(start);
  let left = days - 1;
  while (left > 0) {
    day = addDays(day, 1);
    if (isWorkingDay(day)) left -= 1;
  }
  return day;
}
