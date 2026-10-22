import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { WireResponse } from '../../src/api/remote/wire';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { memoryData } from '../core/memoryData';
import type { Db, Query } from '../core/ports';
import { createRunCall, joinsFirstRead } from '../core/runCall';
import type { OfficeSnapshot, RunRequest, RunResult } from '../core/types';
import { fakeDeps } from '../test/fakes/deps';
import { apiApp, type AppOptions } from './app';

/**
 * The first read of a batch joins the sign-in transaction (performance audit SV-5). handleBatch opens one read transaction, reads
 * the office in it, runs the first call in it when it is a plain read, and ends it. Every other entry opens its own transaction,
 * so a read after a write in the same batch still sees the write (FET-3). The statement counts are in roundTrips.test.ts.
 */

const office = { version: 7, lists: {} } as unknown as OfficeSnapshot;

type Log = string[];

/** A Db that opens no connection: it records each transaction and how it ended. */
function recordingDb(log: Log): Db {
  const q = (async () => []) as unknown as Query;
  return {
    async tx(mode, work) {
      log.push(`begin:${mode}`);
      try {
        const out = await work(q);
        log.push('commit');
        return out;
      } catch (error) {
        log.push('rollback');
        throw error;
      }
    },
    savepoint: () => Promise.reject(new Error('no savepoint')),
    statement: () => Promise.reject(new Error('no statement')),
  };
}

async function post(app: ReturnType<typeof apiApp>, calls: unknown[]): Promise<Response> {
  return app.fetch(
    new Request('http://127.0.0.1/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer good' },
      body: JSON.stringify({ v: 1, calls }),
    }),
  );
}

const verify: AppOptions['verifyToken'] = async (header) => {
  if (header !== 'Bearer good') throw new ApiError('unauthenticated', 'Sign in again.');
  return { authUserId: 'auth-1' };
};

