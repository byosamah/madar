import { describe, expect, it } from 'vitest';
import { addMinutes, clockOf, dayOf, earliestStart, hasTrackerLine, kindDefaults, minutesBetween, occurrencesOf, officeStamp, onFiveMinutes, phaseOf, SERIES_AHEAD, SETTLE_BACK_DAYS, stampOn } from './meetings';

const meeting = (startsAt: string, endsAt: string, status: 'scheduled' | 'cancelled' = 'scheduled') => ({ startsAt, endsAt, status });

describe('dayOf', () => {
  it('gives the office day of the start at 23:30 Riyadh, whatever the offset of the stamp', () => {
    expect(dayOf({ startsAt: '2026-10-20T23:30:00+03:00' })).toBe('2026-10-20');
    // 20:30 UTC is 23:30 in Riyadh, the same day.
    expect(dayOf({ startsAt: '2026-10-20T20:30:00Z' })).toBe('2026-10-20');
  });

  it('gives the next office day for 00:10 Riyadh, which is the evening before in UTC', () => {
    expect(dayOf({ startsAt: '2026-10-21T00:10:00+03:00' })).toBe('2026-10-21');
    expect(dayOf({ startsAt: '2026-10-20T21:10:00Z' })).toBe('2026-10-21');
  });
});

describe('phaseOf', () => {
  const m = meeting('2026-10-20T10:00:00.000+03:00', '2026-10-20T11:00:00.000+03:00');
  const at = (stamp: string) => new Date(stamp);

  it('is upcoming before the start, now from the start, and done from the end', () => {
    expect(phaseOf(m, at('2026-10-20T09:59:59.999+03:00'))).toBe('upcoming');
    expect(phaseOf(m, at('2026-10-20T10:00:00.000+03:00'))).toBe('now');
    expect(phaseOf(m, at('2026-10-20T10:59:59.999+03:00'))).toBe('now');
    expect(phaseOf(m, at('2026-10-20T11:00:00.000+03:00'))).toBe('done');
  });

  it('is cancelled for a cancelled meeting at any time', () => {
    const cancelled = { ...m, status: 'cancelled' as const };
    expect(phaseOf(cancelled, at('2026-10-20T09:00:00+03:00'))).toBe('cancelled');
    expect(phaseOf(cancelled, at('2026-10-21T09:00:00+03:00'))).toBe('cancelled');
  });

  it('reads a meeting at 23:30 Riyadh as now at 23:45 and done at 00:30 of the next day', () => {
    const late = meeting('2026-10-20T23:30:00.000+03:00', '2026-10-21T00:30:00.000+03:00');
    expect(phaseOf(late, at('2026-10-20T23:45:00+03:00'))).toBe('now');
    expect(phaseOf(late, at('2026-10-21T00:30:00+03:00'))).toBe('done');
    // The same instant in UTC.
    expect(phaseOf(late, at('2026-10-20T20:45:00Z'))).toBe('now');
  });
});

describe('kindDefaults', () => {
  it('gives 60 minutes for a meeting and a client meeting', () => {
    expect(kindDefaults('meeting')).toEqual({ durationMin: 60 });
    expect(kindDefaults('client')).toEqual({ durationMin: 60 });
  });

  it('gives 30 minutes for a team meeting', () => {
    expect(kindDefaults('team')).toEqual({ durationMin: 30 });
  });

  it('gives 120 minutes for a site visit', () => {
    expect(kindDefaults('site_visit')).toEqual({ durationMin: 120 });
  });
});

describe('hasTrackerLine', () => {
  it('is true for a project meeting that is not a team meeting', () => {
    for (const kind of ['meeting', 'client', 'site_visit'] as const) expect(hasTrackerLine({ projectId: 'prj_001', kind }), kind).toBe(true);
  });

  it('is false for a team meeting, also with a project, and for a meeting with no project', () => {
    expect(hasTrackerLine({ projectId: 'prj_001', kind: 'team' })).toBe(false);
    for (const kind of ['meeting', 'client', 'team', 'site_visit'] as const) expect(hasTrackerLine({ projectId: null, kind }), kind).toBe(false);
  });

  it('settles back 14 days', () => {
    expect(SETTLE_BACK_DAYS).toBe(14);
  });
});

describe('stamps', () => {
  it('writes every stamp in office time', () => {
    expect(officeStamp('2026-10-20T07:00:00Z')).toBe('2026-10-20T10:00:00.000+03:00');
    expect(officeStamp('2026-10-20T10:00:00+03:00')).toBe('2026-10-20T10:00:00.000+03:00');
  });

  it('adds minutes across midnight', () => {
    expect(addMinutes('2026-10-20T23:30:00.000+03:00', 60)).toBe('2026-10-21T00:30:00.000+03:00');
    expect(minutesBetween('2026-10-20T23:30:00.000+03:00', '2026-10-21T00:30:00.000+03:00')).toBe(60);
  });

  it('accepts a start on a multiple of 5 minutes and refuses any other', () => {
    expect(onFiveMinutes('2026-10-20T10:00:00+03:00')).toBe(true);
    expect(onFiveMinutes('2026-10-20T10:35:00+03:00')).toBe(true);
    expect(onFiveMinutes('2026-10-20T10:03:00+03:00')).toBe(false);
    expect(onFiveMinutes('2026-10-20T10:00:30+03:00')).toBe(false);
    expect(onFiveMinutes('2026-10-20T10:00:00.500+03:00')).toBe(false);
    // A zone with a half hour offset counts in office time.
    expect(onFiveMinutes('2026-10-20T12:30:00+05:30')).toBe(true);
  });

  it('finds the earliest start 14 days before now', () => {
    expect(earliestStart(new Date('2026-09-30T06:00:00Z')).toISOString()).toBe('2026-09-16T06:00:00.000Z');
  });
});

