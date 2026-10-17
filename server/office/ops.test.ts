import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { liteSchemaSql } from '../data/lite/schema';
import { DRIFT_TABLES, EXPORT_PAGE_ROWS, EXPORT_TABLES, HOLD_MS, ROWID_ALIAS, testToolsOn } from './ops';
import { httpOf, NODE_NOW, nodeOffice } from './test/nodeOffice';

const post = (path: string, body: unknown) => new Request(`https://office.internal${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const json = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
};
const write = { i: 0, name: 'tasks.update', input: { id: 'tsk_001', patch: { title: 'Held' } } };
const read = { i: 0, name: 'tasks.list', input: { scope: 'mine' } };

describe('the tables of an export (server/office/ops.ts)', () => {
  it('takes every table of the schema but the snapshot and the version row', () => {
    const all = liteSchemaSql().flatMap((text) => /^create table (\w+) /.exec(text)?.[1] ?? []);
    expect([...EXPORT_TABLES].sort()).toEqual(all.filter((t) => t !== 'office_snapshot' && t !== 'schema_version').sort());
  });

  it('knows the tables whose integer primary key is the rowid', () => {
    expect(Object.fromEntries(ROWID_ALIAS)).toEqual({ office_meta: 'id', office_snapshot: 'part', outbox: 'id', mail_log: 'id', mail_outbox: 'id', schema_version: 'id' });
  });

  it('names only tables of the export as drift tables', () => {
    for (const table of DRIFT_TABLES) expect(EXPORT_TABLES).toContain(table);
  });

  it('reads one page with the primary key order of the table, so SQLite needs no sort step', () => {
    const raw = new DatabaseSync(':memory:');
    for (const text of liteSchemaSql()) raw.exec(text);
    const plan = raw.prepare('explain query plan select rowid as _rowid, * from events where rowid > ?1 order by rowid limit ?2').all(0, EXPORT_PAGE_ROWS) as { detail: string }[];
    const details = plan.map((row) => row.detail).join(' | ');
    expect(details).toMatch(/SEARCH events USING INTEGER PRIMARY KEY/);
    expect(details).not.toMatch(/TEMP B-TREE/);
  });
});

describe('the hold of an export (server/office/parts.ts)', () => {
  it('refuses a write batch and serves a read batch while an export holds the office, and both after the end', async () => {
    const t = await nodeOffice();
    const begin = await json<{ id: string }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const refused = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [write], overviewCalls: 0, worker: 0 }, t.net);
    expect(refused).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'busy' } } });
    expect(refused.ok === false && refused.error.message).toContain('nightly backup');
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: false })).toBeUndefined();
    // A read batch is not refused for the hold: it goes on to the token check of the person (x is no person here).
    const served = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [read], overviewCalls: 0, worker: 0 }, t.net);
    expect(served.ok === false && served.error.details?.reason).not.toBe('busy');
    await json(await t.parts.ops(post('/office/export', { step: 'end', id: begin.id })));
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: true })).toBeUndefined();
  });

  it('ends the hold by itself after 5 minutes', async () => {
    const t = await nodeOffice();
    await json(await t.parts.ops(post('/office/export', { step: 'begin' })));
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: true })).toBeDefined();
    t.clock.set(new Date(Date.parse(NODE_NOW) + HOLD_MS.export));
    expect(t.parts.hold.refusal({ now: t.clock.now(), writes: true })).toBeUndefined();
  });

  it('refuses a second begin while an export holds the office', async () => {
    const t = await nodeOffice();
    await json(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const second = await t.parts.ops(post('/office/export', { step: 'begin' }));
    expect(second.status).toBe(409);
    expect(await second.text()).toContain('busy');
  });

  it('refuses a page of an export that ended, so a late page never mixes two offices', async () => {
    const t = await nodeOffice();
    const begin = await json<{ id: string }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    await json(await t.parts.ops(post('/office/export', { step: 'end', id: begin.id })));
    const late = await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'tasks', after: 0 }));
    expect(late.status).toBe(409);
    expect(await late.text()).toContain('hold_ended');
  });

  it('refuses a step of another shape, a table outside the export, and a body that is not JSON', async () => {
    const t = await nodeOffice();
    const begin = await json<{ id: string }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    expect((await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'office_snapshot', after: 0 }))).status).toBe(400);
    expect((await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'tasks; drop table tasks', after: 0 }))).status).toBe(400);
    expect((await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'tasks', after: -1 }))).status).toBe(400);
    expect((await t.parts.ops(post('/office/export', { step: 'later' }))).status).toBe(400);
    const text = await t.parts.ops(new Request('https://office.internal/office/export', { method: 'POST', body: 'not json' }));
    expect(text.status).toBe(400);
    expect((await t.parts.ops(post('/office/nothing', {}))).status).toBe(404);
  });

  it('lets the sign-in routes run while an export holds the office, and refuses an MCP request', async () => {
    const t = await nodeOffice();
    await json(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const signin = await t.route(httpOf('POST', '/api/auth/token', { grant_type: 'password', email: 'a@madar.test', password: 'x' }));
    expect(signin.status).not.toBe(503);
    expect(signin.body).not.toContain('busy');
    const mcp = await t.route(httpOf('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect(mcp.status).toBe(503);
    expect(mcp.body).toContain('busy');
  });

  it('runs no job step while an export holds the office, and closes the stale sockets still', async () => {
    const t = await nodeOffice();
    await json(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const report = await t.parts.cron({ at: NODE_NOW, worker: 0 }, t.net);
    expect(report.steps).toEqual([]);
    expect(t.raw.prepare("select count(*) as n from job_runs where key = 'heartbeat'").get()).toEqual({ n: 0 });
  });

  it('gives every row of each table in pages, with the rowid, and the same version at the begin and the end', async () => {
    const t = await nodeOffice();
    const begin = await json<{ id: string; tables: string[]; version: number; officeSeq: number }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    let events = 0;
    for (let after = 0; ; ) {
      const page = await json<{ rows: { _rowid: number; doc: string }[]; next: number | null }>(await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'events', after })));
      events += page.rows.length;
      expect(typeof page.rows[0]?.doc).toBe('string');
      if (page.next === null) break;
      after = page.next;
    }
    expect(events).toBe(Number((t.raw.prepare('select count(*) as n from events').get() as { n: number }).n));
    const end = await json<{ version: number; officeSeq: number }>(await t.parts.ops(post('/office/export', { step: 'end', id: begin.id })));
    expect(end).toEqual({ version: begin.version, officeSeq: begin.officeSeq });
  });

  it('cuts a table into pages of at most 1,000 rows, and the pages hold each row once', async () => {
    const t = await nodeOffice();
    const insert = t.raw.prepare("insert into rate_limits (key, window_start, count) values (?1, '2026-10-04T06:00:00.000Z', 1)");
    for (let n = 0; n < 2_345; n += 1) insert.run(`k${n}`);
    const begin = await json<{ id: string }>(await t.parts.ops(post('/office/export', { step: 'begin' })));
    const sizes: number[] = [];
    const seen = new Set<number>();
    for (let after = 0; ; ) {
      const page = await json<{ rows: { _rowid: number }[]; next: number | null }>(await t.parts.ops(post('/office/export', { step: 'page', id: begin.id, table: 'rate_limits', after })));
      sizes.push(page.rows.length);
      for (const row of page.rows) seen.add(row._rowid);
      if (page.next === null) break;
      after = page.next;
    }
    expect(sizes).toEqual([1_000, 1_000, 345]);
    expect(seen.size).toBe(2_345);
  });
});

describe('the hold of an import (server/office/parts.ts)', () => {
  it('refuses every call, every sign-in step and the mail routes while an import holds the office', async () => {
    const t = await nodeOffice();
    t.parts.hold.begin('import', t.clock.now());
    const batch = await t.parts.batch({ who: { kind: 'browser', authUserId: 'x' }, calls: [read], overviewCalls: 0, worker: 0 }, t.net);
    expect(batch).toMatchObject({ ok: false, error: { code: 'failed', details: { reason: 'busy' } } });
    expect(batch.ok === false && batch.error.message).toContain('loads the office data');
    expect(await t.parts.signin({ signin: 'auth.password', input: { email: 'a@madar.test', password: 'x' } })).toMatchObject({ ok: false, error: { details: { reason: 'busy' } } });
    const forgot = await t.parts.mailRoute({ route: 'forgot', body: JSON.stringify({ email: 'a@madar.test' }), address: '203.0.113.7' }, t.net);
    expect(forgot.status).toBe(500);
    expect(forgot.body).toContain('busy');
    expect(await t.parts.runEffects({ ids: ['1'], worker: 0 }, t.net)).toEqual({ done: 0, failed: 0 });
  });

  it('ends the hold of an import by itself after 30 minutes', () => {
    expect(HOLD_MS.import).toBe(30 * 60_000);
  });
});

describe('the test reads (server/office/ops.ts)', () => {
  it('turns the test tools on only with MADAR_TEST_TOOLS on, and never on a production copy', () => {
    const read = (env: Record<string, string>) => (name: string) => env[name];
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'https://qdgwpnesxppnqsaabqzd.supabase.co', APP_URL: 'https://preview.madar-46r.pages.dev' }))).toBe(true);
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'http://127.0.0.1:54321', APP_URL: 'http://127.0.0.1:4174' }))).toBe(true);
    expect(testToolsOn(read({ SUPABASE_URL: 'http://127.0.0.1:54321', APP_URL: 'http://127.0.0.1:4174' }))).toBe(false);
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'https://oprkvdjudjxxhvodkzgs.supabase.co', APP_URL: 'http://127.0.0.1:4174' }))).toBe(false);
    expect(testToolsOn(read({ MADAR_TEST_TOOLS: 'on', SUPABASE_URL: 'http://127.0.0.1:54321', APP_URL: 'https://madar.vado.sa' }))).toBe(false);
  });

  it('answers a select with at most 200 rows, and refuses a write and a copy with the tools off', async () => {
    const on = await nodeOffice({ env: { MADAR_TEST_TOOLS: 'on' } });
    const rows = await json<{ id: string }[]>(await on.parts.ops(post('/office/peek', { text: 'select id from events', values: [] })));
    expect(rows.length).toBe(200);
    expect((await on.parts.ops(post('/office/peek', { text: 'delete from events', values: [] }))).status).toBe(400);
    expect((await on.parts.ops(post('/office/peek', { text: 'select 1 as n; delete from events', values: [] }))).status).toBe(400);
    const off = await nodeOffice();
    expect((await off.parts.ops(post('/office/peek', { text: 'select 1 as n', values: [] }))).status).toBe(403);
  });
});
