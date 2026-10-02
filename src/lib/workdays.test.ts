import { describe, expect, it } from 'vitest';
import { addWorkingDays, dueFromDuration, firstWorkingDay, isWorkingDay } from './workdays';

describe('working days', () => {
  it('adds working days and skips the weekend', () => {
    expect(addWorkingDays('2026-09-30', 2)).toBe('2026-10-04'); // Wednesday to Sunday
    expect(addWorkingDays('2026-10-01', 2)).toBe('2026-10-05'); // Thursday to Monday
    expect(addWorkingDays('2026-10-02', 2)).toBe('2026-10-05'); // Friday: Sunday, then Monday
    expect(addWorkingDays('2026-10-04', 0)).toBe('2026-10-04');
  });

  it('knows the office week, Sunday to Thursday', () => {
    expect(['2026-10-04', '2026-10-08'].map(isWorkingDay)).toEqual([true, true]);
    expect(['2026-10-09', '2026-10-10'].map(isWorkingDay)).toEqual([false, false]);
  });

  it('counts the start day as day 1', () => {
    expect(dueFromDuration('2026-10-04', 5)).toBe('2026-10-08'); // Sun to Thu
    expect(dueFromDuration('2026-10-04', 1)).toBe('2026-10-04');
  });

  it('skips Friday and Saturday', () => {
    expect(dueFromDuration('2026-10-07', 5)).toBe('2026-10-13'); // Wed to Tue
    expect(dueFromDuration('2026-10-08', 2)).toBe('2026-10-11'); // Thu to Sun
  });

  it('starts counting on the next Sunday when the start is a weekend day', () => {
    expect(firstWorkingDay('2026-10-09')).toBe('2026-10-11');
    expect(firstWorkingDay('2026-10-10')).toBe('2026-10-11');
    expect(dueFromDuration('2026-10-09', 1)).toBe('2026-10-11');
    expect(dueFromDuration('2026-10-10', 5)).toBe('2026-10-15');
  });

  it('crosses several weekends', () => {
    expect(dueFromDuration('2026-10-04', 15)).toBe('2026-10-22'); // three working weeks
    expect(dueFromDuration('2026-10-07', 20)).toBe('2026-11-03');
  });
});
