import { describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { readLiteOffice } from '../data/lite/office';
import { liteLoadWhole } from '../data/lite/whole';
import { rowOf } from '../data/rows';
import { TABLES, rowsOf } from '../data/tables';
import { IMPORT_PART_ROWS, IMPORT_SERVER_SKIP, IMPORT_SERVER_TABLES, ServerRowsShape, type GoogleConnectionRow, type ImportStep, type ServerRows } from './import';
import { SERVER_TABLES } from '../data/tables';
import { PG_SERVER_SQL } from '../../scripts/office/source';
import { NODE_TODAY, nodeOffice } from './test/nodeOffice';
import { ENT_VADO } from '../enterprise/ids';

const post = async <T,>(t: Awaited<ReturnType<typeof nodeOffice>>, body: ImportStep | Record<string, unknown>): Promise<T> => {
  const response = await t.parts.ops(new Request('https://office.internal/office/import', { method: 'POST', body: JSON.stringify(body) }));
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  return JSON.parse(text) as T;
};

function serverOf(state: State, more: Partial<ServerRows> = {}): ServerRows {
  return {
    counters: Object.entries(state.counters).map(([prefix, n]) => ({ prefix, n })),
    officeSeq: 3,
    version: 7,
    personSeq: [], mailLog: [], usageMonth: [], usageWarnings: [], jobRuns: [],
    googleConnections: [], googleEvents: [], googleCalendars: [], daftraClients: [], daftraInvoices: [],
    ...more,
  };
}

async function importState(t: Awaited<ReturnType<typeof nodeOffice>>, state: State, server: ServerRows = serverOf(state)) {
  const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'empty' });
  for (const spec of TABLES) {
    const rows = rowsOf(state, spec).map((row) => rowOf(spec, row.doc, state));
    for (let at = 0; at < rows.length; at += 50) await post(t, { step: 'part', id, table: spec.table, rows: rows.slice(at, at + 50) });
  }
  return post<{ version: number; officeSeq: number }>(t, { step: 'finish', id, server, signin: [] });
}

