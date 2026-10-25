import { isCancelledError, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/errors';
import { scrubUrl } from '../../lib/urlScrub';
import { screensAt } from '../routes';
import type { AppRouter } from './index';
import type { InsightClient, InsightPerson } from './notes';

/** The watchers of the screens (insight design, section 4). Each returns the function that stops it. */

/**
 * One page view at the start and one for each change of the path or of the `tab` of a project page. The screen name comes from the
 * route table, not from the address, so the owner counts screens and not ids. No other query value counts, and none goes out.
 */
export function watchRoutes(router: AppRouter, track: InsightClient['track']): () => void {
  let last = '';
  const note = (location: { pathname: string; search: string }) => {
    try {
      const tab = new URLSearchParams(location.search).get('tab');
      const key = `${location.pathname}|${tab ?? ''}`;
      if (key === last) return;
      last = key;
      const screen = screensAt(location.pathname, true).screens.at(-1) ?? 'unknown';
      track('$pageview', {
        screen,
        ...(tab ? { tab } : {}),
        $current_url: scrubUrl(`${window.location.origin}${location.pathname}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`),
      });
    } catch {
      // PostHog is never allowed to break Madar.
    }
  };
  note(router.state.location);
  return router.subscribe((state) => note(state.location));
}

/** The same failed call is counted once in this time, so a lost network is one note and not a flood. */
const FAILED_GAP_MS = 5000;

/** The codes of a server "no" that carry a reason a person must understand. */
const REFUSAL_CODES: readonly string[] = ['forbidden', 'invalid_input', 'conflict', 'not_found'];

/**
 * Watches every call that fails, in the query cache and in the mutation cache:
 *  - a refusal with a reason (`week_locked`, `needs_lead`): the call name, the code and the reason only, no person;
 *  - a call that ends with `failed` (a server fault, a lost network, a timeout): the call name and the person;
 *  - `unauthenticated`: nothing (a sign-out is no error);
 *  - any other error (a bug in a screen or in a handler): an exception record, which carries the person through `before_send`.
 * It never reads the input of a call, so a name, a title or a message a person wrote never leaves the browser.
 */
export function watchCalls(queryClient: QueryClient, client: InsightClient, person: () => InsightPerson | null, now: () => number = Date.now): () => void {
  const failedAt = new Map<string, number>();
  const note = (key: readonly unknown[], error: unknown) => {
    try {
      if (key[0] !== 'api' || typeof key[1] !== 'string' || isCancelledError(error)) return;
      const call = key[1];
      if (!(error instanceof ApiError)) {
        client.exception(error, { where: 'call', call });
      } else if (error.code === 'unauthenticated') {
        // A sign-out or an ended session. Not an error.
      } else if (error.code === 'failed') {
        const at = now();
        const last = failedAt.get(call);
        if (last !== undefined && at - last < FAILED_GAP_MS) return;
        failedAt.set(call, at);
        const who = person();
        client.track('madar_call_failed', who ? { call, personId: who.id, personName: who.name } : { call });
      } else if (REFUSAL_CODES.includes(error.code) && typeof error.details.reason === 'string') {
        client.track('madar_refused', { call, code: error.code, reason: error.details.reason });
      }
    } catch {
      // PostHog is never allowed to break Madar.
    }
  };
  const stopQueries = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') note(event.query.queryKey, event.query.state.error);
  });
  const stopMutations = queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') note(event.mutation.options.mutationKey ?? [], event.mutation.state.error);
  });
  return () => {
    stopQueries();
    stopMutations();
  };
}
