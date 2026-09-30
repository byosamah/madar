import { describe, expect, it } from 'vitest';
import { hoursText, parseHours } from './hours';

describe('timesheet cells', () => {
  it('reads half-hour steps from 0 to 24 in other forms too', () => {
    expect(parseHours('')).toEqual({ ok: true, hours: 0 });
    expect(parseHours(' 7.5 ')).toEqual({ ok: true, hours: 7.5 });
    expect(parseHours('1,5')).toEqual({ ok: true, hours: 1.5 });
    expect(parseHours('٢')).toEqual({ ok: true, hours: 2 });
    expect(parseHours('٧٫٥')).toEqual({ ok: true, hours: 7.5 });
  });

  it('refuses other values', () => {
    for (const text of ['2.3', '25', 'abc', '-1', '1.25']) expect(parseHours(text)).toEqual({ ok: false });
  });

  it('shows 0 as an empty cell', () => {
    expect(hoursText(0)).toBe('');
    expect(hoursText(7.5)).toBe('7.5');
  });
});
