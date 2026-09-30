import { describe, expect, it } from 'vitest';
import { chartRange, dayDelta, monthStarts, moveEdge, offsetPct, spanDays, widthPct } from './schedule';

describe('the chart range', () => {
  it('runs from the first month start to the last month end', () => {
    const span = chartRange(['2026-05-09', null, '2027-01-10', '2026-09-30']);
    expect(span).toEqual({ start: '2026-05-01', end: '2027-01-31' });
    expect(monthStarts(span!)).toHaveLength(9);
    expect(chartRange([null])).toBeNull();
  });

  it('places days and bars as percents', () => {
    const span = { start: '2026-09-01', end: '2026-09-30' };
    expect(spanDays(span)).toBe(30);
    expect(offsetPct(span, '2026-09-01')).toBe(0);
    expect(offsetPct(span, '2026-09-16')).toBe(50);
    expect(widthPct(span, '2026-09-01', '2026-09-30')).toBe(100);
  });
});

describe('dragging a stage edge', () => {
  it('turns pixels into whole days, later toward the end side', () => {
    expect(dayDelta(100, 1000, 100, false)).toBe(10);
    expect(dayDelta(100, 1000, 100, true)).toBe(-10);
    expect(dayDelta(-100, 1000, 100, true)).toBe(10);
    expect(Object.is(dayDelta(-4, 1000, 100, false), 0)).toBe(true);
    expect(dayDelta(50, 0, 100, false)).toBe(0);
  });

  it('keeps the start on or before the end', () => {
    const stage = { start: '2026-09-10', end: '2026-09-20' };
    expect(moveEdge(stage, 'end', 3)).toEqual({ start: '2026-09-10', end: '2026-09-23' });
    expect(moveEdge(stage, 'start', 20)).toEqual({ start: '2026-09-20', end: '2026-09-20' });
    expect(moveEdge(stage, 'end', -20)).toEqual({ start: '2026-09-10', end: '2026-09-10' });
  });
});
