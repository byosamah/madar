import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { importOffice } from '../../scripts/office/import';
import { opsOf } from '../../scripts/office/ops';
import { seedSource } from '../../scripts/office/seed';
import { stateSource } from '../../scripts/office/source';
import { localPasswords } from '../../tests/e2e-deploy/local';
import { startLive } from './test/live/harness';

const TODAY = '2026-10-04';

type Live = Awaited<ReturnType<typeof startLive>>;
/** The init of the fetch of the test harness (the Workers form of RequestInit). */
type WorkerInit = Parameters<ReturnType<Live['worker']>['fetch']>[1];

describe('the office ops on local workerd (server/office/ops.wd.test.ts)', () => {
  let live: Live;

  beforeAll(async () => {
    live = await startLive();
    await live.fresh(await buildSeed(TODAY, async () => undefined));
  }, 120_000);

  afterAll(async () => {
    await live?.server.close();
  });

  it('exports every task of the office through the Worker, and holds the writes of a batch meanwhile', async () => {
    const begin = (await live.ops('export', { step: 'begin' })) as { id: string; tables: string[] };
    expect(begin.tables).toContain('tasks');
    const held = await live.batch('usr_001', [{ name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Held' } } }]);
    expect(held.body.error?.details?.reason).toBe('busy');
    const page = (await live.ops('export', { step: 'page', id: begin.id, table: 'tasks', after: 0 })) as { rows: unknown[]; next: number | null };
    expect(page.rows.length).toBe((await live.rows('select id from tasks')).length);
    await live.ops('export', { step: 'end', id: begin.id });
    const after = await live.batch('usr_001', [{ name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Free' } } }]);
    expect(after.status).toBe(200);
  });

  it('reads another object by its rehearsal name, and drops it, and never drops the office of the copy', async () => {
    const other = (await live.ops('export', { step: 'begin' }, { office: 'rehearsal-20261004' })) as { id: string; officeSeq: number };
    expect(other.officeSeq).toBe(0);
    await live.ops('export', { step: 'end', id: other.id }, { office: 'rehearsal-20261004' });
    expect(await live.ops('drop', {}, { office: 'rehearsal-20261004' })).toEqual({ ok: true });
    await expect(live.ops('drop', {})).rejects.toThrow(/403/);
    expect((await live.rows<{ id: string }>("select id from users where id = 'usr_001'")).length).toBe(1);
  });

  it('an import into ent_002 never writes to the object of ent_001, and makes the identity row of ent_002', async () => {
    await live.fresh(await buildSeed(TODAY, async () => undefined));
    // The platform lists ent_002 first (the op of the Mac), then the import names it. An unlisted id is refused.
    await expect(live.ops('import', { step: 'begin', mode: 'replace' }, { office: 'ent_002' })).rejects.toThrow(/403/);
    await live.ops('platform-register', {
      row: {
        id: 'ent_002', address: 'globex', name: 'Globex', nameAr: 'جلوبكس', state: 'active', limits: { people: null, storageBytes: null },
        createdAt: '2026-11-08T08:00:00.000Z', firstAdmin: { name: 'Hana', email: 'hana@globex.test' },
      },
      emails: ['hana@globex.test'],
    });
    const before = await live.rows<{ n: number }>('select count(*) as n from tasks');
    const ops = opsOf({ base: 'http://office.test', header: 'x-madar-ops-secret', secret: 'test-ops-secret', office: 'ent_002', fetch: ((url: string, init?: RequestInit) => {
      const target = new URL(url);
      return live.worker().fetch(`${target.pathname}${target.search}`, init as WorkerInit);
    }) as unknown as typeof fetch });
    const small = await buildSeed(TODAY, async () => undefined);
    await importOffice(ops, stateSource(small), { mode: 'replace' });
    expect(await live.rows('select id from enterprise', [], { ent: 'ent_002' })).toEqual([{ id: 'ent_002' }]);
    expect((await live.rows<{ n: number }>('select count(*) as n from tasks', [], { ent: 'ent_002' }))[0].n).toBe(Object.keys(small.tasks).length);
    // The object of ent_001 holds what it held, with its own identity.
    expect(await live.rows<{ n: number }>('select count(*) as n from tasks')).toEqual(before);
    expect(await live.rows('select id from enterprise')).toEqual([{ id: 'ent_001' }]);
    expect(await live.platform('resolveEmail', { email: 'hana@globex.test' })).toEqual({ ent: 'ent_002' });
  }, 120_000);

  it('answers a peek with the test tools on, and refuses the export with no secret', async () => {
    expect(await live.ops('peek', { text: "select id from users where id = 'usr_001'", values: [] })).toEqual([{ id: 'usr_001' }]);
    const response = await live.worker().fetch('/api/office/export', { method: 'POST', body: '{"step":"begin"}' });
    expect(response.status).toBe(401);
  });

  it('writes about 7.5 rows for each record in a seed, plus one row for each row that the replace deletes', async () => {
    const ops = opsOf({ base: 'http://office.test', header: 'x-madar-ops-secret', secret: 'test-ops-secret', fetch: ((url: string, init?: RequestInit) => {
      const target = new URL(url);
      return live.worker().fetch(`${target.pathname}${target.search}`, init as WorkerInit);
    }) as unknown as typeof fetch });
    const { source } = await seedSource({ now: new Date('2026-10-04T06:00:00Z'), passwords: localPasswords() });
    await importOffice(ops, source, { mode: 'replace' });
    const [before] = await live.rows<{ rows_written: number }>('select sum(rows_written) as rows_written from usage_day');
    await importOffice(ops, source, { mode: 'replace' });
    const [after] = await live.rows<{ rows_written: number }>('select sum(rows_written) as rows_written from usage_day');
    const seed = Number(after.rows_written) - Number(before.rows_written);
    console.info(`one seed: ${source.records} records, ${seed} rows written`);
    expect(seed).toBeGreaterThan(source.records);
    expect(seed).toBeLessThanOrEqual(Math.ceil(source.records * 7.5) * 2 + 2_000);
  }, 300_000);
});
