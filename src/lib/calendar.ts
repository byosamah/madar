import { addDays, weekStartOf } from './dates';

// The pure parts of the calendar popover: the days of a month, the months, the wheel, and the pointer test.

/** The 42 days of a month view (6 weeks), from the Sunday before the first day. The month is 'YYYY-MM'. */
export function monthGrid(month: string): string[] {
  const first = weekStartOf(`${month}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** The month that is n months away from a month ('YYYY-MM'). n can be negative. */
export function addMonths(month: string, n: number): string {
  const [year, mon] = month.split('-').map(Number);
  const total = year * 12 + (mon - 1) + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** The same day number n months away. A day past the end of the new month stops at its last day. */
export function shiftMonth(day: string, n: number): string {
  const month = addMonths(day.slice(0, 7), n);
  const [year, mon] = month.split('-').map(Number);
  // Day 0 of the next month is the last day of this month.
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const dayNumber = Math.min(Number(day.slice(8, 10)), lastDay);
  return `${month}-${String(dayNumber).padStart(2, '0')}`;
}

export type WheelState = { acc: number; lastStepAt: number };

/** The state before the first wheel event. The first step is never late. */
export const WHEEL_START: WheelState = { acc: 0, lastStepAt: Number.NEGATIVE_INFINITY };

/** A step comes at most once in this time, so a fast trackpad run moves slowly (plan, Review Focus 4). */
const WHEEL_GAP_MS = 150;
/** A trackpad gives one month for each 100 px of movement. */
const WHEEL_PIXELS_PER_STEP = 100;

/**
 * One wheel event gives at most one month step, and never a fast run. A line or a page event (a mouse notch) gives one step when
 * 150 ms passed since the last step. Pixel events (a trackpad) add up, and at 100 px give one step when 150 ms passed; the rest
 * stays for the next step.
 */
export function wheelStep(
  state: WheelState,
  event: { deltaY: number; deltaMode: 0 | 1 | 2; timeStamp: number },
): { steps: -1 | 0 | 1; state: WheelState } {
  const ready = event.timeStamp - state.lastStepAt >= WHEEL_GAP_MS;
  const direction = event.deltaY > 0 ? 1 : event.deltaY < 0 ? -1 : 0;
  if (event.deltaMode !== 0) {
    if (!ready || direction === 0) return { steps: 0, state };
    return { steps: direction, state: { acc: state.acc, lastStepAt: event.timeStamp } };
  }
  const acc = state.acc + event.deltaY;
  if (ready && Math.abs(acc) >= WHEEL_PIXELS_PER_STEP) {
    const steps = acc > 0 ? 1 : -1;
    return { steps, state: { acc: acc - steps * WHEEL_PIXELS_PER_STEP, lastStepAt: event.timeStamp } };
  }
  return { steps: 0, state: { acc, lastStepAt: state.lastStepAt } };
}

/** True on a computer: its main pointer is a mouse or a trackpad. A phone or a tablet is coarse. False where matchMedia is absent. */
export function isFinePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: fine)').matches;
}
