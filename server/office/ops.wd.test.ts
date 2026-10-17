import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { startLive } from './test/live/harness';

const TODAY = '2026-10-04';

describe('the office ops on local workerd (server/office/ops.wd.test.ts)', () => {
  let live: Awaited<ReturnType<typeof startLive>>;

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

  it('answers a peek with the test tools on, and refuses the export with no secret', async () => {
    expect(await live.ops('peek', { text: "select id from users where id = 'usr_001'", values: [] })).toEqual([{ id: 'usr_001' }]);
    const response = await live.worker().fetch('/api/office/export', { method: 'POST', body: '{"step":"begin"}' });
    expect(response.status).toBe(401);
  });
});
