import { MissingConfigError } from '../core/deps';

/**
 * The first request of an isolate builds the app; later requests reuse it (plan 4.10: the api function logs SB_REGION at a
 * cold start). A start that fails answers 503 and logs why, with the names of the missing values and never a value. The next
 * request tries again, so a secret set after the deploy works without a new deploy.
 */

/** after: work that may go on after the answer (ctx.waitUntil on Workers). A host without it leaves it out. */
export type After = (work: Promise<unknown>) => void;
/**
 * warm: work that a new worker starts before its first request, without waiting for it (performance audit LIV-7). close: ends
 * the database pools of the isolate (2026-10-16, see closeOnUnload).
 */
export type Started = {
  fetch: (request: Request, after?: After) => Response | Promise<Response>;
  region: string;
  warm?: () => void;
  close?: () => Promise<void>;
};
/**
 * The fetch of a function, and warm(): it builds the app now, before the first request, and starts the warm-up of the app. A
 * build that fails stays silent there: the first request builds again, logs why and answers 503, as without warm().
 */
export type LazyStart = ((request: Request, after?: After) => Promise<Response>) & { warm(): void; close(): Promise<void> };

export function lazyStart(fn: string, build: () => Started): LazyStart {
  let started: Started | undefined;
  const warm = (): void => {
    if (started) return;
    try {
      started = build();
    } catch {
      return;
    }
    console.log(JSON.stringify({ level: 'info', message: 'Cold start.', fn, region: started.region }));
    started.warm?.();
  };
  const fetch = async (request: Request, after?: After): Promise<Response> => {
    if (!started) {
      try {
        started = build();
        console.log(JSON.stringify({ level: 'info', message: 'Cold start.', fn, region: started.region }));
      } catch (error) {
        const fields = error instanceof MissingConfigError ? { missing: error.names } : { error: error instanceof Error ? error.message : String(error) };
        console.error(JSON.stringify({ level: 'error', message: 'The server cannot start.', fn, ...fields }));
        return Response.json(
          { v: 1, error: { code: 'failed', message: 'The server is not ready. Try again later.', details: { reason: 'not_configured' } } },
          { status: 503 },
        );
      }
    }
    return started.fetch(request, after);
  };
  // The Db opens its pools again on the next query, so a request after a close still works.
  const close = async (): Promise<void> => {
    try {
      await started?.close?.();
    } catch (error) {
      console.warn(JSON.stringify({ level: 'warn', message: 'The database pools did not close.', fn, error: error instanceof Error ? error.message : String(error) }));
    }
  };
  return Object.assign(fetch, { warm, close });
}

/**
 * Supabase stops a worker as soon as it has no work left (shutdown reason EarlyDrop), often after one request, and fires
 * beforeunload first. Its database connections must close then: a dropped worker that keeps them open fills the client limit
 * of the pooler (200 on madar-test), and every later request fails with EMAXCONN (deploy suite, 2026-10-16). Node has no
 * addEventListener on globalThis, so a test or a script registers nothing.
 */
export function closeOnUnload(start: Pick<LazyStart, 'close'>, target: unknown = globalThis): void {
  const events = target as Partial<Pick<EventTarget, 'addEventListener'>> | undefined;
  if (typeof events?.addEventListener !== 'function') return;
  events.addEventListener('beforeunload', () => void start.close());
}
