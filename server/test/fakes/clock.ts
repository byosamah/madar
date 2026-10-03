import type { Clock } from '../../core/ports';

export type FixedClock = Clock & { set(at: string | Date): void; advance(ms: number): void };

/** A clock that stands still until a test moves it. */
export function fixedClock(at: string | Date = '2026-10-03T06:00:00Z'): FixedClock {
  let current = new Date(at);
  return {
    now: () => new Date(current),
    set(next) {
      current = new Date(next);
    },
    advance(ms) {
      current = new Date(current.getTime() + ms);
    },
  };
}