describe('the import steps of the office object (server/office/import.ts)', () => {
  it('imports the sample office in parts into an empty object: the records come back equal, and the lists come from the tables', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const out = await importState(t, seed);
    const back = await t.parts.db.tx('read', (q) => liteLoadWhole(q));
    for (const spec of TABLES) expect(rowsOf(back, spec).length, spec.table).toBe(rowsOf(seed, spec).length);
    expect(back.tasks.tsk_001).toEqual(seed.tasks.tsk_001);
    expect(out.officeSeq).toBe(serverOf(seed).officeSeq);
    const office = await t.parts.db.tx('read', (q) => readLiteOffice(t.parts.db, q));
    expect(Object.keys(office.lists.users).sort()).toEqual(Object.keys(seed.users).sort());
  });

  it('refuses mode empty on an office that holds records', async () => {
    const t = await nodeOffice();
    await expect(post(t, { step: 'begin', mode: 'empty' })).rejects.toThrow(/409.*holds records already/);
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('skips a part whose first row is there already (the answer of the part got lost, and the client sent it again)', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'empty' });
    const spec = TABLES.find((s) => s.table === 'tasks')!;
    const rows = rowsOf(seed, spec).map((row) => rowOf(spec, row.doc, seed)).slice(0, 10);
    expect(await post(t, { step: 'part', id, table: 'tasks', rows })).toEqual({ written: 10, skipped: false });
    expect(await post(t, { step: 'part', id, table: 'tasks', rows })).toEqual({ written: 0, skipped: true });
    expect(t.raw.prepare('select count(*) as n from tasks').get()).toEqual({ n: 10 });
  });

  it('refuses every batch while an import holds the office, also a read, and serves them after the finish', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'empty' });
    const read = await t.parts.batch({ ent: ENT_VADO, who: { kind: 'browser', authUserId: 'x' }, calls: [{ i: 0, name: 'tasks.list', input: { scope: 'mine' } }], overviewCalls: 0, worker: 0 }, t.net);
    expect(read.ok === false && read.error.message).toContain('loads the office data');
    await post(t, { step: 'abort', id });
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
    await importState(t, seed);
    expect(t.parts.hold.active(t.clock.now())).toBeUndefined();
  });

  it('copies the server rows: counters, office_seq, person numbers, the mail log of the day, the usage month and the job runs', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    await importState(t, seed, serverOf(seed, {
      personSeq: [{ user_id: 'usr_001', seq: 41 }],
      mailLog: [{ utc_day: NODE_TODAY, kind: 'notice', user_id: 'usr_002', ref: 'notice:ntf_001', resend_id: null, created_at: '2026-10-04T05:00:00.000Z' }],
      usageMonth: [{ month: '2026-10', calls: 1200, bytes_read: 5000, backup_bytes: null, signals_failed: 0, signals_failed_at: null }],
      usageWarnings: [{ month: '2026-10', metric: 'emailsToday', sent_at: '2026-10-04T05:00:00.000Z' }],
      jobRuns: [{ key: `summary:${NODE_TODAY}`, done_at: '2026-10-04T04:31:00.000Z' }],
    }));
    expect(t.raw.prepare('select seq from person_seq where user_id = ?').get('usr_001')).toEqual({ seq: 41 });
    expect(t.raw.prepare('select count(*) as n from mail_log').get()).toEqual({ n: 1 });
    expect(t.raw.prepare("select calls from usage_month where month = '2026-10'").get()).toEqual({ calls: 1200 });
    expect(t.raw.prepare('select key from job_runs').all()).toEqual([{ key: `summary:${NODE_TODAY}` }]);
    const [prefix, n] = Object.entries(seed.counters)[0];
    expect(t.raw.prepare('select n from counters where prefix = ?').get(prefix)).toEqual({ n });
    // The day meter keeps the requests of the import itself: the rows pin of the round trip reads it.
    expect(Number((t.raw.prepare("select requests from usage_day where day = ?").get(NODE_TODAY) as { requests: number }).requests)).toBeGreaterThan(0);
  });

  it('sends no second morning summary after an import that holds the summary row of the day', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const withRow = await nodeOffice({ seed: false, at: '2026-10-04T06:05:00.000Z' });
    await importState(withRow, seed, serverOf(seed, { jobRuns: [{ key: `summary:${NODE_TODAY}`, done_at: '2026-10-04T04:31:00.000Z' }] }));
    await withRow.parts.cron({ ent: ENT_VADO, at: '2026-10-04T06:05:00.000Z', worker: 0 }, withRow.net);
    expect(withRow.raw.prepare("select count(*) as n from mail_outbox where tag = 'summary'").get()).toEqual({ n: 0 });
    // The control: with no summary row, the same run mails the summary.
    const without = await nodeOffice({ seed: false, at: '2026-10-04T06:05:00.000Z' });
    await importState(without, seed);
    await without.parts.cron({ ent: ENT_VADO, at: '2026-10-04T06:05:00.000Z', worker: 0 }, without.net);
    expect(Number((without.raw.prepare("select count(*) as n from mail_outbox where tag = 'summary'").get() as { n: number }).n)).toBeGreaterThan(0);
  });

  it('replaces the office only with the test tools on, wipes every record and sign-in row, and keeps the day meters', async () => {
    const off = await nodeOffice();
    await expect(post(off, { step: 'begin', mode: 'replace' })).rejects.toThrow(/403/);
    const t = await nodeOffice({ env: { MADAR_TEST_TOOLS: 'on' } });
    t.raw.exec("insert into usage_day (day, rows_written) values ('2026-10-04', 500)");
    t.raw.exec("insert into auth_users (id, email) values ('a1', 'x@madar.test')");
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'replace' });
    expect(t.raw.prepare('select count(*) as n from events').get()).toEqual({ n: 0 });
    expect(t.raw.prepare('select count(*) as n from auth_users').get()).toEqual({ n: 0 });
    expect(t.raw.prepare('select rows_written from usage_day').get()).toEqual({ rows_written: 500 });
    await post(t, { step: 'abort', id });
  });

  it('leaves no old office lists after a replace and an abort: the version rises and the snapshot goes', async () => {
    const t = await nodeOffice({ env: { MADAR_TEST_TOOLS: 'on' } });
    const before = await t.parts.db.tx('read', (q) => readLiteOffice(t.parts.db, q));
    expect(Object.keys(before.lists.users).length).toBeGreaterThan(0);
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'replace' });
    await post(t, { step: 'abort', id });
    const after = await t.parts.db.tx('read', (q) => readLiteOffice(t.parts.db, q));
    expect(after.version).toBeGreaterThan(before.version);
    expect(Object.keys(after.lists.users)).toEqual([]);
    expect(t.raw.prepare('select count(*) as n from office_snapshot').get()).toEqual({ n: 0 });
  });

  it('raises the version also for a source of version 0, so an office list that the object held before never looks current', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    // A read before the import puts the empty office of version 0 into memory.
    const empty = await t.parts.db.tx('read', (q) => readLiteOffice(t.parts.db, q));
    expect(empty.version).toBe(0);
    const out = await importState(t, seed, serverOf(seed, { version: 0 }));
    expect(out.version).toBeGreaterThan(0);
    const office = await t.parts.db.tx('read', (q) => readLiteOffice(t.parts.db, q));
    expect(Object.keys(office.lists.users).sort()).toEqual(Object.keys(seed.users).sort());
  });

  it('refuses a step of another shape, a part over 2,000 rows and a row whose id is not the key of its doc', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    await expect(post(t, { step: 'begin', mode: 'all' })).rejects.toThrow(/^400/);
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'empty' });
    await expect(post(t, { step: 'part', id, table: 'tasks', rows: 'none' })).rejects.toThrow(/^400/);
    await expect(post(t, { step: 'part', id, table: 'office_meta', rows: [] })).rejects.toThrow(/^400.*no records table/);
    const many = Array.from({ length: IMPORT_PART_ROWS + 1 }, (_, i) => ({ id: `tsk_${i}`, doc: { id: `tsk_${i}` }, columns: {} }));
    await expect(post(t, { step: 'part', id, table: 'tasks', rows: many })).rejects.toThrow(/^400.*at most 2000 rows/);
    const spec = TABLES.find((s) => s.table === 'tasks')!;
    const [row] = rowsOf(seed, spec).map((one) => rowOf(spec, one.doc, seed));
    await expect(post(t, { step: 'part', id, table: 'tasks', rows: [{ ...row, id: 'tsk_other' }] })).rejects.toThrow(/^400.*key of its doc/);
    expect(t.raw.prepare('select count(*) as n from tasks').get()).toEqual({ n: 0 });
    await expect(post(t, { step: 'part', id: 'f'.repeat(32), table: 'tasks', rows: [row] })).rejects.toThrow(/^409.*ended/);
    await post(t, { step: 'abort', id });
  });
});

