import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * pgDb without a database (plan 4.5, Connections; task C1). A fake pg.Pool records each pool it makes and each statement, so these
 * tests check the connection settings and the transaction rules. server/it/save.it.test.ts runs the same pgDb on the local stack.
 */

type FakeClient = { sql: string[]; released: unknown[]; query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>; release(error?: unknown): void };
type FakePool = { config: Record<string, unknown>; clients: FakeClient[]; ended: boolean; handlers: Record<string, unknown> };

const pools: FakePool[] = [];
/** A statement that fails, by its text, so a test can make one step fail. */
let failOn: RegExp | undefined;

vi.mock('pg', () => {
  class Pool {
    state: FakePool;
    constructor(config: Record<string, unknown>) {
      this.state = { config, clients: [], ended: false, handlers: {} };
      pools.push(this.state);
    }
    on(event: string, handler: unknown) {
      this.state.handlers[event] = handler;
      return this;
    }
    async connect(): Promise<FakeClient> {
      if (this.state.ended) throw new Error('Cannot use a pool after calling end on the pool');
      const client: FakeClient = {
        sql: [],
        released: [],
        async query(text: string) {
          client.sql.push(text);
          if (failOn?.test(text)) throw new Error(`failed: ${text}`);
          return { rows: [{ text }] };
        },
        release(error?: unknown) {
          client.released.push(error ?? null);
        },
      };
      this.state.clients.push(client);
      return client;
    }
    async end() {
      this.state.ended = true;
    }
  }
  return { default: { Pool }, Pool };
});

const { pgDb, refuseUnsafeStatement } = await import('./sql');

const LOCAL = { writeUrl: 'postgres://madar_server:pw@127.0.0.1:54329/postgres', readUrl: 'postgres://madar_server:pw@127.0.0.1:54329/postgres' };
const CLOUD = {
  writeUrl: 'postgres://madar_server.ref:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres',
  readUrl: 'postgres://madar_server.ref:pw@aws-1-eu-central-1.pooler.supabase.com:6543/postgres',
  ca: '-----BEGIN CERTIFICATE-----\nmade-up\n-----END CERTIFICATE-----\n',
};

beforeEach(() => {
  pools.length = 0;
  failOn = undefined;
});
afterEach(() => {
  failOn = undefined;
});

describe('pgDb connections', () => {
  it('makes no pool until the first query, then one pool for writes and one for reads, each max 1 with a 5 s connect limit', async () => {
    const db = pgDb(LOCAL);
    expect(pools).toHaveLength(0);
    await db.statement('read', 'select 1');
    expect(pools).toHaveLength(1);
    await db.tx('write', async (q) => q('select 2'));
    expect(pools).toHaveLength(2);
    for (const pool of pools) expect(pool.config).toMatchObject({ max: 1, connectionTimeoutMillis: 5000 });
    expect(pools.map((pool) => pool.config.connectionString)).toEqual([LOCAL.readUrl, LOCAL.writeUrl]);
    // An idle client that breaks must not stop the process: the pool keeps an error listener.
    for (const pool of pools) expect(typeof pool.handlers.error).toBe('function');
  });

  it('makes new pools for each pgDb, so nothing lives at module level', async () => {
    await pgDb(LOCAL).statement('read', 'select 1');
    await pgDb(LOCAL).statement('read', 'select 1');
    expect(pools).toHaveLength(2);
  });

  it('checks the server certificate against the root CA, with the host name, and never uses sslmode', async () => {
    const db = pgDb(CLOUD);
    await db.statement('write', 'select 1');
    expect(pools[0].config.ssl).toEqual({ ca: CLOUD.ca, rejectUnauthorized: true, servername: 'aws-1-eu-central-1.pooler.supabase.com' });
  });

  it('refuses a URL with sslmode, in either pool', () => {
    expect(() => pgDb({ ...CLOUD, writeUrl: `${CLOUD.writeUrl}?sslmode=require` })).toThrow(/sslmode/);
    expect(() => pgDb({ ...CLOUD, readUrl: `${CLOUD.readUrl}?application_name=x&sslmode=verify-full` })).toThrow(/sslmode/);
  });

  it('refuses a cloud host without the root CA, and uses no TLS for a local host', async () => {
    expect(() => pgDb({ writeUrl: CLOUD.writeUrl, readUrl: CLOUD.readUrl })).toThrow(/root certificate/);
    await pgDb(LOCAL).statement('read', 'select 1');
    expect(pools[0].config.ssl).toBeUndefined();
  });

  it('takes a finished connection string (the Hyperdrive binding of the Workers entry) as it is, for both pools, with no ssl option', async () => {
    const finished = 'postgresql://user:pw@0123abcd.hyperdrive.local:5432/postgres?sslmode=disable';
    const db = pgDb({ connectionString: finished });
    await db.statement('read', 'select 1');
    await db.tx('write', async (q) => q('select 1'));
    expect(pools.map((pool) => [pool.config.connectionString, pool.config.ssl])).toEqual([[finished, undefined], [finished, undefined]]);
  });

  it('ends both pools on close, and opens new ones on a later query', async () => {
    const db = pgDb(LOCAL);
    await db.close!();
    await db.statement('read', 'select 1');
    await db.tx('write', async (q) => q('select 1'));
    await db.close!();
    expect(pools.map((pool) => pool.ended)).toEqual([true, true]);
    await db.statement('read', 'select 1');
    expect(pools).toHaveLength(3);
  });
});

