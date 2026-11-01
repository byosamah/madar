import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runInHost, type After } from '../core/after';
import { runCall } from '../core/runCall';
import { readOffice, clearOfficeCaches } from '../data/officeCache';
import { newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * The office copy with the real pgDb, as madar_server, on the local stack (tsk_496): the writer starts through Db.detached, so its
 * statement runs on its own connection after the transaction of the request, also when that transaction is a write that holds the
 * office lock. A first cold request writes the copy, a second cold request reads it, and a write between them arrives as a delta.
 */

describe('the office copy through pgDb and runCall, as madar_server', () => {
  let office: ItOffice;

  beforeAll(async () => {
    office = await startOffice('copy');
  }, 60_000);

  afterAll(async () => {
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

  it('a first cold read writes the copy through the real pgDb, and a second cold read gives the office of a full read', async () => {
    expect(await copyVersion()).toBeUndefined();
    const first = await request(true, (deps) => readOffice(deps));
    expect(first.writes).toBe(1);
    expect(first.deps.logs.filter((line) => line.level === 'warn')).toEqual([]);
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
    expect(wrote.deps.logs.filter((line) => line.level === 'warn')).toEqual([]);
    // The copy is the office before the write; the write raised the version and went in as one row above it.
    expect(Number(await copyVersion())).toBeLessThan(Number(await metaVersion()));
    const merged = await request(true, (deps) => readOffice(deps));
    const full = await request(false, (deps) => readOffice(deps));
    expect(Object.values(merged.result.lists.clients).map((client) => client.name)).toContain('Client after the copy');
    expect(JSON.stringify(merged.result.lists)).toBe(JSON.stringify(full.result.lists));
    expect(merged.result.version).toBe(Number(await metaVersion()));
  });
});