/** The server rows of the Google link, the Daftra link and the push devices (plan E, Task 2b): without them the team connects again. */
const GOOGLE_CONNECTION: GoogleConnectionRow = {
  id: 'gcn_001', user_id: 'usr_002', sealed_token: 'v1.sealed-token-of-hala', calendar_id: 'cal-hala@group.calendar.google.com', state: 'ok',
  connected_at: '2026-10-21T08:00:00.000Z', last_error: null, last_error_at: null, changed_at: '2026-10-22T09:30:00.000Z',
};
const GOOGLE_BROKEN: GoogleConnectionRow = {
  id: 'gcn_002', user_id: 'usr_003', sealed_token: null, calendar_id: null, state: 'broken',
  connected_at: '2026-10-23T08:00:00.000Z', last_error: 'revoked', last_error_at: '2026-10-24T10:00:00.000Z', changed_at: '2026-10-24T10:00:00.000Z',
};
const GOOGLE_EVENT = { user_id: 'usr_002', meeting_id: 'mtg_001', event_id: 'evt-abc123', synced_rev: 4, synced_at: '2026-10-25T07:00:00.000Z' };
const GOOGLE_CALENDAR = { user_id: 'usr_002', calendar_id: 'cal-hala@group.calendar.google.com', changed_at: '2026-10-21T08:00:00.000Z' };
const DAFTRA_CLIENT = { account: 'vado', client_id: 'cli_001', daftra_id: '5521', daftra_name: 'Al Noor Real Estate', matched_by: 'usr_004', matched_at: '2026-10-27T11:00:00.000Z' };
const DAFTRA_INVOICE = {
  account: 'vado', id: '9001', daftra_client_id: '5521', no: '000412', total_halalas: 1_250_000, issued_on: '2026-10-20', created_at: '2026-10-20T06:00:00.000Z',
  payment_status: 2, paid_on: '2026-10-28', draft: false, seen_at: '2026-10-29T05:00:00.000Z',
};
const DAFTRA_DRAFT = {
  account: 'vado', id: '9002', daftra_client_id: '5521', no: '000413', total_halalas: 500, issued_on: '2026-10-21', created_at: '2026-10-21T06:00:00.000Z',
  payment_status: 0, paid_on: null, draft: true, seen_at: '2026-10-29T05:00:00.000Z',
};
const PUSH_DEVICE = {
  id: 'pdv_001', userId: 'usr_002', endpoint: 'https://fcm.googleapis.com/fcm/send/abc-def-123', label: 'iPhone of Hala', createdAt: '2026-10-21T08:00:00.000Z',
  lastPushAt: '2026-10-29T05:00:00.000Z', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
};

