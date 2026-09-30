import { afterEach, describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, diffDays, formatDay, formatMonth, formatNumber, maxDay, minDay, now, nowStamp, officeClock, setNow, stampDay, todayISO, weekStartOf } from './dates';

describe('office dates', () => {
  afterEach(() => setNow(null));

  it('pins and releases the clock', () => {
    setNow(new Date('2026-09-30T05:00:00Z'));
    expect(now().toISOString()).toBe('2026-09-30T05:00:00.000Z');
    setNow(null);
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('writes stamps in office time', () => {
    expect(nowStamp(new Date('2026-09-30T05:00:00Z'))).toBe('2026-09-30T08:00:00.000+03:00');
  });

  it('uses the office day near midnight', () => {
    expect(todayISO(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
    expect(todayISO(new Date('2026-09-30T20:59:00Z'))).toBe('2026-09-30');
  });

  it('does day arithmetic', () => {
    expect(addDays('2026-09-30', 2)).toBe('2026-10-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-09-30', '2026-10-12')).toBe(12);
    expect(diffDays('2026-10-12', '2026-09-30')).toBe(-12);
    expect(minDay('2026-09-30', '2026-10-01')).toBe('2026-09-30');
    expect(maxDay('2026-09-30', '2026-10-01')).toBe('2026-10-01');
  });

  it('starts weeks on Sunday', () => {
    expect(dayOfWeek('2026-09-27')).toBe(0);
    expect(weekStartOf('2026-10-01')).toBe('2026-09-27');
    expect(weekStartOf('2026-09-27')).toBe('2026-09-27');
    expect(weekStartOf('2026-10-03')).toBe('2026-09-27');
  });

  it('reads the office clock', () => {
    expect(officeClock(new Date('2026-10-01T12:30:00Z'))).toEqual({ day: '2026-10-01', weekday: 4, hour: 15 });
  });

  it('turns a stamp into its office day', () => {
    expect(stampDay('2026-09-30T23:30:00.000+03:00')).toBe('2026-09-30');
    expect(stampDay('2026-09-30T22:30:00.000Z')).toBe('2026-10-01');
  });

  it('formats with Western digits and the Gregorian calendar', () => {
    expect(formatDay('2026-10-12', 'en')).toBe('12 Oct');
    const arabic = formatDay('2026-10-12', 'ar');
    expect(arabic).toContain('12');
    expect(arabic).not.toMatch(/[٠-٩]/);
    expect(formatNumber(48300.5, 'ar', 1)).toBe('48,300.5');
  });
});

describe('formatMonth', () => {
  it('gives the short month name with the Gregorian calendar in both languages', () => {
    expect(formatMonth('2026-10-01', 'en')).toBe('Oct');
    expect(formatMonth('2026-10-01', 'ar')).toBe('أكتوبر');
  });
});
