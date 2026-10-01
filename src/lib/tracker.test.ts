import { describe, expect, it } from 'vitest';
import { ageInDays, groupByWeek, isOpen } from './tracker';

describe('isOpen', () => {
  it('is true only while a waiting entry is not closed', () => {
    expect(isOpen({ waiting: 'us', closedAt: null })).toBe(true);
    expect(isOpen({ waiting: 'client', closedAt: '2026-09-30T09:00:00.000+03:00' })).toBe(false);
    expect(isOpen({ waiting: null, closedAt: null })).toBe(false);
  });
});

describe('ageInDays', () => {
  it('counts whole days and never goes below 0', () => {
    expect(ageInDays('2026-09-25', '2026-09-30')).toBe(5);
    expect(ageInDays('2026-09-30', '2026-09-30')).toBe(0);
    expect(ageInDays('2026-10-04', '2026-09-30')).toBe(0);
  });
});

describe('groupByWeek', () => {
  // 2026-09-30 is a Wednesday. The office week starts on Sunday, so this week starts on 2026-09-27.
  it('names this week and last week, then gives the Sunday of each older week', () => {
    const days = ['2026-09-30', '2026-09-27', '2026-09-26', '2026-09-20', '2026-09-19', '2026-09-01'];
    const groups = groupByWeek(days, (day) => day, '2026-09-30');
    expect(groups.map((g) => [g.label, g.weekStart, g.items])).toEqual([
      ['this', '2026-09-27', ['2026-09-30', '2026-09-27']],
      ['last', '2026-09-20', ['2026-09-26', '2026-09-20']],
      ['date', '2026-09-13', ['2026-09-19']],
      ['date', '2026-08-30', ['2026-09-01']],
    ]);
  });

  it('gives an empty list for no entries', () => {
    expect(groupByWeek([], (day: string) => day, '2026-09-30')).toEqual([]);
  });
});
