import { describe, expect, it } from 'vitest';
import { ageOf } from './age';

const NOW = new Date('2026-09-30T12:00:00+03:00');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('ageOf', () => {
  it('uses the largest whole unit', () => {
    expect(ageOf(ago(20_000), NOW)).toEqual({ unit: 'now', n: 0 });
    expect(ageOf(ago(5 * 60_000), NOW)).toEqual({ unit: 'minutes', n: 5 });
    expect(ageOf(ago(2 * 3_600_000), NOW)).toEqual({ unit: 'hours', n: 2 });
    expect(ageOf(ago(3 * 86_400_000), NOW)).toEqual({ unit: 'days', n: 3 });
    expect(ageOf(ago(15 * 86_400_000), NOW)).toEqual({ unit: 'weeks', n: 2 });
  });

  it('shows the office date after four weeks, and "now" for a stamp in the future', () => {
    expect(ageOf('2026-08-01T10:00:00.000+03:00', NOW)).toEqual({ unit: 'date', day: '2026-08-01' });
    expect(ageOf('2026-10-01T10:00:00.000+03:00', NOW)).toEqual({ unit: 'now', n: 0 });
  });
});