describe('occurrencesOf (fbk_022, wave 3)', () => {
  // 2026-10-04 is a Sunday. 2026-10-08 is a Thursday, 2026-10-09 a Friday, 2026-10-10 a Saturday.
  it('gives every working day, Sunday to Thursday, for "day"', () => {
    expect(occurrencesOf({ every: 'day', until: null }, '2026-10-04', '2026-10-04', 6)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-11', '2026-10-12',
    ]);
  });

  it('skips the weekend after a Thursday, and starts on a Sunday after a Friday or a Saturday', () => {
    expect(occurrencesOf({ every: 'day', until: null }, '2026-10-08', '2026-10-08', 2)).toEqual(['2026-10-11', '2026-10-12']);
    expect(occurrencesOf({ every: 'day', until: null }, '2026-10-09', '2026-10-09', 2)).toEqual(['2026-10-11', '2026-10-12']);
    expect(occurrencesOf({ every: 'day', until: null }, '2026-10-10', '2026-10-10', 1)).toEqual(['2026-10-11']);
  });

  it('keeps the weekday of the first day for "week", also a Friday', () => {
    expect(occurrencesOf({ every: 'week', until: null }, '2026-10-09', '2026-10-09', 3)).toEqual(['2026-10-16', '2026-10-23', '2026-10-30']);
    expect(occurrencesOf({ every: 'week', until: null }, '2026-10-10', '2026-10-10', 2)).toEqual(['2026-10-17', '2026-10-24']);
  });

  it('keeps the weekday and a step of 14 days for "two_weeks"', () => {
    expect(occurrencesOf({ every: 'two_weeks', until: null }, '2026-10-04', '2026-10-04', 3)).toEqual(['2026-10-18', '2026-11-01', '2026-11-15']);
  });

  it('crosses the end of a month and of a year', () => {
    expect(occurrencesOf({ every: 'week', until: null }, '2026-12-27', '2026-12-27', 2)).toEqual(['2027-01-03', '2027-01-10']);
    expect(occurrencesOf({ every: 'day', until: null }, '2026-01-29', '2026-01-29', 3)).toEqual(['2026-02-01', '2026-02-02', '2026-02-03']);
  });

  it('stops after until, and keeps until itself', () => {
    expect(occurrencesOf({ every: 'week', until: '2026-10-23' }, '2026-10-04', '2026-10-04', 8)).toEqual(['2026-10-11', '2026-10-18']);
    expect(occurrencesOf({ every: 'week', until: '2026-10-25' }, '2026-10-04', '2026-10-04', 8)).toEqual(['2026-10-11', '2026-10-18', '2026-10-25']);
    expect(occurrencesOf({ every: 'day', until: '2026-10-06' }, '2026-10-04', '2026-10-04', 8)).toEqual(['2026-10-05', '2026-10-06']);
    expect(occurrencesOf({ every: 'day', until: '2026-10-10' }, '2026-10-08', '2026-10-08', 8)).toEqual([]);
    expect(occurrencesOf({ every: 'week', until: '2026-10-04' }, '2026-10-04', '2026-10-04', 8)).toEqual([]);
  });

  it('starts after the day "after", which can be later than the first day, and keeps the weekday of the first day', () => {
    // A series that began on Sunday 2026-10-04, asked after Tuesday 2026-10-20: the next Sunday is 2026-10-25.
    expect(occurrencesOf({ every: 'week', until: null }, '2026-10-04', '2026-10-20', 2)).toEqual(['2026-10-25', '2026-11-01']);
    // Fortnight: 10-04, 10-18, 11-01 ... after 2026-10-20 the next one is 11-01.
    expect(occurrencesOf({ every: 'two_weeks', until: null }, '2026-10-04', '2026-10-20', 2)).toEqual(['2026-11-01', '2026-11-15']);
    // "after" on an occurrence gives the one after it.
    expect(occurrencesOf({ every: 'week', until: null }, '2026-10-04', '2026-10-18', 1)).toEqual(['2026-10-25']);
    expect(occurrencesOf({ every: 'day', until: null }, '2026-10-04', '2026-10-20', 2)).toEqual(['2026-10-21', '2026-10-22']);
  });

  it('gives at most count days, and none for a count of 0', () => {
    expect(occurrencesOf({ every: 'day', until: null }, '2026-10-04', '2026-10-04', 0)).toEqual([]);
    expect(occurrencesOf({ every: 'week', until: null }, '2026-10-04', '2026-10-04', SERIES_AHEAD - 1)).toHaveLength(7);
  });
});

describe('clockOf and stampOn', () => {
  it('read and set the office clock of a stamp', () => {
    expect(clockOf('2026-10-20T23:30:00+03:00')).toBe('23:30');
    // 20:30 UTC is 23:30 in Riyadh.
    expect(clockOf('2026-10-20T20:30:00Z')).toBe('23:30');
    expect(stampOn('2026-10-27', '23:30')).toBe('2026-10-27T23:30:00.000+03:00');
    expect(dayOf({ startsAt: stampOn('2026-10-27', '00:10') })).toBe('2026-10-27');
  });
});
