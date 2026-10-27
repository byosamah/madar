import { describe, expect, it } from 'vitest';
import { weekdayName, widenToLock } from './workRange';

describe('widenToLock', () => {
  const lock = { on: true, days: [0, 1, 2, 3, 4], from: '08:00', to: '17:00' };

  it('adds the days of the lock and widens the times to hold the lock', () => {
    expect(widenToLock({ days: [4, 6], from: '09:00', to: '16:00' }, lock)).toEqual({ days: [0, 1, 2, 3, 4, 6], from: '08:00', to: '17:00' });
  });

  it('keeps times that already hold the lock', () => {
    expect(widenToLock({ days: [0, 1, 2, 3, 4], from: '07:00', to: '18:30' }, lock)).toEqual({ days: [0, 1, 2, 3, 4], from: '07:00', to: '18:30' });
  });

  it('returns a copy of the range when the lock is off', () => {
    const range = { days: [1, 3], from: '10:00', to: '14:00' };
    const result = widenToLock(range, { ...lock, on: false });
    expect(result).toEqual(range);
    expect(result.days).not.toBe(range.days);
  });
});

// The texts of weekdayName before it used the shared formatters of lib/dates.ts: they stay the same, character for character.
describe('weekdayName', () => {
  const OLD = {
    'en|short': ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    'en|long': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    'ar|short': ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
    'ar|long': ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  } as const;

  it.each(['en', 'ar'] as const)('keeps the old text of the seven days, short and long (%s)', (lang) => {
    for (const style of ['short', 'long'] as const) {
      expect([0, 1, 2, 3, 4, 5, 6].map((day) => weekdayName(day, lang, style))).toEqual(OLD[`${lang}|${style}`]);
    }
  });

  it('gives the short name when no style is passed', () => {
    expect(weekdayName(0, 'en')).toBe('Sun');
    expect(weekdayName(6, 'ar')).toBe('السبت');
  });
});
