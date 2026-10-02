import { describe, expect, it } from 'vitest';
import { addMonths, chartRange, clipSpan, dayDelta, meetingStep, meetingWindow, midPct, monthStarts, moveEdge, offsetPct, scheduleWindow, spanDays, widthPct, groupClose } from './schedule';

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

describe('meeting windows', () => {
  it('shows whole months around today for each zoom', () => {
    expect(meetingWindow('2026-10-01', 'quarter')).toEqual({
      span: { start: '2026-09-01', end: '2026-11-30' },
      ticks: ['2026-09-01', '2026-10-01', '2026-11-01'],
    });
    const half = meetingWindow('2026-10-15', 'half');
    expect(half.span).toEqual({ start: '2026-09-01', end: '2027-02-28' });
    expect(half.ticks).toHaveLength(6);
    const year = meetingWindow('2026-10-15', 'year');
    expect(year.span).toEqual({ start: '2026-08-01', end: '2027-07-31' });
    expect(year.ticks).toHaveLength(12);
  });

  it('moves by months, across a year edge, and back', () => {
    expect(meetingWindow('2026-10-01', 'quarter', 1).span.start).toBe('2026-10-01');
    expect(meetingWindow('2026-10-01', 'quarter', 3).span).toEqual({ start: '2026-12-01', end: '2027-02-28' });
    expect(meetingWindow('2026-01-10', 'quarter', -1).span).toEqual({ start: '2025-11-01', end: '2026-01-31' });
    expect(addMonths('2026-12-20', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-20', -2)).toBe('2025-11-01');
  });

  it('shows the week of today, Sunday to Saturday, with a tick for each day (owner, 2026-10-02)', () => {
    expect(meetingWindow('2026-10-01', 'week')).toEqual({
      span: { start: '2026-09-27', end: '2026-10-03' },
      ticks: ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'],
    });
    expect(meetingWindow('2026-10-04', 'week').span).toEqual({ start: '2026-10-04', end: '2026-10-10' });
  });

  it('moves the week by whole weeks, across a month and a year edge', () => {
    expect(meetingWindow('2026-10-01', 'week', 1).span).toEqual({ start: '2026-10-04', end: '2026-10-10' });
    expect(meetingWindow('2026-12-30', 'week', 1).span).toEqual({ start: '2027-01-03', end: '2027-01-09' });
    expect(meetingWindow('2026-10-01', 'week', -1).span).toEqual({ start: '2026-09-20', end: '2026-09-26' });
  });

  it('shows the month of today with a tick for each Sunday, and moves by whole months', () => {
    expect(meetingWindow('2026-10-15', 'month')).toEqual({
      span: { start: '2026-10-01', end: '2026-10-31' },
      ticks: ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'],
    });
    // November 2026 starts on a Sunday, so its first day is a tick too.
    expect(meetingWindow('2026-10-15', 'month', 1)).toEqual({
      span: { start: '2026-11-01', end: '2026-11-30' },
      ticks: ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29'],
    });
    expect(meetingWindow('2026-01-10', 'month', -1).span).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(meetingWindow('2028-02-10', 'month').span).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('puts a one-day mark in the middle of its day', () => {
    const week = { start: '2026-09-27', end: '2026-10-03' };
    expect(midPct(week, '2026-09-27')).toBeCloseTo(100 / 14);
    expect(midPct(week, '2026-10-03')).toBeCloseTo(100 - 100 / 14);
  });

  it('steps one week in the week zoom and one month in the others', () => {
    expect(meetingStep('week')).toBe('week');
    for (const zoom of ['month', 'quarter', 'half', 'year'] as const) expect(meetingStep(zoom)).toBe('month');
  });
});

describe('groupClose', () => {
  const at = (...values: number[]) => values.map((value, i) => ({ id: `d${i}`, at: value }));
  const ids = (groups: { id: string }[][]) => groups.map((group) => group.map((item) => item.id));

  it('keeps marks apart when they are at least the gap apart', () => {
    expect(ids(groupClose(at(10, 20, 30), 5))).toEqual([['d0'], ['d1'], ['d2']]);
  });

  it('groups marks closer than the gap, in date order, starting from the earliest', () => {
    expect(ids(groupClose(at(31, 10, 12, 30, 50), 5))).toEqual([['d1', 'd2'], ['d3', 'd0'], ['d4']]);
  });

  it('starts a new group once a mark is a full gap from the first mark of the group', () => {
    expect(ids(groupClose(at(10, 13, 16, 19), 5))).toEqual([['d0', 'd1'], ['d2', 'd3']]);
  });

  it('groups nothing when the gap is zero', () => {
    expect(ids(groupClose(at(10, 10), 0))).toEqual([['d0'], ['d1']]);
  });
});
