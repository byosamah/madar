import { describe, expect, it } from 'vitest';
import { barOf, chartDays, dayAt, waitsThrough, weekStarts } from './ganttMath';

describe('the timeline math', () => {
  it('maps a pixel to a whole working day inside the chart', () => {
    expect(dayAt(0, 100, 10)).toBe(0);
    expect(dayAt(9.9, 100, 10)).toBe(0);
    expect(dayAt(10, 100, 10)).toBe(1);
    expect(dayAt(55.5, 100, 10)).toBe(5);
    expect(dayAt(100, 100, 10)).toBe(9);
    expect(dayAt(-20, 100, 10)).toBe(0);
    expect(dayAt(500, 100, 10)).toBe(9);
    expect(dayAt(10, 0, 10)).toBe(0);
    expect(dayAt(10, 100, 0)).toBe(0);
  });

  it('places a bar on whole working days, as a share of the chart', () => {
    expect(barOf(2, 4, 10)).toEqual({ left: 20, width: 40 });
    expect(barOf(2.4, 3.6, 10)).toEqual({ left: 20, width: 40 });
  });

  it('keeps a bar inside the chart', () => {
    expect(barOf(8, 5, 10)).toEqual({ left: 80, width: 20 });
    expect(barOf(-3, 0, 10)).toEqual({ left: 0, width: 10 });
    expect(barOf(40, 3, 10)).toEqual({ left: 90, width: 10 });
  });

  it('shows whole weeks with one spare week, and at least two weeks', () => {
    expect(chartDays(0)).toBe(10);
    expect(chartDays(20)).toBe(25);
    expect(chartDays(21)).toBe(30);
  });

  it('marks the start of each week after day 0', () => {
    expect(weekStarts(10)).toEqual([5]);
    expect(weekStarts(16)).toEqual([5, 10, 15]);
  });

  it('finds a chain of waits, so that a new link would close a loop', () => {
    // t3 waits for t2, and t2 waits for t1.
    const edges = new Map([['t1', []], ['t2', ['t1']], ['t3', ['t2']]]);
    // A link "t1 waits for t3" closes the chain: t3 already reaches t1.
    expect(waitsThrough(edges, 't3', 't1')).toBe(true);
    // A link "t3 waits for t1" is a shortcut, not a loop: t1 does not reach t3.
    expect(waitsThrough(edges, 't1', 't3')).toBe(false);
    // A part that waits for itself is a loop.
    expect(waitsThrough(edges, 't2', 't2')).toBe(true);
  });
});
