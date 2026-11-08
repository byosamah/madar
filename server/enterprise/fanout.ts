import type { Logger } from '../core/ports';
import { JOBS_SECRET_HEADER } from '../jobs/app';

// Task 3 moves this type to ids.ts.
type EnterpriseId = string;

/**
 * The Cron fan-out of Madar enterprises (design 5.13, spike S1). One Cron invocation lists the enterprises and sends one Worker
 * call for each, so the job of each enterprise has its own budget of outside calls. A leg that fails never stops the next one.
 */

/** The internal route that runs the job of one enterprise (jobs secret). */
export const CRON_PATH = '/api/internal/cron';

/** How many legs run at one time. Spike S1 decides if a higher number is safe; one leg at a time is the safe start. */
export const FANOUT_PARALLEL = 1;

export type FanoutLeg = { ent: EnterpriseId; ok: boolean; ms: number; status: number | null };
export type FanoutTransport = (leg: { ent: EnterpriseId; at: string }) => Promise<Response>;

export async function runFanout(o: {
  ids: readonly EnterpriseId[]; at: Date; transport: FanoutTransport; log: Logger; now?: () => number;
}): Promise<{ legs: FanoutLeg[] }> {
  const now = o.now ?? (() => Date.now());
  const legs: FanoutLeg[] = new Array(o.ids.length);
  const one = async (index: number): Promise<void> => {
    const ent = o.ids[index];
    const started = now();
    try {
      const response = await o.transport({ ent, at: o.at.toISOString() });
      // The body is never read or logged: it may hold text of the enterprise.
      legs[index] = { ent, ok: response.ok, ms: now() - started, status: response.status };
      if (!response.ok) o.log.warn('A Cron leg answered an error.', { ent, status: response.status });
    } catch (error) {
      legs[index] = { ent, ok: false, ms: now() - started, status: null };
      o.log.warn('A Cron leg did not run.', { ent, error: error instanceof Error ? error.message : String(error) });
    }
  };
  for (let from = 0; from < o.ids.length; from += FANOUT_PARALLEL) {
    const batch: Promise<void>[] = [];
    for (let index = from; index < Math.min(o.ids.length, from + FANOUT_PARALLEL); index += 1) batch.push(one(index));
    await Promise.all(batch);
  }
  return { legs };
}

type Fetcher = { fetch(request: Request): Promise<Response> };

/**
 * The two ways of one leg. self: the service binding SELF calls this Worker again, so the leg is a new invocation with its own
 * budget. api: a plain fetch to the public API address (apiUrl ends with /api). Both send the jobs secret in the header only.
 * path and extra are for the probe route of spike S1.
 */
export function selfTransport(
  env: Record<string, unknown>,
  o: { kind: 'self' | 'api'; secret: string; apiUrl: string; path?: string; extra?: Record<string, unknown> },
): FanoutTransport {
  return async (leg) => {
    const path = o.path ?? CRON_PATH;
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json', [JOBS_SECRET_HEADER]: o.secret },
      body: JSON.stringify({ ...leg, ...(o.extra ?? {}) }),
    };
    if (o.kind === 'api') {
      return fetch(`${o.apiUrl.replace(/\/$/, '')}${path.replace(/^\/api/, '')}`, init);
    }
    const self = env.SELF as Fetcher | undefined;
    if (!self || typeof self.fetch !== 'function') throw new Error('The Cron fan-out needs the service binding SELF. Add it to this env of wrangler.server.toml.');
    return self.fetch(new Request(`https://self.internal${path}`, init));
  };
}
