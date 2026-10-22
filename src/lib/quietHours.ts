import { dayOfWeek, nowStamp } from './dates';

/**
 * Quiet hours (owner, 2026-10-22, fbk_048). One pure module: no zod and no React, so the server (push, mail, the 15-minute job) and
 * the screens (Settings) read the same rule. All times are Riyadh time.
 *
 * - A person has work days and one time range. Outside it Madar is quiet for that person: no push and no email. The bell keeps all.
 * - The office sets the default range, and the lock. While the lock is on, nobody is quiet inside the lock days and hours.
 * - A missing value means the office default with quiet hours on, so a person who never chose is quiet outside Sunday to Thursday,
 *   9 AM to 5 PM.
 */

/** 0 is Sunday and 6 is Saturday, as dayOfWeek() counts. */
export type Weekday = number;
/** "HH:MM" on a 30-minute step. */
export type Clock = string;

export type WorkHours = { quiet: boolean; days: Weekday[]; from: Clock; to: Clock };
export type WorkRange = { days: readonly Weekday[]; from: Clock; to: Clock };
export type WorkLock = WorkRange & { on: boolean };
export type OfficeWorkHours = { days: Weekday[]; from: Clock; to: Clock; lock: { on: boolean; days: Weekday[]; from: Clock; to: Clock } };

/** The built-in default, in one place: Sunday to Thursday, 9 AM to 5 PM, with the lock on for the same days and hours. */
export const DEFAULT_OFFICE_WORK_HOURS: OfficeWorkHours = {
  days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00', lock: { on: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' },
};

/** The part of the person (Preferences) that this module reads. */
export type PersonLike = { workHours?: WorkHours | undefined } | null | undefined;
/** The part of the office settings (Settings) that this module reads. A stored value may miss a part. */
export type SettingsLike = { workHours?: Partial<Omit<OfficeWorkHours, 'lock'>> & { lock?: Partial<OfficeWorkHours['lock']> } | undefined } | null | undefined;

/** The office work hours with every missing part filled from the built-in default. */
export function officeWorkHoursOf(settings: SettingsLike): OfficeWorkHours {
  const saved = settings?.workHours;
  const fallback = DEFAULT_OFFICE_WORK_HOURS;
  return {
    days: [...(saved?.days ?? fallback.days)],
    from: saved?.from ?? fallback.from,
    to: saved?.to ?? fallback.to,
    lock: {
      on: saved?.lock?.on ?? fallback.lock.on,
      days: [...(saved?.lock?.days ?? fallback.lock.days)],
      from: saved?.lock?.from ?? fallback.lock.from,
      to: saved?.lock?.to ?? fallback.lock.to,
    },
  };
}

/** The effective work hours of a person: the choice of the person, else the office default with quiet hours on. */
export function workHoursOf(person: PersonLike, settings: SettingsLike): WorkHours {
  if (person?.workHours) return { quiet: person.workHours.quiet, days: [...person.workHours.days], from: person.workHours.from, to: person.workHours.to };
  const office = officeWorkHoursOf(settings);
  return { quiet: true, days: office.days, from: office.from, to: office.to };
}

/** The Riyadh weekday and the "HH:MM" of a moment. */
function riyadhClock(at: Date): { weekday: Weekday; time: Clock } {
  const stamp = nowStamp(at);
  return { weekday: dayOfWeek(stamp.slice(0, 10)), time: stamp.slice(11, 16) };
}

/** True when the moment is inside a range: a day of the range, and from <= time < to. */
function inside(range: WorkRange, weekday: Weekday, time: Clock): boolean {
  return range.days.includes(weekday) && time >= range.from && time < range.to;
}

/**
 * True when the person is in quiet hours at this moment: quiet hours are on, the moment is outside the range of the person, and it is
 * outside the lock (when the lock is on). At the minute of "from" the person is not quiet; at the minute of "to" the person is.
 */
export function isQuiet(person: PersonLike, settings: SettingsLike, at: Date): boolean {
  const mine = workHoursOf(person, settings);
  if (!mine.quiet) return false;
  const { weekday, time } = riyadhClock(at);
  if (inside(mine, weekday, time)) return false;
  const { lock } = officeWorkHoursOf(settings);
  return !(lock.on && inside(lock, weekday, time));
}

/** True when the range holds every day and every hour of the lock. While the lock is off, every range covers it. */
export function coversLock(range: WorkRange, lock: WorkLock): boolean {
  if (!lock.on) return true;
  return lock.days.every((day) => range.days.includes(day)) && range.from <= lock.from && range.to >= lock.to;
}

/**
 * The start of the work range of a person on a Riyadh day ("YYYY-MM-DD"), or null on a day off. The morning summary goes at this time.
 * A person with quiet hours off still has a range (the stored one, else the office default). A day of the lock counts as a work day,
 * and the lock start counts when it is earlier, because nobody is quiet inside the lock.
 */
export function workStartOn(person: PersonLike, settings: SettingsLike, day: string): Clock | null {
  const mine = workHoursOf(person, settings);
  const { lock } = officeWorkHoursOf(settings);
  const weekday = dayOfWeek(day);
  const lockDay = lock.on && lock.days.includes(weekday);
  if (mine.days.includes(weekday)) return lockDay && lock.from < mine.from ? lock.from : mine.from;
  return lockDay ? lock.from : null;
}

/** The 30-minute steps that a screen offers, from 06:00 to 23:30. */
export function clockSteps(): Clock[] {
  const steps: Clock[] = [];
  for (let minutes = 6 * 60; minutes < 24 * 60; minutes += 30) {
    steps.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`);
  }
  return steps;
}
