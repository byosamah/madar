import { afterEach, describe, expect, it } from 'vitest';
import { addMonths, isFinePointer, monthGrid, shiftMonth, WHEEL_START, wheelStep, type WheelState } from './calendar';

describe('monthGrid', () => {
  it('gives 42 days from the Sunday before the first day of the month', () => {
    const grid = monthGrid('2026-10');
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-09-27');
    expect(grid).toContain('2026-10-31');
  });

  it('starts every month on a Sunday and counts the days in a row', () => {
    for (let month = 1; month <= 12; month += 1) {
      const key = `2026-${String(month).padStart(2, '0')}`;
      const grid = monthGrid(key);
      expect(new Date(`${grid[0]}T00:00:00Z`).getUTCDay()).toBe(0);
      for (let i = 1; i < grid.length; i += 1) {
        const gap = (Date.parse(`${grid[i]}T00:00:00Z`) - Date.parse(`${grid[i - 1]}T00:00:00Z`)) / 86_400_000;
        expect(gap).toBe(1);
      }
    }
  });
});

describe('addMonths', () => {
  it('moves across a year end in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-10', 0)).toBe('2026-10');
  });
});

describe('shiftMonth', () => {
  it('keeps the day of the month, and stops at the last day of a shorter month', () => {
    expect(shiftMonth('2026-10-18', 1)).toBe('2026-11-18');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-31');
    expect(shiftMonth('2026-10-18', -1)).toBe('2026-09-18');
  });
});

// Review Focus 4: a mouse notch gives one month, a trackpad gives one month for each 100 px, and never a fast run.
describe('wheelStep', () => {
  const line = (deltaY: number, timeStamp: number) => ({ deltaY, deltaMode: 1 as const, timeStamp });
  const pixel = (deltaY: number, timeStamp: number) => ({ deltaY, deltaMode: 0 as const, timeStamp });

  it('gives one step for one line, then none for a line 50 ms later, then one again 200 ms after that', () => {
    const first = wheelStep(WHEEL_START, line(3, 0));
    expect(first.steps).toBe(1);
    const second = wheelStep(first.state, line(3, 50));
    expect(second.steps).toBe(0);
    expect(wheelStep(second.state, line(3, 250)).steps).toBe(1);
  });

  it('gives one step for each 100 px, and keeps the rest', () => {
    const steps: number[] = [];
    let state: WheelState = WHEEL_START;
    for (const [deltaY, at] of [[30, 1000], [30, 1020], [30, 1040], [30, 1060]] as const) {
      const result = wheelStep(state, pixel(deltaY, at));
      steps.push(result.steps);
      state = result.state;
    }
    expect(steps).toEqual([0, 0, 0, 1]);
    expect(state.acc).toBe(20);
  });

  it('keeps the px that come within 150 ms of a step, and gives them as a step later', () => {
    const afterStep = wheelStep(WHEEL_START, pixel(120, 1000));
    expect(afterStep.steps).toBe(1);
    const soon = wheelStep(afterStep.state, pixel(90, 1100));
    expect(soon.steps).toBe(0);
    expect(soon.state.acc).toBe(110);
    expect(wheelStep(soon.state, pixel(0, 1300)).steps).toBe(1);
  });

  it('gives -1 for a negative delta', () => {
    expect(wheelStep(WHEEL_START, line(-3, 0)).steps).toBe(-1);
    expect(wheelStep(WHEEL_START, pixel(-120, 0)).steps).toBe(-1);
  });

  it('gives one step for a page event', () => {
    expect(wheelStep(WHEEL_START, { deltaY: 1, deltaMode: 2, timeStamp: 0 }).steps).toBe(1);
  });

  it('gives no step for no movement', () => {
    expect(wheelStep(WHEEL_START, line(0, 0)).steps).toBe(0);
  });
});

describe('isFinePointer', () => {
  const saved = window.matchMedia;
  afterEach(() => {
    window.matchMedia = saved;
  });

  it('is true when the main pointer is fine (a mouse or a trackpad)', () => {
    window.matchMedia = (query: string) => ({ matches: query === '(pointer: fine)' }) as MediaQueryList;
    expect(isFinePointer()).toBe(true);
  });

  it('is false for a coarse pointer (a phone)', () => {
    window.matchMedia = (query: string) => ({ matches: query !== '(pointer: fine)' }) as MediaQueryList;
    expect(isFinePointer()).toBe(false);
  });

  it('is false where matchMedia is absent, so the browser picker stays', () => {
    Reflect.deleteProperty(window, 'matchMedia');
    expect(isFinePointer()).toBe(false);
  });
});
