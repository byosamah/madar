import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestHost } from '../core/after';
import type { Db } from '../core/ports';
import { setEnvSource } from '../env';
import type { AppMount } from './apps';
import { requestScopedDb } from './requestDb';
import { workerEntry } from './worker';

/**
 * The Workers runtime ties a socket to the request that opened it (proof.md, E4): a pool kept for the isolate answers the first
 * request and hangs every later one. This fake Db acts the same way: it works for one request, and after close it "hangs".
 */
type FakeDb = Db & { close(): Promise<void>; closed: boolean; uses: number };

function workersDbs() {
  const opened: FakeDb[] = [];
  const openDb = (): FakeDb => {
    const use = async <R>(): Promise<R[]> => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (db.closed) throw new Error('The Workers runtime canceled this request: the code hung.');
      db.uses += 1;
      return [{ n: db.uses } as R];
    };
    const db: FakeDb = {
      closed: false,
      uses: 0,
      tx: (_mode, work) => work(use),
      savepoint: (q, work) => work(q),
      statement: () => use(),
      async close() {
        db.closed = true;
      },
    };
    opened.push(db);
    return db;
  };
  return { opened, openDb };
}

const LOCAL = {
  DATABASE_URL: 'postgres://postgres.pooler-dev:postgres@127.0.0.1:54329/postgres',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  MADAR_SECRET_KEY: 'sb_secret_made_up',
  APP_URL: 'http://127.0.0.1:5173',
  MAIL_FROM: 'Madar <notices@madar.test>',
  MAIL_DRIVER: 'outbox',
};

/** An app that reads the database once in the handler, and once more while its body streams. */
const PROBE: AppMount = {
  name: 'api',
  app: (deps) => {
    const app = new Hono();
    app.get('/one', async () => Response.json(await deps.db.statement('read', 'select 1')));
    app.get('/stream', async () => {
      const first = await deps.db.statement<{ n: number }>('read', 'select 1');
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      void (async () => {
        await writer.write(new TextEncoder().encode(`${first[0].n},`));
        const second = await deps.db.statement<{ n: number }>('read', 'select 1');
        await writer.write(new TextEncoder().encode(String(second[0].n)));
        await writer.close();
      })();
      return new Response(readable);
    });
    return app;
  },
};

function context() {
  const pending: Promise<unknown>[] = [];
  return { pending, ctx: { waitUntil: (p: Promise<unknown>) => void pending.push(p) } };
}

afterEach(() => {
  setEnvSource(undefined);
  vi.restoreAllMocks();
});

describe('the Workers entry and the database', () => {
  it('opens a database for each request and closes it after the answer, so a second request never hangs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { opened, openDb } = workersDbs();
    const worker = workerEntry({ openDb, mounts: [PROBE] });
    for (const expected of [1, 2]) {
      const { pending, ctx } = context();
      const response = await worker.fetch(new Request('http://127.0.0.1/api/one'), LOCAL, ctx);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([{ n: 1 }]);
      await Promise.all(pending);
      expect(opened).toHaveLength(expected);
      expect(opened[expected - 1].closed).toBe(true);
    }
  });

  it('keeps the database open until a streamed body ends, then closes it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { opened, openDb } = workersDbs();
    const worker = workerEntry({ openDb, mounts: [PROBE] });
    const { pending, ctx } = context();
    const response = await worker.fetch(new Request('http://127.0.0.1/api/stream'), LOCAL, ctx);
    expect(await response.text()).toBe('1,2');
    await Promise.all(pending);
    expect(opened).toHaveLength(1);
    expect(opened[0].closed).toBe(true);
  });

  it('gives the request an after on Workers, and keeps the database open until the work after the answer ends (S1)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { opened, openDb } = workersDbs();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const later: unknown[] = [];
    const AFTER: AppMount = {
      name: 'api',
      app: (deps) =>
        new Hono().get('/later', () => {
          const { host, after } = requestHost();
          after?.((async () => {
            await gate;
            later.push(await deps.db.statement('read', 'select 1'));
          })());
          return Response.json({ host, after: after !== undefined });
        }),
    };
    const worker = workerEntry({ openDb, mounts: [AFTER] });
    const { pending, ctx } = context();
    const response = await worker.fetch(new Request('http://127.0.0.1/api/later'), LOCAL, ctx);
    expect(await response.json()).toEqual({ host: 'workers', after: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(opened[0].closed).toBe(false);
    release();
    await Promise.all(pending);
    expect(later).toEqual([[{ n: 1 }]]);
    expect(opened[0].closed).toBe(true);
    // Without a waitUntil there is no after: the route keeps its work inline.
    const bare = await worker.fetch(new Request('http://127.0.0.1/api/later'), LOCAL);
    expect(await bare.json()).toEqual({ host: 'workers', after: false });
  });

  it('closes the database when the request has no body to stream, and without a waitUntil', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { opened, openDb } = workersDbs();
    const worker = workerEntry({ openDb, mounts: [PROBE] });
    const response = await worker.fetch(new Request('http://127.0.0.1/elsewhere'), LOCAL);
    expect(response.status).toBe(404);
    await response.text();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(opened.every((db) => db.closed)).toBe(true);
  });
});