describe('pgDb transactions', () => {
  it('runs a write in one transaction with set local timeouts, and commits', async () => {
    const db = pgDb(LOCAL);
    const out = await db.tx('write', async (q) => q<{ text: string }>('select pg_advisory_xact_lock($1)', [7]));
    expect(out).toEqual([{ text: 'select pg_advisory_xact_lock($1)' }]);
    const [client] = pools[0].clients;
    expect(client.sql).toEqual([
      'begin',
      "set local lock_timeout = '5s'",
      "set local statement_timeout = '10s'",
      'select pg_advisory_xact_lock($1)',
      'commit',
    ]);
    expect(client.released).toEqual([null]);
  });

  it('runs a read in a repeatable read, read only transaction, with no lock timeout', async () => {
    await pgDb(LOCAL).tx('read', async (q) => q('select 1'));
    expect(pools[0].clients[0].sql).toEqual(['begin isolation level repeatable read, read only', "set local statement_timeout = '10s'", 'select 1', 'commit']);
  });

  it('rolls back when the work throws, gives back the error, and releases the client', async () => {
    const db = pgDb(LOCAL);
    await expect(db.tx('write', async (q) => {
      await q('insert into tasks values (1)');
      throw new Error('the handler failed');
    })).rejects.toThrow('the handler failed');
    const [client] = pools[0].clients;
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.released).toEqual([null]);
  });

  it('throws away a client whose rollback fails, so a broken connection never goes back to the pool', async () => {
    failOn = /^(select 1|rollback)$/;
    await expect(pgDb(LOCAL).tx('write', async (q) => q('select 1'))).rejects.toThrow('failed: select 1');
    expect(pools[0].clients[0].released).toEqual([true]);
  });

  it('refuses a nested transaction, also on another pgDb, and a statement inside a transaction', async () => {
    const db = pgDb(LOCAL);
    const other = pgDb(LOCAL);
    await expect(db.tx('write', () => db.tx('read', async () => 1))).rejects.toThrow(/nested/);
    await expect(db.tx('write', () => other.tx('write', async () => 1))).rejects.toThrow(/nested/);
    await expect(db.tx('read', () => db.statement('write', 'select 1'))).rejects.toThrow(/inside a transaction/);
    // The refusals rolled back each outer transaction, and the next transaction runs.
    expect(await db.tx('read', async () => 'free again')).toBe('free again');
  });

  it('lets two transactions run side by side, each in its own async context', async () => {
    const db = pgDb(LOCAL);
    const [a, b] = await Promise.all([db.tx('read', async () => 'a'), pgDb(LOCAL).tx('write', async () => 'b')]);
    expect([a, b]).toEqual(['a', 'b']);
  });

  it('refuses the query of a transaction after it ended', async () => {
    const db = pgDb(LOCAL);
    let kept: ((text: string) => Promise<unknown[]>) | undefined;
    await db.tx('write', async (q) => {
      kept = q;
    });
    await expect(kept!('select 1')).rejects.toThrow(/ended/);
  });

  it('makes a savepoint only when asked, and rolls back to it on an error', async () => {
    const db = pgDb(LOCAL);
    await db.tx('write', async (q) => {
      await db.savepoint(q, async (inner) => inner('select 1'));
      await expect(db.savepoint(q, async () => {
        throw new Error('inner failed');
      })).rejects.toThrow('inner failed');
    });
    expect(pools[0].clients[0].sql.slice(3, -1)).toEqual([
      'savepoint madar_sp_1', 'select 1', 'release savepoint madar_sp_1',
      'savepoint madar_sp_2', 'rollback to savepoint madar_sp_2', 'release savepoint madar_sp_2',
    ]);
  });

  it('refuses a savepoint outside its transaction', async () => {
    const db = pgDb(LOCAL);
    await expect(db.savepoint((async () => []) as never, async () => 1)).rejects.toThrow(/inside db.tx/);
  });

  it('runs one statement in a short transaction of its own, with the statement timeout', async () => {
    const rows = await pgDb(LOCAL).statement('read', 'select count(*) from tasks');
    expect(rows).toEqual([{ text: 'select count(*) from tasks' }]);
    expect(pools[0].clients[0].sql).toEqual([
      'begin isolation level repeatable read, read only', "set local statement_timeout = '10s'", 'select count(*) from tasks', 'commit',
    ]);
  });
});

