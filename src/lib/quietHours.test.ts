import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OFFICE_WORK_HOURS, clockSteps, coversLock, isQuiet, officeWorkHoursOf, summaryStartOn, workHoursOf, workStartOn, type WorkHours,
} from './quietHours';

/** A Riyadh moment (UTC+3) as a Date. 2026-10-04 is a Sunday. */
const riyadh = (day: string, time: string): Date => new Date(`${day}T${time}:00+03:00`);

const SUN = '2026-10-04';
const WED = '2026-10-07';
const THU = '2026-10-08';
const FRI = '2026-10-09';
const SAT = '2026-10-10';

describe('the default office work hours', () => {
  it('are Sunday to Thursday, 8 AM to 5 PM, with the lock on for the same days and hours (fbk_049: the office works 8 to 5)', () => {
    expect(DEFAULT_OFFICE_WORK_HOURS).toEqual({
      days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00', lock: { on: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' },
    });
  });

  it('fill a missing value, and fill a part that is missing', () => {
    expect(officeWorkHoursOf(undefined)).toEqual(DEFAULT_OFFICE_WORK_HOURS);
    expect(officeWorkHoursOf({})).toEqual(DEFAULT_OFFICE_WORK_HOURS);
    const saved = { days: [1, 2], from: '08:00', to: '16:00', lock: { on: false, days: [1], from: '10:00', to: '12:00' } };
    expect(officeWorkHoursOf({ workHours: saved })).toEqual(saved);
  });
});

