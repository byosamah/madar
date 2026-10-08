import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * One function for the life of the component that always runs the handler of the last render. A memoized list body takes it,
 * so a new link (for example an open task panel) gives the body no new prop and its rows do not render again (performance
 * audit 2026-10-07, RND-2). Call it only from an event, never in render.
 */
export function useStableHandler<A extends unknown[], R>(handler: (...args: A) => R): (...args: A) => R {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
  return useCallback((...args: A) => latest.current(...args), []);
}