describe('pgDb with the caller client of the D1 harness', () => {
  it('runs each transaction as a savepoint of the caller transaction, and never commits or opens a pool', async () => {
    const sql: string[] = [];
    const callerClient = { query: async (text: string) => (sql.push(text), { rows: [] }), release: () => undefined };
    const db = pgDb(LOCAL, { callerClient: callerClient as never });
    await db.tx('write', async (q) => q('insert into tasks values (1)'));
    await expect(db.tx('read', async () => {
      throw new Error('no');
    })).rejects.toThrow('no');
    await db.statement('read', 'select 1');
    expect(pools).toHaveLength(0);
    expect(sql).toEqual([
      'savepoint madar_tx', "set local lock_timeout = '5s'", "set local statement_timeout = '10s'", 'insert into tasks values (1)', 'release savepoint madar_tx',
      'savepoint madar_tx', "set local statement_timeout = '10s'", 'rollback to savepoint madar_tx', 'release savepoint madar_tx',
      'savepoint madar_tx', "set local statement_timeout = '10s'", 'select 1', 'release savepoint madar_tx',
    ]);
  });
});

describe('the statement guard', () => {
  it('refuses a plain SET, which would stay on a pooled backend and leak into another isolate (proof Z0a, item 4)', () => {
    for (const text of ["set statement_timeout = '7s'", "  SET lock_timeout TO '1s'", 'set session role postgres', 'reset statement_timeout', 'reset all', "select 1; set statement_timeout = '7s'"]) {
      expect(() => refuseUnsafeStatement(text), text).toThrow(/set local/i);
    }
  });

  it('refuses transaction control, which belongs to db.tx and db.savepoint', () => {
    for (const text of ['begin', 'commit', 'ROLLBACK', 'start transaction', 'end', 'savepoint x', 'release savepoint x', 'rollback to savepoint x', 'abort']) {
      expect(() => refuseUnsafeStatement(text), text).toThrow(/transaction/i);
    }
  });

  it('lets set local, set constraints and every ordinary statement through', () => {
    for (const text of [
      "set local statement_timeout = '1s'", 'SET LOCAL lock_timeout = 0', 'set constraints all immediate', 'select 1', 'insert into settings values ($1)',
      "select 'set x = 1; begin' as text", 'with x as (select 1) select * from x', 'update office_meta set version = version + 1',
    ]) {
      expect(() => refuseUnsafeStatement(text), text).not.toThrow();
    }
  });

  it('guards every query of a transaction and of a statement', async () => {
    const db = pgDb(LOCAL);
    await expect(db.tx('write', (q) => q("set statement_timeout = '7s'"))).rejects.toThrow(/set local/i);
    await expect(db.statement('write', 'commit')).rejects.toThrow(/transaction/i);
    // Neither refused statement reached the database: the transaction rolled back, and the statement opened no transaction.
    const sent = pools.flatMap((pool) => pool.clients.flatMap((client) => client.sql));
    expect(sent.some((text) => text.includes('7s'))).toBe(false);
    expect(sent.filter((text) => text === 'commit')).toEqual([]);
    expect(sent.at(-1)).toBe('rollback');
  });
});
