import { isCancelledError, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/errors';
import { scrubUrl } from '../../lib/urlScrub';
import { screensAt } from '../routes';
import type { AppRouter } from './index';
import type { InsightClient } from './notes';

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
      // Home sits in the first script, so the screen table has no name for '/'.
      const screen = location.pathname === '/' ? 'home' : (screensAt(location.pathname, true).screens.at(-1) ?? 'unknown');
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

/**
 * The cause of a failed call, from numbers and fixed words only (chat, 2026-11-08: failed calls happen only on iPhone and the data could
 * not say why): the HTTP status when there is one, the kind (network, timeout, server, refused), whether the browser said it was offline,
 * and the path of the call (the own /api of the page, or direct). It never reads the text of the error or a reason: those can hold words
 * that a person wrote.
 */
function causeOf(error: ApiError): { status?: number; kind: 'network' | 'timeout' | 'server' | 'refused'; offline: boolean; via?: 'page' | 'direct' } {
  const { cause, status, via } = error.details;
  const kind = cause === 'timeout' || cause === 'network' ? cause : typeof status === 'number' && status < 500 ? 'refused' : 'server';
  return {
    ...(typeof status === 'number' ? { status } : {}),
    kind,
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
    ...(via === 'page' || via === 'direct' ? { via } : {}),
  };
}

/** The codes of a server "no" that carry a reason a person must understand. */
const REFUSAL_CODES: readonly string[] = ['forbidden', 'invalid_input', 'conflict', 'not_found'];

/**
 * Watches every call that fails, in the query cache and in the mutation cache:
 *  - a refusal with a reason (`week_locked`, `needs_lead`): the call name, the code and the reason only, no person;
 *  - a call that ends with `failed` (a server fault, a lost network, a timeout): the call name only, no person;
 *  - `unauthenticated`: nothing (a sign-out is no error);
 *  - any other error (a bug in a screen or in a handler): an exception record, which gets the person in `before_send`.
 * It never reads the input of a call, so a name, a title or a message a person wrote never leaves the browser.
 */
export function watchCalls(queryClient: QueryClient, client: InsightClient, now: () => number = Date.now): () => void {
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
        // An action, so it carries no person (owner, 2026-10-25 and 2026-10-28). Only an $exception record does.
        client.track('madar_call_failed', { call, ...causeOf(error) });
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