describe('the server tables of the import (plan E, Task 2b)', () => {
  it('carries every server table of Postgres that the SQLite schema has, or names a reason to skip it', async () => {
    const t = await nodeOffice({ seed: false });
    const lite = new Set((t.raw.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((row) => row.name));
    const shape = Object.keys(ServerRowsShape.shape);
    const sql = Object.keys(PG_SERVER_SQL);
    for (const table of SERVER_TABLES) {
      const key = IMPORT_SERVER_TABLES[table];
      const reason = IMPORT_SERVER_SKIP[table];
      // One answer for each table: carried or skipped with a reason, never both and never neither.
      expect([table, key !== undefined, reason !== undefined]).toEqual([table, key !== undefined, key === undefined]);
      if (key !== undefined) {
        expect(shape, `${table}: ServerRows has no ${key}`).toContain(key);
        expect(lite.has(table), `${table} is no table of the SQLite schema`).toBe(true);
        if (table !== 'office_meta') expect(sql, `${table}: the read of Postgres has no ${key}`).toContain(key);
      } else {
        expect(reason!.length, `${table}: the reason is empty`).toBeGreaterThan(10);
      }
    }
    // The lists hold no stale name.
    for (const name of [...Object.keys(IMPORT_SERVER_TABLES), ...Object.keys(IMPORT_SERVER_SKIP)]) expect(SERVER_TABLES as readonly string[]).toContain(name);
    for (const name of ['google_connections', 'google_events', 'google_calendars', 'daftra_clients', 'daftra_invoices']) expect(IMPORT_SERVER_TABLES[name]).toBeDefined();
  });

  it('round trip: the Google, Daftra and push rows after the import equal the rows before', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const state: State = { ...seed, pushDevices: { [PUSH_DEVICE.id]: PUSH_DEVICE } };
    const t = await nodeOffice({ seed: false });
    await importState(t, state, serverOf(state, {
      googleConnections: [GOOGLE_CONNECTION, GOOGLE_BROKEN], googleEvents: [GOOGLE_EVENT], googleCalendars: [GOOGLE_CALENDAR],
      daftraClients: [DAFTRA_CLIENT], daftraInvoices: [DAFTRA_INVOICE, DAFTRA_DRAFT],
    }));
    const all = (table: string, order: string) => t.raw.prepare(`select * from ${table} order by ${order}`).all();
    expect(all('google_connections', 'id')).toEqual([GOOGLE_CONNECTION, GOOGLE_BROKEN]);
    expect(all('google_events', 'user_id, meeting_id')).toEqual([GOOGLE_EVENT]);
    expect(all('google_calendars', 'user_id')).toEqual([GOOGLE_CALENDAR]);
    expect(all('daftra_clients', 'account, client_id')).toEqual([DAFTRA_CLIENT]);
    expect(all('daftra_invoices', 'id')).toEqual([{ ...DAFTRA_INVOICE, draft: 0 }, { ...DAFTRA_DRAFT, draft: 1 }]);
    const device = (await t.parts.db.tx('read', (q) => liteLoadWhole(q))).pushDevices?.[PUSH_DEVICE.id];
    expect(device).toEqual(PUSH_DEVICE);
    expect(t.raw.prepare('select user_id from push_devices where endpoint = ?').get(PUSH_DEVICE.endpoint)).toEqual({ user_id: 'usr_002' });
  });

  it('writes each server row once when the finish goes again (resume)', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const server = serverOf(seed, { googleConnections: [GOOGLE_CONNECTION], googleEvents: [GOOGLE_EVENT], googleCalendars: [GOOGLE_CALENDAR], daftraClients: [DAFTRA_CLIENT], daftraInvoices: [DAFTRA_INVOICE] });
    await importState(t, seed, server);
    const { id } = await post<{ id: string }>(t, { step: 'begin', mode: 'resume' });
    await post(t, { step: 'finish', id, server, signin: [] });
    for (const table of ['google_connections', 'google_events', 'google_calendars', 'daftra_clients', 'daftra_invoices']) {
      expect(t.raw.prepare(`select count(*) as n from ${table}`).get(), table).toEqual({ n: 1 });
    }
  });

  it('takes a finish from an older client that sends none of the new lists, and writes none of the new rows', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const t = await nodeOffice({ seed: false });
    const { googleConnections, googleEvents, googleCalendars, daftraClients, daftraInvoices, ...old } = serverOf(seed);
    expect([googleConnections, googleEvents, googleCalendars, daftraClients, daftraInvoices].every((rows) => rows.length === 0)).toBe(true);
    await importState(t, seed, old as ServerRows);
    expect(t.raw.prepare('select count(*) as n from google_connections').get()).toEqual({ n: 0 });
  });
});
