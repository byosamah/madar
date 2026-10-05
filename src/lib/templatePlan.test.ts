import { describe, expect, it } from 'vitest';
import { lockedSpan, planDates, templateLength, warpItems, workingDaysInclusive } from './templatePlan';

const item = (id: string, start: number, days: number, locked = false) => ({ id, start, days, locked });

describe('templateLength', () => {
  it('is the last end of all items', () => {
    expect(templateLength([item('a', 0, 10), item('b', 5, 20), item('c', 2, 3)])).toBe(25);
  });
  it('is 0 for no items', () => {
    expect(templateLength([])).toBe(0);
  });
});

describe('lockedSpan', () => {
  it('counts the days that locked items cover, once for each day', () => {
    // a covers 0..9, b covers 5..14: together 15 days. c is free.
    expect(lockedSpan([item('a', 0, 10, true), item('b', 5, 10, true), item('c', 20, 5)])).toBe(15);
  });
  it('adds locked items that do not touch', () => {
    expect(lockedSpan([item('a', 0, 3, true), item('b', 10, 4, true)])).toBe(7);
  });
  it('is 0 when no item is locked', () => {
    expect(lockedSpan([item('a', 0, 3)])).toBe(0);
  });
});

describe('warpItems', () => {
  it('keeps the items when the target is the template length', () => {
    const items = [item('a', 0, 10), item('b', 10, 20)];
    expect(warpItems(items, 30)).toEqual({ ok: true, length: 30, items: [{ id: 'a', start: 0, days: 10 }, { id: 'b', start: 10, days: 20 }] });
  });

  it('shrinks free items to the target length', () => {
    // 60 days into 30: every start and length is half.
    const result = warpItems([item('a', 0, 20), item('b', 20, 20), item('c', 40, 20)], 30);
    expect(result).toEqual({ ok: true, length: 30, items: [{ id: 'a', start: 0, days: 10 }, { id: 'b', start: 10, days: 10 }, { id: 'c', start: 20, days: 10 }] });
  });

  it('stretches free items to the target length', () => {
    const result = warpItems([item('a', 0, 10), item('b', 10, 10)], 40);
    expect(result).toEqual({ ok: true, length: 40, items: [{ id: 'a', start: 0, days: 20 }, { id: 'b', start: 20, days: 20 }] });
  });

  it('keeps the length of a locked item and keeps the order of the items', () => {
    // The owner example: stage 3 task 2 keeps its length when a long template shrinks.
    const result = warpItems([item('s1', 0, 20), item('s2', 20, 20), item('s3t2', 40, 10, true), item('s3t3', 50, 10)], 30);
    if (!result.ok) throw new Error('expected ok');
    const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
    expect(byId.s3t2.days).toBe(10);
    expect(result.length).toBe(30);
    // The locked task still starts after s2 ends and ends before s3t3 starts.
    expect(byId.s3t2.start).toBeGreaterThanOrEqual(byId.s2.start + byId.s2.days);
    expect(byId.s3t3.start).toBeGreaterThanOrEqual(byId.s3t2.start + byId.s3t2.days);
    expect(byId.s3t3.start + byId.s3t3.days).toBe(30);
  });

  it('refuses a target shorter than the locked days, and says how many days they need', () => {
    expect(warpItems([item('a', 0, 10, true), item('b', 10, 10, true), item('c', 20, 10)], 15)).toEqual({ ok: false, needs: 20 });
  });

  it('accepts a target equal to the locked days: the free items get 1 day at least', () => {
    const result = warpItems([item('a', 0, 10, true), item('b', 10, 10)], 10);
    if (!result.ok) throw new Error('expected ok');
    expect(result.items.find((i) => i.id === 'a')).toEqual({ id: 'a', start: 0, days: 10 });
    expect(result.items.find((i) => i.id === 'b')!.days).toBe(1);
  });

  it('keeps every item when all items are locked, and gives the real length', () => {
    const items = [item('a', 0, 10, true), item('b', 10, 5, true)];
    expect(warpItems(items, 40)).toEqual({ ok: true, length: 15, items: [{ id: 'a', start: 0, days: 10 }, { id: 'b', start: 10, days: 5 }] });
  });

  it('scales a gap with no items like free time', () => {
    const result = warpItems([item('a', 0, 10), item('b', 20, 10)], 15);
    expect(result).toEqual({ ok: true, length: 15, items: [{ id: 'a', start: 0, days: 5 }, { id: 'b', start: 10, days: 5 }] });
  });

  it('gives a free item at least 1 day after a strong shrink', () => {
    const result = warpItems([item('a', 0, 1), item('b', 1, 99)], 10);
    if (!result.ok) throw new Error('expected ok');
    expect(result.items.every((i) => i.days >= 1)).toBe(true);
  });

  it('refuses a target below 1 day', () => {
    expect(warpItems([item('a', 0, 10)], 0)).toEqual({ ok: false, needs: 1 });
  });
});

describe('workingDaysInclusive', () => {
  // 2026-10-04 is a Sunday. The week is Sunday to Thursday.
  it('counts the working days from the first day to the last day, both in', () => {
    expect(workingDaysInclusive('2026-10-04', '2026-10-08')).toBe(5);
    expect(workingDaysInclusive('2026-10-04', '2026-10-11')).toBe(6);
  });
  it('is 0 when the last day comes before the first day', () => {
    expect(workingDaysInclusive('2026-10-08', '2026-10-04')).toBe(0);
  });
});

describe('planDates', () => {
  it('turns working-day offsets into start and due days from the project start', () => {
    // Day 0 is Sunday 2026-10-04. 5 days end on Thursday. The next item starts on Sunday.
    expect(planDates('2026-10-04', [{ id: 'a', start: 0, days: 5 }, { id: 'b', start: 5, days: 2 }])).toEqual([
      { id: 'a', startDate: '2026-10-04', dueDate: '2026-10-08' },
      { id: 'b', startDate: '2026-10-11', dueDate: '2026-10-12' },
    ]);
  });
  it('moves a start on a Friday to the next Sunday', () => {
    expect(planDates('2026-10-09', [{ id: 'a', start: 0, days: 1 }])).toEqual([{ id: 'a', startDate: '2026-10-11', dueDate: '2026-10-11' }]);
  });
});
