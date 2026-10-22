import { useEffect, useState } from 'react';
import { whenIdle } from './whenIdle';

/**
 * How many rows of a long list to draw now (performance audit 2026-10-21, RN-2). A list with more than `first` rows draws `first` at
 * once, so the screen shows after a short first paint, and the other rows follow at an idle moment (`whenIdle`: Safari has no
 * requestIdleCallback and waits 200 ms). The last list is the same list. After that step the hook always gives `total`, for the life of
 * the part that calls it.
 */
export function useStaged(total: number, first: number): number {
  const [done, setDone] = useState(false);
  const staged = !done && total > first;
  useEffect(() => {
    if (!staged) return undefined;
    let live = true;
    whenIdle(() => {
      if (live) setDone(true);
    });
    return () => {
      live = false;
    };
  }, [staged]);
  return staged ? first : total;
}
