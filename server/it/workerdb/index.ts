import { Hono } from 'hono';
import type { AppMount } from '../../entries/apps';
import { workerEntry } from '../../entries/worker';

/**
 * A probe Worker for server/it/workerdb.it.test.ts (task C1): the real Workers entry with one probe app at /api, so a request
 * runs a write transaction and a statement through deps.db, on the Db that the entry opens for each request from the Hyperdrive
 * binding DB. Only "wrangler dev" runs it, against the local stack.
 */

const LOCK_KEY = 7_310_888;

const probe: AppMount = {
  name: 'api',
  app: (deps) =>
    new Hono().get('/db', async () => {
      const tx = await deps.db.tx('write', async (q) => {
        await q('select pg_advisory_xact_lock($1)', [LOCK_KEY]);
        const [held] = await q<{ n: number }>(
          "select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted and objid = $1",
          [LOCK_KEY],
        );
        const [timeouts] = await q<{ lock: string; statement: string }>(
          "select current_setting('lock_timeout') as lock, current_setting('statement_timeout') as statement",
        );
        return { lockHeld: held.n === 1, timeouts };
      });
      const [settings] = await deps.db.statement<{ n: number }>('read', 'select count(*)::int as n from settings');
      return Response.json({ ok: true, tx, settingsRows: settings.n });
    }),
};

export default workerEntry({ mounts: [probe] });
