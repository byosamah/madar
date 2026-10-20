import { addDays, dayOfWeek, officeClock, stampDay } from '../../lib/dates';
import { firstWorkingDay } from '../../lib/workdays';

/** The start times of the form: 15-minute steps from 06:00 to 22:00 (fbk_022). A time outside the list stays a choice when it is the current value. */
export const TIME_SLOTS: readonly string[] = (() => {
  const slots: string[] = [];
  for (let minutes = 6 * 60; minutes <= 22 * 60; minutes += 15) {
    slots.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
  }
  return slots;
})();

/** The lengths of the form, in minutes. A length outside the list stays a choice when it is the current value. */
export const LENGTHS: readonly number[] = [15, 30, 45, 60, 90, 120, 180, 240];

/** The start of a form (a day and a time of the day) as a stamp in office time. */
export function stampOf(day: string, time: string): string {
  return `${day}T${time}:00.000+03:00`;
}

/** The office day and the time of the day (HH:MM) of a stamp, whatever offset the stamp has. */
export function splitStamp(stamp: string): { day: string; time: string } {
  const shifted = new Date(Date.parse(stamp) + 3 * 60 * 60_000).toISOString();
  return { day: stampDay(stamp), time: shifted.slice(11, 16) };
}

/**
 * The first day and time of a new meeting: the next full hour of today. Before 06:00 it is 09:00 today. After the last slot, or on a
 * Friday or a Saturday, it is 09:00 of the next working day. The person changes it at once, so this only saves a step.
 */
export function defaultSlot(at: Date): { day: string; time: string } {
  const { day, hour } = officeClock(at);
  const nextHour = hour + 1;
  const weekend = dayOfWeek(day) >= 5;
  if (weekend) return { day: firstWorkingDay(day), time: '09:00' };
  if (nextHour < 6) return { day, time: '09:00' };
  if (nextHour > 22) return { day: firstWorkingDay(addDays(day, 1)), time: '09:00' };
  return { day, time: `${String(nextHour).padStart(2, '0')}:00` };
}

/** The word key and values of a length: "30 min", "1 h", "1 h 30 min". The words are short, so no plural forms are needed. */
export function lengthWords(minutes: number): { key: string; values: Record<string, number> } {
  if (minutes < 60) return { key: 'meetings.form.min', values: { n: minutes } };
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? { key: 'meetings.form.hour', values: { n: hours } } : { key: 'meetings.form.hourMin', values: { h: hours, m: rest } };
}

/** The choices of Repeat in the form (wave 3). The empty choice is "Does not repeat". */
export const REPEATS = ['day', 'week', 'two_weeks'] as const;
export type RepeatEvery = (typeof REPEATS)[number];
