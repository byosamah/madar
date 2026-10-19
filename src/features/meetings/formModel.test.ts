import { describe, expect, it } from 'vitest';
import { LENGTHS, TIME_SLOTS, defaultSlot, lengthWords, splitStamp, stampOf } from './formModel';

describe('TIME_SLOTS', () => {
  it('has the 15-minute steps from 06:00 to 22:00', () => {
    expect(TIME_SLOTS[0]).toBe('06:00');
    expect(TIME_SLOTS[1]).toBe('06:15');
    expect(TIME_SLOTS.at(-1)).toBe('22:00');
    expect(TIME_SLOTS).toHaveLength(65);
  });
});

describe('stampOf and splitStamp', () => {
  it('writes a start in office time and reads it back', () => {
    expect(stampOf('2026-10-21', '10:15')).toBe('2026-10-21T10:15:00.000+03:00');
    expect(splitStamp('2026-10-21T10:15:00.000+03:00')).toEqual({ day: '2026-10-21', time: '10:15' });
  });

  it('reads the office day and time of a stamp in another offset', () => {
    // 23:30 UTC is 02:30 the next day in Riyadh.
    expect(splitStamp('2026-10-21T23:30:00.000Z')).toEqual({ day: '2026-10-22', time: '02:30' });
  });
});

describe('defaultSlot', () => {
  it('takes the next full hour of the same day', () => {
    // 2026-10-21 (Wednesday) 09:20 office time.
    expect(defaultSlot(new Date('2026-10-21T06:20:00Z'))).toEqual({ day: '2026-10-21', time: '10:00' });
  });

  it('starts at 09:00 before the working hours', () => {
    expect(defaultSlot(new Date('2026-10-21T01:00:00Z'))).toEqual({ day: '2026-10-21', time: '09:00' });
  });

  it('moves to 09:00 of the next working day after the working hours', () => {
    // 2026-10-21 21:30 office time: the next hour is 22:00, which is the last slot, so it still fits.
    expect(defaultSlot(new Date('2026-10-21T18:30:00Z'))).toEqual({ day: '2026-10-21', time: '22:00' });
    expect(defaultSlot(new Date('2026-10-21T19:10:00Z'))).toEqual({ day: '2026-10-22', time: '09:00' });
  });

  it('moves a weekend day to 09:00 of the next working day', () => {
    // 2026-10-23 is a Friday.
    expect(defaultSlot(new Date('2026-10-23T07:00:00Z'))).toEqual({ day: '2026-10-25', time: '09:00' });
  });
});

describe('lengths', () => {
  it('offers the usual lengths in minutes', () => {
    expect(LENGTHS).toEqual([15, 30, 45, 60, 90, 120, 180, 240]);
  });

  it('writes a length as minutes, hours, or both', () => {
    expect(lengthWords(30)).toEqual({ key: 'meetings.form.min', values: { n: 30 } });
    expect(lengthWords(60)).toEqual({ key: 'meetings.form.hour', values: { n: 1 } });
    expect(lengthWords(90)).toEqual({ key: 'meetings.form.hourMin', values: { h: 1, m: 30 } });
    expect(lengthWords(240)).toEqual({ key: 'meetings.form.hour', values: { n: 4 } });
  });
});
