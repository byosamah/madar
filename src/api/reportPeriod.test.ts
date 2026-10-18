import { describe, expect, it } from 'vitest';
import { periodRange, periodStamps } from './reportPeriod';

/** The periods of the office report (owner, 2026-10-18, fbk_016): a week runs Sunday to Saturday, a quarter starts in Jan, Apr, Jul or Oct. */
describe('periodRange: the week', () => {
  it('gives the last full week before today with no start (today is a Sunday)', () => {
    expect(periodRange('week', undefined, '2026-10-18')).toEqual({ from: '2026-10-11', to: '2026-10-17' });
  });

  it('gives the last full week before today when today is the Saturday of its own week', () => {
    expect(periodRange('week', undefined, '2026-10-10')).toEqual({ from: '2026-09-27', to: '2026-10-03' });
  });

  it('gives the week of the start, which crosses from September into October', () => {
    expect(periodRange('week', '2026-10-01', '2026-10-18')).toEqual({ from: '2026-09-27', to: '2026-10-03' });
  });

  it('gives the same week for a start on its Saturday, and a new week for a start on its Sunday', () => {
    expect(periodRange('week', '2026-10-03', '2026-10-18')).toEqual({ from: '2026-09-27', to: '2026-10-03' });
    expect(periodRange('week', '2026-10-04', '2026-10-18')).toEqual({ from: '2026-10-04', to: '2026-10-10' });
  });
});

describe('periodRange: the month', () => {
  it('gives the previous calendar month with no start', () => {
    expect(periodRange('month', undefined, '2026-10-18')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('gives December of the year before when today is in January', () => {
    expect(periodRange('month', undefined, '2026-01-02')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('gives the month of the start, with the days of a leap February', () => {
    expect(periodRange('month', '2028-02-10', '2028-05-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });

  it('gives the month of the start, with the days of a common February', () => {
    expect(periodRange('month', '2027-02-10', '2027-05-01')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
  });
});

describe('periodRange: the quarter', () => {
  it('gives the last full quarter with no start: the third quarter when today is in the fourth', () => {
    expect(periodRange('quarter', undefined, '2026-10-18')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('gives the third quarter when today is the first day of the fourth', () => {
    expect(periodRange('quarter', undefined, '2026-10-01')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
  });

  it('gives the fourth quarter of the year before when today is in the first quarter', () => {
    expect(periodRange('quarter', undefined, '2026-01-02')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });

  it('gives the quarter of the start, which starts in October', () => {
    expect(periodRange('quarter', '2026-11-05', '2027-01-10')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(periodRange('quarter', '2026-12-31', '2027-01-10')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('gives the first quarter of a leap year with its 31 March end', () => {
    expect(periodRange('quarter', '2028-02-29', '2028-05-01')).toEqual({ from: '2028-01-01', to: '2028-03-31' });
  });
});

describe('periodRange: the year', () => {
  it('gives the last full calendar year with no start', () => {
    expect(periodRange('year', undefined, '2026-10-18')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('gives the calendar year of the start', () => {
    expect(periodRange('year', '2026-03-04', '2026-10-18')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('gives a leap year with its 366 days', () => {
    expect(periodRange('year', '2028-06-01', '2028-10-18')).toEqual({ from: '2028-01-01', to: '2028-12-31' });
  });
});

describe('periodStamps', () => {
  it('gives the first instant of the first day and of the day after the last, on the Riyadh offset', () => {
    expect(periodStamps({ from: '2026-09-27', to: '2026-10-03' })).toEqual({
      from: '2026-09-27T00:00:00+03:00',
      until: '2026-10-04T00:00:00+03:00',
    });
  });
});
