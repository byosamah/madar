import { MissingConfigError } from '../core/deps';

/**
 * The first request of an isolate builds the app; later requests reuse it (plan 4.10: the api function logs SB_REGION at a
 * cold start). A start that fails answers 503 and logs why, with the names of the missing values and never a value. The next
 * request tries again, so a secret set after the deploy works without a new deploy.
 */

/** after: work that may go on after the answer (ctx.waitUntil on Workers). A host without it leaves it out. */
export type After = (work: Promise<unknown>) => void;
export type Started = { fetch: (request: Request, after?: After) => Response | Promise<Response>; region: string };

export function lazyStart(fn: string, build: () => Started): (request: Request, after?: After) => Promise<Response> {
  let started: Started | undefined;
  return async (request, after) => {
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
}
