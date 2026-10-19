import { describe, expect, it } from 'vitest';
import { addMinutes, dayOf, earliestStart, kindDefaults, minutesBetween, officeStamp, onFiveMinutes, phaseOf } from './meetings';

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
  it('gives 60 minutes and the organizer for a meeting and a client meeting', () => {
    expect(kindDefaults('meeting')).toEqual({ durationMin: 60, minutesByOrganizer: true });
    expect(kindDefaults('client')).toEqual({ durationMin: 60, minutesByOrganizer: true });
  });

  it('gives 30 minutes and nobody for a team meeting', () => {
    expect(kindDefaults('team')).toEqual({ durationMin: 30, minutesByOrganizer: false });
  });

  it('gives 120 minutes and the organizer for a site visit', () => {
    expect(kindDefaults('site_visit')).toEqual({ durationMin: 120, minutesByOrganizer: true });
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
