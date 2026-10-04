import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The host of the running request, and its "after" (task S1): work that goes on after the answer.
 *
 * - Workers: the entry (server/entries/worker.ts) runs each request inside runInHost({ host: 'workers', after }). after is
 *   ctx.waitUntil, and the entry closes the request database only when that work has ended.
 * - Supabase Edge Functions: no scope; the runtime gives the global EdgeRuntime, whose waitUntil keeps the function alive
 *   until the work ends. The database pools live as long as the isolate there.
 * - Anything else (unit tests, local runs with no host): no after, so a route keeps its work inline.
 *
 * The forgot route (server/auth/forgot.ts) hands its lookup and its send to after, so the time of its answer tells nothing.
 */

export type After = (work: Promise<unknown>) => void;
export type HostName = 'workers' | 'supabase' | 'other';
export type RequestHost = { host: HostName; after?: After };

const scope = new AsyncLocalStorage<RequestHost>();

/** Runs the work of one request with its host. The Workers entry calls it. */
export function runInHost<T>(host: RequestHost, work: () => T): T {
  return scope.run(host, work);
}

type EdgeRuntime = { waitUntil?: (work: Promise<unknown>) => void };

/** The host of the running request. */
export function requestHost(): RequestHost {
  const own = scope.getStore();
  if (own) return own;
  const edge = (globalThis as { EdgeRuntime?: EdgeRuntime }).EdgeRuntime;
  if (edge !== undefined) {
    const waitUntil = edge.waitUntil;
    return typeof waitUntil === 'function' ? { host: 'supabase', after: (work) => waitUntil.call(edge, work) } : { host: 'supabase' };
  }
  return { host: 'other' };
}