describe('the Workers entry and the Hyperdrive binding (proof.md, Z0a item 7)', () => {
  const HYPERDRIVE = 'postgresql://madar_server:pw@0123abcd.hyperdrive.local:5432/postgres?sslmode=disable';
  /** The values of a Worker that gets its database from the binding DB: no DATABASE_URL and no DATABASE_CA. */
  const BOUND = { ...LOCAL, DATABASE_URL: undefined, DB: { connectionString: HYPERDRIVE } };
  /** An app that answers the database values that the entry gave the apps (the health route connects with them). */
  const VALUES: AppMount = { name: 'api', app: (_deps, values) => new Hono().get('/values', () => Response.json(values.database)) };

  it('opens the database of each request from the finished connection string of the binding, and needs no DATABASE_CA', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { opened, openDb } = workersDbs();
    const seen: unknown[] = [];
    const worker = workerEntry({ openDb: (database) => (seen.push(database), openDb()), mounts: [PROBE, VALUES] });
    for (let n = 0; n < 2; n += 1) {
      const { pending, ctx } = context();
      const response = await worker.fetch(new Request('http://127.0.0.1/api/one'), BOUND, ctx);
      expect(response.status).toBe(200);
      await response.text();
      await Promise.all(pending);
    }
    expect(seen).toEqual([{ connectionString: HYPERDRIVE }, { connectionString: HYPERDRIVE }]);
    expect(opened.every((db) => db.closed)).toBe(true);
    const values = await worker.fetch(new Request('http://127.0.0.1/api/values'), BOUND);
    expect(await values.json()).toEqual({ writeUrl: HYPERDRIVE, readUrl: HYPERDRIVE });
  });

  it('uses DATABASE_URL when the Worker has no binding', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const { openDb } = workersDbs();
    const seen: unknown[] = [];
    const worker = workerEntry({ openDb: (database) => (seen.push(database), openDb()), mounts: [PROBE] });
    const response = await worker.fetch(new Request('http://127.0.0.1/api/one'), LOCAL);
    await response.text();
    expect(seen).toEqual([{ writeUrl: LOCAL.DATABASE_URL, readUrl: LOCAL.DATABASE_URL }]);
  });
});

describe('the request database', () => {
  it('refuses work outside a request, with a message that names the cause', async () => {
    const scope = requestScopedDb();
    await expect(scope.db.statement('read', 'select 1')).rejects.toThrow(/outside a request/);
    const { openDb } = workersDbs();
    const inside = await scope.run(openDb(), () => scope.db.statement<{ n: number }>('read', 'select 1'));
    expect(inside).toEqual([{ n: 1 }]);
  });
});
