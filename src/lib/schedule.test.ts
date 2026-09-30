import { describe, expect, it } from 'vitest';
import { chartRange, clipSpan, dayDelta, monthStarts, moveEdge, offsetPct, scheduleWindow, spanDays, widthPct } from './schedule';

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

describe('office schedule windows', () => {
  it('sets a window around today and ticks it by week or by month', () => {
    expect(scheduleWindow('2026-09-30', 'month')).toEqual({
      span: { start: '2026-09-23', end: '2026-11-03' },
      ticks: ['2026-09-27', '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'],
    });
    expect(scheduleWindow('2026-09-30', 'quarter')).toEqual({
      span: { start: '2026-08-31', end: '2026-11-30' },
      ticks: ['2026-09-01', '2026-10-01', '2026-11-01'],
    });
    expect(scheduleWindow('2026-09-30', 'year').ticks).toHaveLength(12);
  });

  it('cuts a bar to the window, or drops it', () => {
    const window = { start: '2026-09-01', end: '2026-09-30' };
    expect(clipSpan({ start: '2026-08-20', end: '2026-09-10' }, window)).toEqual({ start: '2026-09-01', end: '2026-09-10' });
    expect(clipSpan({ start: '2026-09-05', end: '2026-10-10' }, window)).toEqual({ start: '2026-09-05', end: '2026-09-30' });
    expect(clipSpan({ start: '2026-10-01', end: '2026-10-10' }, window)).toBeNull();
  });
});
