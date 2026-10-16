/**
 * The header that names the host of each answer (owner, 2026-10-16): x-madar-server is "supabase" on the Supabase functions and
 * "workers;colo=<data center>" on the Worker. The checks after a deploy (scripts/deploy/checks.sh) and the time measure
 * (scripts/proof/server-time.sh) read it, so they see which host answered through the page host. The entries set it on every
 * answer, also on a 404 and on the 503 of a start that failed.
 *
 * The colo is request.cf.colo: the data center where the request came in. Inside a placed Worker that is not the place where the
 * code runs (proof.md, Hyperdrive probe, fact 3); the run place shows in the cf-placement answer header that Cloudflare adds.
 */

export const SERVER_HEADER = 'x-madar-server';
export const SUPABASE_SERVER = 'supabase';

/** The value of the Worker: "workers;colo=FRA". A colo that is not three capital letters (or none) gives "unknown". */
export function workersServer(request: Request): string {
  const colo = (request as { cf?: { colo?: unknown } }).cf?.colo;
  return `workers;colo=${typeof colo === 'string' && /^[A-Z]{3}$/.test(colo) ? colo : 'unknown'}`;
}

/** The answer with the header. A Response with fixed headers (one that fetch gave back) gets a copy with the header. */
export function withServerHeader(response: Response, value: string): Response {
  try {
    response.headers.set(SERVER_HEADER, value);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    headers.set(SERVER_HEADER, value);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

/** The fetch of a Supabase function, with the header on every answer. */
export function onSupabase(fetch: (request: Request) => Response | Promise<Response>): (request: Request) => Promise<Response> {
  return async (request) => withServerHeader(await fetch(request), SUPABASE_SERVER);
}
