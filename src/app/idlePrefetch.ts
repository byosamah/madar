import type { QueryClient } from '@tanstack/react-query';
import { SCREEN_NAMES, type ScreenName } from './screens';
import { whenIdle } from './whenIdle';

/**
 * The idle prefetch starts by itself this long after the call, also when no answer came. It is no short time: a phone on a slow line
 * gets its first rows after 5 s or more, and a start before the rows would bring back the shared line that this file removes.
 */
export const PREFETCH_SAFETY_MS = 10_000;

/**
 * The quiet time between the free line and the first import. The rows draw first, then the text of Home (the largest paint, 150 to 350 ms
 * later on a phone with a slow processor), and the module code of 60 files would delay that paint.
 */
export const PREFETCH_GAP_MS = 1000;

/** The screen imports that run side by side. A press on a tab then never waits behind the whole queue. */
export const PREFETCH_AT_ONCE = 3;

/** The screens that a person opens most, first. The others follow in the order of `screenLoaders.ts`. */
const FIRST_SCREENS: readonly ScreenName[] = ['projects', 'project', 'work', 'inbox', 'dashboard', 'notifications', 'meetings', 'me'];

/** The order of the idle prefetch: the likely next screens first (Projects, the project page, Tasks, Inbox), then the rest. */
export function prefetchOrder(): ScreenName[] {
  return [...FIRST_SCREENS, ...SCREEN_NAMES.filter((name) => !FIRST_SCREENS.includes(name))];
}

/**
 * Starts the idle prefetch only after the first screen shows its data (speed follow-up, 2026-10-22). Before, it started at the
 * first render and sent 67 more chunk requests (562 KB), 64 of them before the first Home rows, on the same line as the first
 * answer and the words: on a phone on 4G the first rows came at 5.1 s. Now `start` runs:
 *  - `PREFETCH_GAP_MS` after the first idle step that follows the first fresh answer of this page (data or error) with no read on its
 *    way, so the first rows draw before it (the first request has more than one answer, and a chunk would share the line with the
 *    slow one). A read that begins in the gap holds the start until it ends, or
 *  - the same on a screen with no reads (a signed-out start: the sign-in screen), or
 *  - `PREFETCH_SAFETY_MS` after the call, when no answer came, so the prefetch always runs once.
 * An answer that the Home cache stored from an earlier visit has an old time and does not count (`homeCache.ts`).
 * The prefetch exists because a release removes old chunks: an open tab must already hold its screens. A later start does not
 * change that. Returns the function that cancels the wait.
 */
export function startIdlePrefetch(o: {
  queryClient: QueryClient;
  /** True when the page starts signed out: there are no reads to wait for. */
  signedOut: boolean;
  start: () => void;
  idle?: (run: () => void) => void;
  safetyMs?: number;
  gapMs?: number;
}): () => void {
  const { queryClient, signedOut, start, idle = whenIdle, safetyMs = PREFETCH_SAFETY_MS, gapMs = PREFETCH_GAP_MS } = o;
  const since = Date.now();
  const cache = queryClient.getQueryCache();
  let begun = false;
  let stopped = false;
  let waiting = false;
  let stopListening = () => undefined as void;
  let gap: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    stopListening();
    clearTimeout(safety);
    clearTimeout(gap);
  };
  const begin = () => {
    if (begun || stopped) return;
    begun = true;
    cleanup();
    start();
  };
  /** The first answer is in and no read is on its way: the line is free, and the rows draw next. */
  const quiet = () => queryClient.isFetching() === 0 && cache.getAll().some((query) => query.state.dataUpdatedAt >= since || query.state.errorUpdatedAt >= since);
  /** Waits for one idle step and the quiet gap, so the rows of the answer and the text of Home draw first. A read that began meanwhile holds the start until it ends. */
  const afterIdle = () => {
    if (waiting || begun || stopped) return;
    waiting = true;
    idle(() => {
      if (!signedOut && !quiet()) {
        waiting = false;
        return;
      }
      gap = setTimeout(() => {
        waiting = false;
        if (signedOut || quiet()) begin();
      }, gapMs);
    });
  };

  const safety = setTimeout(begin, safetyMs);
  if (signedOut) afterIdle();
  else {
    stopListening = cache.subscribe(() => {
      if (quiet()) afterIdle();
    });
    if (quiet()) afterIdle();
  }
  return () => {
    stopped = true;
    cleanup();
  };
}
