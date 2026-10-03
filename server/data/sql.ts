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
 * ssl options (ca, rejectUnauthorized, servername), never as an sslmode in the URL. A URL with sslmode is refused.
 *
 * Timeouts (proof.md, Z0a item 4): Supavisor drops session settings and startup options, and a plain SET stays on the pooled
 * backend for the next client. So every timeout is a "set local" inside the transaction, and every query refuses a plain SET.
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
const LOCK_TIMEOUT = "set local lock_timeout = '5s'";
const STATEMENT_TIMEOUT = "set local statement_timeout = '10s'";
const BEGIN = { read: 'begin isolation level repeatable read, read only', write: 'begin' } as const;

/** The hosts that may go without TLS: the Mac and the names inside the local Docker network (the same list as server/core/deps.ts). */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1', 'pooler', 'db', 'host.docker.internal']);

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

/**
 * Refuses the statements that must never go through a query: a plain SET or RESET (it stays on the pooled backend and leaks into
 * another isolate), and transaction control (db.tx and db.savepoint own it). "set local" and "set constraints" are allowed.
 */
export function refuseUnsafeStatement(text: string): void {
  for (const part of words(text).split(';')) {
    const statement = part.trim().toLowerCase().replace(/\s+/g, ' ');
    if (statement === '') continue;
    if (/^reset\b/.test(statement) || (/^set\b/.test(statement) && !/^set (local|constraints)\b/.test(statement))) {
      throw new Error('A plain SET stays on the pooled backend and reaches the next client. Use "set local" inside db.tx.');
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

/** The pg settings of one pool. */
function poolConfig(database: DatabaseConfig, which: 'writeUrl' | 'readUrl'): pg.PoolConfig {
  const base = { max: 1, connectionTimeoutMillis: CONNECT_TIMEOUT_MS };
  if ('connectionString' in database) return { ...base, connectionString: database.connectionString };
  const url = database[which];
  const host = hostOf(url);
  if (database.ca === undefined) return { ...base, connectionString: url };
  // pg sets the server name from the host only when the host is not an IP address; it is set here in every case for a name.
  const ssl = { ca: database.ca, rejectUnauthorized: true, ...(/^[\d.]+$|:/.test(host) ? {} : { servername: host }) };
  return { ...base, connectionString: url, ssl };
}

function checkConfig(database: DatabaseConfig): void {
  if ('connectionString' in database) {
    hostOf(database.connectionString);
    return;
  }
  for (const [name, url] of [['writeUrl', database.writeUrl], ['readUrl', database.readUrl]] as const) {
    if (/[?&]sslmode=/i.test(url)) throw new Error(`The ${name} must not carry sslmode: pass the root certificate as ca (plan 4.5).`);
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
    return async <R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<R[]> => {
      if (open.ended) throw new Error('This query belongs to a transaction that has ended.');
      refuseUnsafeStatement(text);
      const result = await client.query(text, values as unknown[] | undefined);
      return result.rows as R[];
    };
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
      // The D1 harness keeps one transaction for each test, so each transaction of the code is a savepoint inside it.
      await client.query(caller ? 'savepoint madar_tx' : BEGIN[mode]);
      if (mode === 'write') await client.query(LOCK_TIMEOUT);
      await client.query(STATEMENT_TIMEOUT);
      const out = await current.run(open, () => work(q));
      state.ended = true;
      await client.query(caller ? 'release savepoint madar_tx' : 'commit');
      return out;
    } catch (error) {
      state.ended = true;
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
