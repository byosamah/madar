import { officeEntry, onOffice } from './officeEntry';
import { workerEntry } from './worker';

/**
 * The bundle entry of the Worker (dist-server/worker.js, wrangler.server.toml): today's Postgres path (server/entries/worker.ts),
 * or the office path when the env asks for it (onOffice; exit wave 3). It exports the class of the office object, which the
 * binding OFFICE and the migration office-v1 name.
 */
export { Office } from '../office/office';

type Env = Record<string, unknown>;
type Ctx = { waitUntil(work: Promise<unknown>): void };

const postgres = workerEntry();
const office = officeEntry();

export default {
  fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    return onOffice(env) ? office.fetch(request, env, ctx) : postgres.fetch(request, env, ctx);
  },
};