describe('the work hours of a person', () => {
  it('come from the office when the person chose nothing', () => {
    expect(workHoursOf(undefined, undefined)).toEqual({ quiet: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' });
    const office = { workHours: { days: [0, 1, 2], from: '08:00', to: '15:00', lock: { on: false, days: [0], from: '09:00', to: '10:00' } } };
    expect(workHoursOf({}, office)).toEqual({ quiet: true, days: [0, 1, 2], from: '08:00', to: '15:00' });
  });

  it('come from the choice of the person when there is one', () => {
    const mine: WorkHours = { quiet: false, days: [0, 2], from: '07:30', to: '14:00' };
    expect(workHoursOf({ workHours: mine }, undefined)).toEqual(mine);
  });
});

describe('isQuiet', () => {
  const nobody = { prefs: undefined, settings: undefined };

  it('is false inside the default work hours on a work day', () => {
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(SUN, '10:00'))).toBe(false);
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(WED, '16:59'))).toBe(false);
  });

  it('is true on a weekday evening and on a weekday morning', () => {
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(WED, '17:30'))).toBe(true);
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(WED, '07:59'))).toBe(true);
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(THU, '23:45'))).toBe(true);
  });

  it('is true all day on Friday and Saturday', () => {
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(FRI, '11:00'))).toBe(true);
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(SAT, '12:00'))).toBe(true);
  });

  it('is false on the minute of "from" and true on the minute of "to"', () => {
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(SUN, '08:00'))).toBe(false);
    expect(isQuiet(nobody.prefs, nobody.settings, riyadh(SUN, '17:00'))).toBe(true);
  });

  it('reads the Riyadh clock, not the UTC clock', () => {
    // 04:30 UTC is 07:30 in Riyadh (quiet). 05:30 UTC is 08:30 in Riyadh (not quiet).
    expect(isQuiet(nobody.prefs, nobody.settings, new Date('2026-10-04T04:30:00Z'))).toBe(true);
    expect(isQuiet(nobody.prefs, nobody.settings, new Date('2026-10-04T05:30:00Z'))).toBe(false);
    // 21:30 UTC on Thursday is 00:30 on Friday in Riyadh.
    expect(isQuiet(nobody.prefs, nobody.settings, new Date('2026-10-08T21:30:00Z'))).toBe(true);
  });

  it('is never true for a person who turned quiet hours off', () => {
    const prefs = { workHours: { quiet: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } };
    expect(isQuiet(prefs, undefined, riyadh(WED, '22:00'))).toBe(false);
    expect(isQuiet(prefs, undefined, riyadh(FRI, '03:00'))).toBe(false);
  });

  it('follows a wider range of the person', () => {
    const prefs = { workHours: { quiet: true, days: [0, 1, 2, 3, 4, 5], from: '07:00', to: '20:00' } };
    expect(isQuiet(prefs, undefined, riyadh(WED, '19:30'))).toBe(false);
    expect(isQuiet(prefs, undefined, riyadh(FRI, '10:00'))).toBe(false);
    expect(isQuiet(prefs, undefined, riyadh(SAT, '10:00'))).toBe(true);
    expect(isQuiet(prefs, undefined, riyadh(WED, '20:00'))).toBe(true);
  });

  it('follows the office default for a person with no choice', () => {
    const office = { workHours: { days: [0, 1, 2, 3, 4], from: '08:00', to: '16:00', lock: { on: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } } };
    expect(isQuiet(undefined, office, riyadh(WED, '08:15'))).toBe(false);
    expect(isQuiet(undefined, office, riyadh(WED, '16:15'))).toBe(true);
  });

  describe('the lock', () => {
    it('keeps a person out of quiet hours inside the lock, also when the stored range is narrower', () => {
      // The person works 11:00 to 14:00. The lock holds 8 AM to 5 PM on Sunday to Thursday.
      const prefs = { workHours: { quiet: true, days: [0, 1, 2, 3, 4], from: '11:00', to: '14:00' } };
      expect(isQuiet(prefs, undefined, riyadh(WED, '10:00'))).toBe(false);
      expect(isQuiet(prefs, undefined, riyadh(WED, '16:30'))).toBe(false);
      expect(isQuiet(prefs, undefined, riyadh(WED, '17:00'))).toBe(true);
      expect(isQuiet(prefs, undefined, riyadh(WED, '07:30'))).toBe(true);
    });

    it('covers a day of the lock that the person does not work', () => {
      const prefs = { workHours: { quiet: true, days: [0, 1, 2, 3], from: '09:00', to: '17:00' } };
      expect(isQuiet(prefs, undefined, riyadh(THU, '12:00'))).toBe(false);
    });

    it('ends when the Admin turns it off', () => {
      const prefs = { workHours: { quiet: true, days: [0, 1, 2, 3, 4], from: '11:00', to: '14:00' } };
      const off = { workHours: { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00', lock: { on: false, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } } };
      expect(isQuiet(prefs, off, riyadh(WED, '10:00'))).toBe(true);
    });

    it('uses the days and the hours the Admin sets', () => {
      const wide = { workHours: { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00', lock: { on: true, days: [0, 1, 2, 3, 4, 5], from: '08:00', to: '18:00' } } };
      const prefs = { workHours: { quiet: true, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' } };
      expect(isQuiet(prefs, wide, riyadh(WED, '17:45'))).toBe(false);
      expect(isQuiet(prefs, wide, riyadh(FRI, '10:00'))).toBe(false);
      expect(isQuiet(prefs, wide, riyadh(SAT, '10:00'))).toBe(true);
    });
  });
});

describe('coversLock', () => {
  const lock = { on: true, days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' };

  it('is true when the range holds every day and every hour of the lock', () => {
    expect(coversLock({ days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00' }, lock)).toBe(true);
    expect(coversLock({ days: [0, 1, 2, 3, 4, 5], from: '07:00', to: '20:00' }, lock)).toBe(true);
  });

  it('is false when a lock day, the start or the end is missing', () => {
    expect(coversLock({ days: [0, 1, 2, 3], from: '09:00', to: '17:00' }, lock)).toBe(false);
    expect(coversLock({ days: [0, 1, 2, 3, 4], from: '09:30', to: '17:00' }, lock)).toBe(false);
    expect(coversLock({ days: [0, 1, 2, 3, 4], from: '09:00', to: '16:30' }, lock)).toBe(false);
  });

  it('is always true while the lock is off', () => {
    expect(coversLock({ days: [6], from: '12:00', to: '13:00' }, { ...lock, on: false })).toBe(true);
  });
});

describe('workStartOn', () => {
  it('gives the start of the range on a work day', () => {
    expect(workStartOn(undefined, undefined, WED)).toBe('08:00');
    expect(workStartOn({ workHours: { quiet: true, days: [0, 1, 2, 3, 4], from: '07:30', to: '16:00' } }, { workHours: { days: [0], from: '09:00', to: '17:00', lock: { on: false, days: [0], from: '09:00', to: '17:00' } } }, WED)).toBe('07:30');
  });

  it('gives null on a day off', () => {
    expect(workStartOn(undefined, undefined, FRI)).toBeNull();
    expect(workStartOn(undefined, undefined, SAT)).toBeNull();
    expect(workStartOn({ workHours: { quiet: true, days: [0, 2], from: '08:00', to: '17:00' } }, { workHours: { days: [0], from: '09:00', to: '17:00', lock: { on: false, days: [0], from: '09:00', to: '17:00' } } }, WED)).toBeNull();
  });

  it('gives the start of a person who turned quiet hours off, from the stored range or the office default', () => {
    expect(workStartOn({ workHours: { quiet: false, days: [0, 1, 2, 3, 4], from: '07:30', to: '16:00' } }, undefined, SUN)).toBe('07:30');
    expect(workStartOn({ workHours: { quiet: false, days: [0, 1, 2, 3, 4], from: '07:30', to: '16:00' } }, undefined, FRI)).toBeNull();
    expect(workStartOn({}, undefined, SUN)).toBe('08:00');
  });

  it('starts at the lock when the lock starts earlier than the stored range', () => {
    expect(workStartOn({ workHours: { quiet: true, days: [0, 1, 2, 3, 4], from: '11:00', to: '17:00' } }, undefined, SUN)).toBe('08:00');
  });

  it('counts a lock day as a work day', () => {
    expect(workStartOn({ workHours: { quiet: true, days: [0, 1, 2, 3], from: '09:00', to: '17:00' } }, undefined, THU)).toBe('08:00');
  });
});

describe('summaryStartOn (fbk_058)', () => {
  const everyDay: WorkHours = { quiet: true, days: [0, 1, 2, 3, 4, 5, 6], from: '08:30', to: '17:00' };

  it('gives null on a Friday and a Saturday for a person with all 7 work days, while the office keeps Sunday to Thursday', () => {
    expect(summaryStartOn({ workHours: everyDay }, undefined, FRI)).toBeNull();
    expect(summaryStartOn({ workHours: everyDay }, undefined, SAT)).toBeNull();
  });

  it('gives the own start on a Sunday for that person', () => {
    expect(summaryStartOn({ workHours: everyDay }, undefined, SUN)).toBe('08:00');
    expect(summaryStartOn({ workHours: { ...everyDay, from: '09:00' } }, { workHours: { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00', lock: { on: false, days: [0], from: '09:00', to: '17:00' } } }, SUN)).toBe('09:00');
  });

  it('follows the own start of a person on an office work day, as workStartOn does', () => {
    const early: WorkHours = { quiet: false, days: [0, 1, 2, 3, 4], from: '07:30', to: '16:00' };
    expect(summaryStartOn({ workHours: early }, undefined, WED)).toBe(workStartOn({ workHours: early }, undefined, WED));
    expect(summaryStartOn({ workHours: early }, undefined, WED)).toBe('07:30');
    expect(summaryStartOn(undefined, undefined, WED)).toBe('08:00');
  });

  it('gives null on an office day off even when the person works that day', () => {
    expect(summaryStartOn({ workHours: { quiet: true, days: [0, 1, 2, 3, 4, 5], from: '08:00', to: '17:00' } }, undefined, FRI)).toBeNull();
  });

  it('sends on a Saturday when the office adds Saturday', () => {
    const settings = { workHours: { days: [0, 1, 2, 3, 4, 6], from: '08:00', to: '17:00', lock: { on: true, days: [0, 1, 2, 3, 4, 6], from: '08:00', to: '17:00' } } };
    expect(summaryStartOn({ workHours: everyDay }, settings, SAT)).toBe('08:00');
    expect(summaryStartOn(undefined, settings, SAT)).toBe('08:00');
    expect(summaryStartOn({ workHours: everyDay }, settings, FRI)).toBeNull();
  });

  it('gives null on a day off of the person even when it is an office work day', () => {
    expect(summaryStartOn({ workHours: { quiet: true, days: [0, 2], from: '08:00', to: '17:00' } }, { workHours: { days: [0, 1, 2, 3, 4], from: '09:00', to: '17:00', lock: { on: false, days: [0], from: '09:00', to: '17:00' } } }, WED)).toBeNull();
  });
});

describe('clockSteps', () => {
  it('lists the 30-minute steps from 06:00 to 23:30', () => {
    const steps = clockSteps();
    expect(steps[0]).toBe('06:00');
    expect(steps[1]).toBe('06:30');
    expect(steps.at(-1)).toBe('23:30');
    expect(steps).toHaveLength(36);
  });
});
