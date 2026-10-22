/**
 * Runs a step when the browser is idle. Safari (and so every browser on an iPhone) has no requestIdleCallback, so it waits 200 ms there.
 * Never call requestIdleCallback, scheduler.postTask or scheduler.yield by itself: they are missing in Safari. `screens.ts` also
 * exports this function. It lives in its own file so a part of a screen can import it without the table of the screen loaders.
 */
export function whenIdle(run: () => void): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => run());
  else setTimeout(run, 200);
}
