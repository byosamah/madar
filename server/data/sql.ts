import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import type { PoolClient } from 'pg';
import type { Db, Query } from '../core/ports';

/**
 * The database of the server (plan 4.5, Connections; task C1).
 *
 * Two pg pools, one for writes and one for reads, each with max 1, so a read never waits behind a write that waits for the office
 * lock. pgDb makes them inside the call and opens them on the first query, never at module level: on Cloudflare Workers a socket
 * belongs to the request that opened it, so the Workers entry makes one pgDb for each request and closes it after the answer
 * (proof.md, E4). On Supabase Edge Functions one pgDb lives as long as the isolate.
 *
 * TLS (proof.md, Z0a item 3): the Supabase pooler certificate chains to a private root, so the root certificate goes into the pg
 * ssl options (ca, rejectUnauthorized, servername), never as an sslmode in the URL. A URL with any TLS setting is refused.
 *
 * Timeouts (proof.md, Z0a item 4): Supavisor drops session settings and startup options, and a plain SET stays on the pooled
 * backend for the next client. So every timeout is a "set local" inside the transaction, and every query refuses a plain SET.
 * BEGIN and the set local lines go as one simple query, so the start of a transaction is one round trip (performance audit
 * SRV-9; proof.md: the settings hold inside the transaction and end with it, also through the transaction pooler).
 *
 * Idle connections (performance audit SRV-3; proof.md): a pool keeps its idle connection 120 s, under the 150 s life of a
 * worker, with TCP keepalive, so a click after a pause does not open a new TLS connection. The pg default is 10 s.
 */

/**
 * Where the database is.
 *   { writeUrl, readUrl, ca }   the transaction pooler, with the root certificate; ca may go only for a local host
 *   { connectionString }        a finished connection string, used as it is for both pools: the Hyperdrive binding of the
 *                               Workers entry, where Hyperdrive holds the certificate and the TLS mode (proof.md, Z0a item 7)
 */
export type DatabaseConfig = { writeUrl: string; readUrl: string; ca?: string } | { connectionString: string };

/** A Db that can end its connections. The Workers entry calls close() after each request. */
export type PgDb = Db & { close(): Promise<void> };

/** The connections of the D1 harness: one caller transaction for each test, rolled back after it (plan 7.2). */
export type PgDbOptions = { callerClient?: PoolClient };

const CONNECT_TIMEOUT_MS = 5000;
/**
 * An idle connection of the pooler pools closes after 1 s (2026-10-16). Supabase serves each request with a new worker that
 * lives 75 s and seldom takes a second request (function logs of madar-test), so a connection kept 120 s (performance audit
 * SRV-3) saved no connect and only held a client of the pooler: under the deploy suite about 85 workers held up to 2 each, the
 * client limit of 200 filled, and requests failed at once with EMAXCONN.
 */
const IDLE_TIMEOUT_MS = 1_000;
/**
 * The client limit of each query of a finished connection string: the Hyperdrive binding of the Worker (proof.md, "Hyperdrive
 * probe on madar-test (2026-10-16)"). Hyperdrive can hold a transaction in its BEGIN until it has a free origin connection.
 * Neither lock_timeout nor statement_timeout covers that wait, because the database does not have the statement yet. 12 s is
 * above the statement_timeout of 10 s, so a statement that the database stops gives its own error first.
 */
const QUERY_TIMEOUT_MS = 12_000;
/** The error of pg when query_timeout ends a query. The connection still runs that query, so a rollback on it would wait too. */
const QUERY_READ_TIMEOUT = 'Query read timeout';
const LOCK_TIMEOUT = "set local lock_timeout = '5s'";
const STATEMENT_TIMEOUT = "set local statement_timeout = '10s'";
const BEGIN = { read: 'begin isolation level repeatable read, read only', write: 'begin' } as const;
/** The start of a transaction in one round trip. No values, so pg sends it with the simple protocol, which takes more than one statement. */
const START = { read: `${BEGIN.read}; ${STATEMENT_TIMEOUT}`, write: `${BEGIN.write}; ${LOCK_TIMEOUT}; ${STATEMENT_TIMEOUT}` } as const;

/** The hosts that may go without TLS: the Mac and the names inside the local Docker network (the same list as server/core/deps.ts). */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', 'pooler', 'db', 'host.docker.internal']);

/** A message that the database sends beside an answer: RAISE NOTICE, RAISE WARNING. */
export type DbNotice = { severity?: string; code?: string; message: string };

/** The client behind each query of a transaction, so onNotice can listen on its connection. */
const clientOfQuery = new WeakMap<Query, PoolClient>();