describe('the first read joins the sign-in transaction (SV-5)', () => {
  function harness(o: { join: boolean; failFirst?: boolean }) {
    const log: Log = [];
    const seen: { name: string; open: boolean }[] = [];
    const deps = fakeDeps({ db: recordingDb(log) });
    const app = apiApp(deps, {
      runCall: async (_d, req: RunRequest): Promise<RunResult> => {
        seen.push({ name: req.name, open: req.open !== undefined });
        log.push(`call:${req.name}`);
        if (req.name === 'tasks.bad') return { ok: false, error: { code: 'invalid_input', message: 'Some fields are not valid.' } };
        return { ok: true, output: { name: req.name }, changed: false };
      },
      verifyToken: verify,
      principalOf: () => ({ userId: 'usr_001' }),
      readOffice: async (_d, q) => {
        log.push(q ? 'office:in-tx' : 'office:own-read');
        return office;
      },
      joinFirst: o.join ? (name) => name !== 'tasks.create' : undefined,
    });
    return { app, log, seen };
  }

  it('reads the office and runs the first call in one transaction, then runs the others alone', async () => {
    const h = harness({ join: true });
    const response = await post(h.app, [
      { i: 0, name: 'projects.get', input: { id: 'prj_001' } },
      { i: 1, name: 'users.list', input: {} },
    ]);
    const body = (await response.json()) as WireResponse;
    expect(body.results.map((r) => [r.i, r.ok])).toEqual([[0, true], [1, true]]);
    expect(h.seen).toEqual([{ name: 'projects.get', open: true }, { name: 'users.list', open: false }]);
    expect(h.log).toEqual(['begin:read', 'office:in-tx', 'call:projects.get', 'commit', 'call:users.list']);
  });

  it('keeps the old path when the batch does not join: the office has a read of its own', async () => {
    const h = harness({ join: false });
    await post(h.app, [{ i: 0, name: 'projects.get', input: { id: 'prj_001' } }]);
    expect(h.seen).toEqual([{ name: 'projects.get', open: false }]);
    expect(h.log).toEqual(['office:own-read', 'call:projects.get']);
  });

  it('does not join when the first call is not a plain read', async () => {
    const h = harness({ join: true });
    await post(h.app, [
      { i: 0, name: 'tasks.create', input: { title: 'A' } },
      { i: 1, name: 'projects.get', input: { id: 'prj_001' } },
    ]);
    expect(h.seen.map((s) => s.open)).toEqual([false, false]);
    expect(h.log[0]).toBe('office:own-read');
  });

  it('rolls the transaction back after a failed first call and still runs the others', async () => {
    const h = harness({ join: true });
    const response = await post(h.app, [
      { i: 0, name: 'tasks.bad', input: {} },
      { i: 1, name: 'users.list', input: {} },
    ]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as WireResponse;
    expect(body.results[0]).toMatchObject({ i: 0, ok: false, error: { code: 'invalid_input' } });
    expect(body.results[1]).toMatchObject({ i: 1, ok: true });
    expect(h.log).toEqual(['begin:read', 'office:in-tx', 'call:tasks.bad', 'rollback', 'call:users.list']);
  });

  it('answers a failed office read as before: no call runs and the answer is an error', async () => {
    const log: Log = [];
    const app = apiApp(fakeDeps({ db: recordingDb(log) }), {
      runCall: async () => {
        throw new Error('no call must run');
      },
      verifyToken: verify,
      principalOf: () => ({ userId: 'usr_001' }),
      readOffice: async () => {
        throw new Error('db host 10.0.0.1 refused');
      },
      joinFirst: () => true,
    });
    const response = await post(app, [{ i: 0, name: 'projects.get', input: { id: 'prj_001' } }]);
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('10.0.0.1');
    expect(log).toEqual(['begin:read', 'rollback']);
  });
});

describe('the real runCall inside the open transaction (SV-5)', () => {
  let seed: State;
  beforeAll(async () => {
    seed = await buildSeed('2026-10-04', async () => undefined);
  });

  function realApp(join: boolean) {
    const mem = memoryData(seed);
    const log: Log = [];
    const data = mem.data();
    const app = apiApp(fakeDeps({ db: recordingDb(log) }), {
      runCall: createRunCall({ data: () => data }),
      verifyToken: verify,
      principalOf: () => ({ userId: 'usr_001' }),
      readOffice: async () => data.office(),
      joinFirst: join ? joinsFirstRead : undefined,
    });
    return { app, log };
  }

  const calls = [
    { i: 0, name: 'tasks.get', input: { id: 'tsk_001' } },
    { i: 1, name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Roof plan, revised' } } },
    { i: 2, name: 'tasks.get', input: { id: 'tsk_001' } },
  ];

  it('gives the same answers joined and not joined, and a read after a write sees the write (FET-3)', async () => {
    const joined = realApp(true);
    const plain = realApp(false);
    const a = (await (await post(joined.app, calls)).json()) as WireResponse;
    const b = (await (await post(plain.app, calls)).json()) as WireResponse;
    // A story id and a signal id are random: the two runs make two different ones.
    const same = (results: WireResponse['results']) =>
      JSON.parse(JSON.stringify(results).replace(/sty_[a-z0-9]+/g, 'sty_x').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'uuid'));
    expect(same(a.results)).toEqual(same(b.results));
    expect(a.results.every((r) => r.ok)).toBe(true);
    const titleOf = (entry: WireResponse['results'][number]) => (entry.ok ? JSON.stringify(entry.output) : '');
    expect(titleOf(a.results[0])).not.toContain('Roof plan, revised');
    expect(titleOf(a.results[2])).toContain('Roof plan, revised');
    // The joined batch ran its first read inside the sign-in transaction only.
    expect(joined.log).toEqual(['begin:read', 'commit']);
    expect(plain.log).toEqual([]);
  });

  it('refuses a call that cannot join: a write, a server call, an unknown name', () => {
    expect(joinsFirstRead('tasks.get')).toBe(true);
    expect(joinsFirstRead('tasks.update')).toBe(false);
    expect(joinsFirstRead('files.link')).toBe(false);
    expect(joinsFirstRead('no.such.call')).toBe(false);
  });

  it('a call that cannot join fails inside runCall instead of opening a second transaction', async () => {
    const mem = memoryData(seed);
    const run = createRunCall({ data: () => mem.data() });
    const result = await run(fakeDeps({ db: recordingDb([]) }), {
      principal: { userId: 'usr_001' },
      name: 'tasks.update',
      input: { id: 'tsk_001', patch: { title: 'X' } },
      batch: { storyRefs: new Map(), office: await mem.data().office(), overviewCalls: 0 },
      open: { q: (async () => []) as unknown as Query },
    });
    expect(result.ok).toBe(false);
  });
});
