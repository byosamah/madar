import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInHost, type After } from '../core/after';
import { runCall } from '../core/runCall';
import { apiApp } from '../http/app';
import { triggers } from '../jobs/steps/triggers';
import { mcpApp } from '../mcp/app';
import { readOffice, clearOfficeCaches } from '../data/officeCache';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * The office copy with the real pgDb, as madar_server, on the local stack (tsk_496): the writer uses Db.statementApart, so its statement
 * runs on its own connection after the transaction of the request, also when that transaction is a write that holds the office lock.
 *
 * The first build used AsyncLocalStorage.exit to leave the transaction context. It worked on Node and failed on Supabase Edge Functions,
 * where `exit` clears the store only for the first synchronous part (probe on the local edge runtime, 2026-11-02: [null, "tx"] after the
 * first await). So the test copy logged "db.statement runs on its own connection" at each run of the job and wrote no copy. These
 * tests make `exit` useless (it only calls the function), as the edge runtime has it, and then run the paths of the hosts: a read of
 * its own, a write call, the job step triggers, the joined first read of the batch and the MCP app.
 */

describe('the office copy through pgDb and the paths of the hosts, as madar_server', () => {
  let office: ItOffice;
  let restoreExit: (() => void) | undefined;

  beforeAll(async () => {
    // The edge runtime keeps the store after the first await, so `exit` helps nothing there.
    const proto = AsyncLocalStorage.prototype as unknown as { exit: (callback: (...args: unknown[]) => unknown, ...args: unknown[]) => unknown };
    const original = proto.exit;
    proto.exit = function exitThatKeepsTheStore(callback, ...args) {
      return callback(...args);
    };
    restoreExit = () => {
      proto.exit = original;
    };
    office = await startOffice('copy');
  }, 60_000);

  afterAll(async () => {
    restoreExit?.();
    clearOfficeCaches();
    await office?.close();
  });

  /** One request: a new worker (a cold cache), the host with its "after", and the work that it handed to "after". */
  async function request<T>(copy: boolean, work: (deps: ReturnType<ItOffice['isolate']>) => Promise<T>) {
    clearOfficeCaches();
    const deps = office.isolate();
    deps.config.officeCopy = copy;
    const pending: Promise<unknown>[] = [];
    const after: After = (job) => void pending.push(job);
    const result = await runInHost({ host: 'supabase', after }, () => work(deps));
    await Promise.all(pending);
    return { result, deps, writes: pending.length };
  }

  const copyVersion = async () => (await office.sql<{ version: string }>('select version from office_copy'))[0]?.version;
  const metaVersion = async () => (await office.sql<{ version: string }>('select version from office_meta'))[0].version;
  const warnings = (deps: { logs: { level: string }[] }) => deps.logs.filter((line) => line.level === 'warn');

  /** The host path writes a copy of the version it read, with no warning. */
  async function expectCopyFrom<T>(work: (deps: ReturnType<ItOffice['isolate']>) => Promise<T>) {
    await office.sql('truncate office_copy');
    const run = await request(true, work);
    expect(warnings(run.deps)).toEqual([]);
    expect(run.writes).toBeGreaterThanOrEqual(1);
    expect(await copyVersion()).toBeDefined();
    return run;
  }

  it('a first cold read writes the copy through the real pgDb, and a second cold read gives the office of a full read', async () => {
    expect(await copyVersion()).toBeUndefined();
    const first = await request(true, (deps) => readOffice(deps));
    expect(first.writes).toBe(1);
    expect(warnings(first.deps)).toEqual([]);
    expect(await copyVersion()).toBe(await metaVersion());
    const second = await request(true, (deps) => readOffice(deps));
    const full = await request(false, (deps) => readOffice(deps));
    expect(second.writes).toBe(0);
    expect(JSON.stringify(second.result.lists)).toBe(JSON.stringify(full.result.lists));
    expect(second.result.version).toBe(full.result.version);
  });

  it('a write request that starts cold does not wait for its own copy write, and the next cold read merges the change as a delta', async () => {
    await office.sql('truncate office_copy');
    const wrote = await request(true, (deps) =>
      runCall(deps, { principal: { userId: 'usr_001' }, name: 'clients.create', input: { name: 'Client after the copy' }, batch: newBatch() }),
    );
    expect(wrote.result.ok).toBe(true);
    expect(wrote.writes).toBe(1);
    expect(warnings(wrote.deps)).toEqual([]);
    // The copy is the office before the write; the write raised the version and went in as one row above it.
    expect(Number(await copyVersion())).toBeLessThan(Number(await metaVersion()));
    const merged = await request(true, (deps) => readOffice(deps));
    const full = await request(false, (deps) => readOffice(deps));
    expect(Object.values(merged.result.lists.clients).map((client) => client.name)).toContain('Client after the copy');
    expect(JSON.stringify(merged.result.lists)).toBe(JSON.stringify(full.result.lists));
    expect(merged.result.version).toBe(Number(await metaVersion()));
  });

  it('the job step triggers reads the office inside its write transaction and still writes the copy', async () => {
    await expectCopyFrom((deps) => triggers(deps, new Date('2026-10-04T08:15:00Z')));
  });

  it('the joined first read of the batch (the sign-in read and the first call share one transaction) writes the copy', async () => {
    await expectCopyFrom(async (deps) => {
      const app = apiApp(deps, { verifyToken: async () => ({ authUserId: 'auth-it' }), principalOf: () => ({ userId: 'usr_001' }) });
      const response = await app.fetch(new Request('http://127.0.0.1/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'clients.list', input: {} }] }),
      }));
      const body = (await response.json()) as { results?: { ok: boolean }[]; entries?: { ok: boolean }[] };
      expect((body.results ?? body.entries)?.[0]?.ok, JSON.stringify(body)).toBe(true);
    });
  });

  it('a batch that starts with a write (the office read after the lock) writes the copy', async () => {
    await expectCopyFrom(async (deps) => {
      const app = apiApp(deps, { verifyToken: async () => ({ authUserId: 'auth-it' }), principalOf: () => ({ userId: 'usr_001' }) });
      const response = await app.fetch(new Request('http://127.0.0.1/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
        body: JSON.stringify({ v: 1, calls: [{ i: 0, name: 'clients.create', input: { name: 'Written first' } }] }),
      }));
      expect(response.status).toBe(200);
    });
  });

  it('the MCP app reads the office before it reads the body, and writes the copy', async () => {
    await expectCopyFrom(async (deps) => {
      const app = mcpApp(deps, {
        stateKey: 'copy-it-state-key-of-at-least-32-bytes',
        checkToken: async () => ({ token: 't', authUserId: 'auth-it', clientId: 'cli-it', sessionId: 'ses-it' }),
        agentOf: async () => ({ principal: { userId: 'usr_001' }, ownerId: 'usr_001', linked: false }),
        limit: async () => ({ ok: true }) as never,
      });
      const response = await app.fetch(new Request('http://127.0.0.1/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer test' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      }));
      expect(response.status).toBe(200);
    });
  });
});
