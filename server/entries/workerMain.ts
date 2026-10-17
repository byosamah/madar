import { officeEntry, onOffice } from './officeEntry';
import { servesOffice } from './officeWorker';
import { workerEntry } from './worker';

/**
 * The bundle entry of the Worker (dist-server/worker.js, wrangler.server.toml): today's Postgres path (server/entries/worker.ts),
 * or the office path when the env asks for it (onOffice; exit wave 3). The office ops under /api/office/ go to the office path
 * whenever the binding OFFICE exists (servesOffice; exit wave 4). It exports the class of the office object, which the binding
 * OFFICE and the migration office-v1 name.
 */
export { Office } from '../office/office';

type Env = Record<string, unknown>;
type Ctx = { waitUntil(work: Promise<unknown>): void };

const postgres = workerEntry();
const office = officeEntry();

export default {
  fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    return servesOffice(env, new URL(request.url).pathname) ? office.fetch(request, env, ctx) : postgres.fetch(request, env, ctx);
  },
  async scheduled(controller: { scheduledTime: number }, env: Env, ctx: Ctx): Promise<void> {
    // Until a copy moves to its office object (wave 5), the Supabase jobs function runs the 15-minute job of every copy: here a
    // Cron run of a Worker without MADAR_DATA = "office" returns at once, with no object call and no network call.
    if (!onOffice(env)) return;
    ctx.waitUntil(office.scheduled(new Date(controller.scheduledTime), env));
  },
};