/**
 * Calls listener with each notice that the database sends on the connection of q, until the returned stop runs. A notice of a
 * statement arrives before the answer of that statement, so a stop after the await of the statement misses none of its notices.
 * Undefined for a query that is not of pgDb (the memory data of the unit tests). The Realtime sender uses it: realtime.send
 * turns a failed send into a WARNING and never fails its statement (proof.md, Z0a item 5).
 */
export function onNotice(q: Query, listener: (notice: DbNotice) => void): (() => void) | undefined {
  const client = clientOfQuery.get(q);
  if (!client) return undefined;
  const handler = (notice: { severity?: string; code?: string; message?: string }) =>
    listener({ severity: notice.severity, code: notice.code, message: notice.message ?? '' });
  client.on('notice', handler);
  return () => {
    client.off('notice', handler);
  };
}

/** The transaction of the current async context. One for the whole module, so a transaction on another pgDb counts as nested too. */
type Open = { client: PoolClient; q: Query; savepoints: number };
const current = new AsyncLocalStorage<Open>();

/** Text with its string literals, quoted names and comments removed, so the guard reads only the statement words. */
function words(text: string): string {
  return text
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

const TRANSACTION_CONTROL = /^(begin|commit|rollback|abort|end|start\s+transaction|savepoint|release)\b/;

/** Every call of set_config, and every call whose last argument is the literal true (local to the transaction). */
const SET_CONFIG = /\bset_config\s*\(/g;
const SET_CONFIG_LOCAL = /\bset_config\s*\([^)]*,\s*true\s*\)/g;
/** The session forms of the advisory lock. The _xact_ forms end with the transaction and stay allowed. */
const SESSION_ADVISORY_LOCK = /\bpg_(try_)?advisory_lock(_shared)?\s*\(/;

/**
 * Refuses the statements that must never go through a query: a plain SET or RESET, a set_config that is not local, and a session
 * advisory lock (each stays on the pooled backend and leaks into another isolate), and transaction control (db.tx and db.savepoint
 * own it). "set local", "set constraints" and set_config(..., true) are allowed.
 */
export function refuseUnsafeStatement(text: string): void {
  for (const part of words(text).split(';')) {
    const statement = part.trim().toLowerCase().replace(/\s+/g, ' ');
    if (statement === '') continue;
    if (/^reset\b/.test(statement) || (/^set\b/.test(statement) && !/^set (local|constraints)\b/.test(statement))) {
      throw new Error('A plain SET stays on the pooled backend and reaches the next client. Use "set local" inside db.tx.');
    }
    if ((statement.match(SET_CONFIG)?.length ?? 0) !== (statement.match(SET_CONFIG_LOCAL)?.length ?? 0)) {
      throw new Error('A set_config without true as its last argument stays on the pooled backend. Use "set local" or set_config(..., true).');
    }
    if (SESSION_ADVISORY_LOCK.test(statement)) {
      throw new Error('A session advisory lock stays held on the pooled backend after commit. Use pg_advisory_xact_lock inside db.tx.');
    }
    if (TRANSACTION_CONTROL.test(statement)) {
      throw new Error('Transaction control belongs to db.tx and db.savepoint, not to a query.');
    }
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    throw new Error('The database URL does not parse.');
  }
}

/**
 * The pg settings of one pool. The finished connection string of the Workers entry keeps the pg defaults of idle time and
 * keepalive (that Db lives for one request only), and gets the client limit of each query.
 */
function poolConfig(database: DatabaseConfig, which: 'writeUrl' | 'readUrl'): pg.PoolConfig {
  const base = { max: 1, connectionTimeoutMillis: CONNECT_TIMEOUT_MS };
  if ('connectionString' in database) return { ...base, query_timeout: QUERY_TIMEOUT_MS, connectionString: database.connectionString };
  const kept = { ...base, idleTimeoutMillis: IDLE_TIMEOUT_MS, keepAlive: true };
  const url = database[which];
  const host = hostOf(url);
  if (database.ca === undefined) return { ...kept, connectionString: url };
  // pg sets the server name from the host only when the host is not an IP address; it is set here in every case for a name.
  const ssl = { ca: database.ca, rejectUnauthorized: true, ...(/^[\d.]+$|:/.test(host) ? {} : { servername: host }) };
  return { ...kept, connectionString: url, ssl };
}

function checkConfig(database: DatabaseConfig): void {
  if ('connectionString' in database) {
    hostOf(database.connectionString);
    return;
  }
  for (const [name, url] of [['writeUrl', database.writeUrl], ['readUrl', database.readUrl]] as const) {
    // pg reads ssl, sslmode, sslrootcert, sslcert, sslkey and uselibpqcompat from the URL, and the result replaces the ssl options
    // that carry the CA ("?ssl=0" turns TLS off). So the URL carries no TLS setting at all.
    if (/[?&](ssl\w*|uselibpqcompat)=/i.test(url)) {
      throw new Error(`The ${name} must not carry a TLS setting such as ssl or sslmode: pass the root certificate as ca (plan 4.5).`);
    }
    if (database.ca === undefined && !LOCAL_HOSTS.has(hostOf(url))) {
      throw new Error(`The ${name} names a host that is not local, so it needs the root certificate (ca).`);
    }
  }
}

export function pgDb(database: DatabaseConfig, o: PgDbOptions = {}): PgDb {
  checkConfig(database);
  const pools: { write?: pg.Pool; read?: pg.Pool } = {};

  function poolOf(mode: 'read' | 'write'): pg.Pool {
    let pool = pools[mode];
    if (!pool) {
      pool = new pg.Pool(poolConfig(database, mode === 'write' ? 'writeUrl' : 'readUrl'));
      // A client that breaks while idle emits "error" on its pool; without a listener the process stops. The pool drops that
      // client, and the next query opens a new one.
      pool.on('error', () => undefined);
      pools[mode] = pool;
    }
    return pool;
  }

  /** The query of one transaction. It refuses unsafe statements, and every use after the transaction has ended. */
  function queryOf(client: PoolClient, open: { ended: boolean }): Query {
    const q: Query = async <R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<R[]> => {
      if (open.ended) throw new Error('This query belongs to a transaction that has ended.');
      refuseUnsafeStatement(text);
      const result = await client.query(text, values as unknown[] | undefined);
      return result.rows as R[];
    };
    clientOfQuery.set(q, client);
    return q;
  }

  async function run<T>(mode: 'read' | 'write', work: (q: Query) => Promise<T>): Promise<T> {
    if (current.getStore()) throw new Error('A nested transaction is not allowed: the work already runs inside db.tx.');
    const caller = o.callerClient;
    const client = caller ?? (await poolOf(mode).connect());
    const state = { ended: false };
    const q = queryOf(client, state);
    const open: Open = { client, q, savepoints: 0 };
    let broken = false;
    try {
      if (caller) {
        // The D1 harness keeps one transaction for each test, so each transaction of the code is a savepoint inside it.
        await client.query('savepoint madar_tx');
        if (mode === 'write') await client.query(LOCK_TIMEOUT);
        await client.query(STATEMENT_TIMEOUT);
      } else {
        await client.query(START[mode]);
      }
      const out = await current.run(open, () => work(q));
      state.ended = true;
      await client.query(caller ? 'release savepoint madar_tx' : 'commit');
      return out;
    } catch (error) {
      state.ended = true;
      if (!caller && error instanceof Error && error.message === QUERY_READ_TIMEOUT) {
        // The query still runs on this connection. Throw the client away: its end stops the transaction on the database side.
        broken = true;
        throw error;
      }
      try {
        if (caller) {
          await client.query('rollback to savepoint madar_tx');
          await client.query('release savepoint madar_tx');
        } else {
          await client.query('rollback');
        }
      } catch {
        // The connection is broken: the pool must not give this client out again.
        broken = true;
      }
      throw error;
    } finally {
      if (!caller) client.release(broken ? true : undefined);
    }
  }

  return {
    tx: run,

    async warm(mode: 'read' | 'write'): Promise<void> {
      // A connect with no statement. A pool that has a client (idle, busy or still connecting) needs nothing.
      if (o.callerClient) return;
      const pool = poolOf(mode);
      if (pool.totalCount > 0) return;
      (await pool.connect()).release();
    },

    async savepoint<T>(q: Query, work: (q: Query) => Promise<T>): Promise<T> {
      const open = current.getStore();
      if (!open || open.q !== q) throw new Error('A savepoint runs only inside db.tx, with the query of that transaction.');
      open.savepoints += 1;
      const name = `madar_sp_${open.savepoints}`;
      await open.client.query(`savepoint ${name}`);
      try {
        const out = await work(q);
        await open.client.query(`release savepoint ${name}`);
        return out;
      } catch (error) {
        await open.client.query(`rollback to savepoint ${name}`);
        await open.client.query(`release savepoint ${name}`);
        throw error;
      }
    },

    async statement<R = Record<string, unknown>>(mode: 'read' | 'write', text: string, values?: unknown[]): Promise<R[]> {
      if (current.getStore()) throw new Error('db.statement runs on its own connection, so it cannot run inside a transaction.');
      refuseUnsafeStatement(text);
      // A short transaction of its own, so the statement timeout is a "set local" like every other timeout.
      return run(mode, (q) => q<R>(text, values));
    },

    async close(): Promise<void> {
      const open = [pools.write, pools.read].filter((pool): pool is pg.Pool => pool !== undefined);
      pools.write = undefined;
      pools.read = undefined;
      await Promise.all(open.map((pool) => pool.end()));
    },
  };
}
