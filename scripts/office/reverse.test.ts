import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSeed } from '../../src/data/seed';
import { TABLES } from '../../server/data/tables';
import { IMPORT_SERVER_SKIP, IMPORT_SERVER_TABLES, type ServerRows } from '../../server/office/import';
import { NODE_TODAY, nodeOffice } from '../../server/office/test/nodeOffice';
import { SERVER_TABLES } from '../../server/data/tables';
import { exportOffice } from '../backup/officeExport';
import { RECORD_DELETES_SQL, TRUNCATE_SQL } from '../seed-test-office';
import { ArgumentError, importOffice } from './import';
import { partsOps } from './ops';
import {
  REVERSE_DAFTRA_CLIENT_SQL, REVERSE_DAFTRA_INVOICE_SQL, REVERSE_GOOGLE_CALENDAR_SQL, REVERSE_GOOGLE_CONNECTION_SQL, REVERSE_GOOGLE_EVENT_SQL,
  REVERSE_JOB_RUNS_SQL, REVERSE_MAIL_LOG_SQL, REVERSE_PRODUCTION_TRUNCATE_SQL, REVERSE_SERVER_TABLES, REVERSE_TRUNCATE_CALENDARS_SQL, REVERSE_VERSION_SQL,
  reverseArguments, reverseExport, reverseKeys, reverseProblems, runReverse, stateOfSource, type ReverseDeps,
} from './reverse';
import { stateSource } from './source';

type Sent = { text: string; values: unknown[] };

function fakePostgres(known: string[] = []) {
  const sent: Sent[] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sent.push({ text, values });
    if (text.startsWith('select id::text as id from auth.users')) return known.map((id) => ({ id }));
    if (text.includes('returning')) return [{ version: 1, office_seq: 1, user_id: 'usr_001', seq: 1, id: 'usr_001' }];
    return [];
  };
  return { sent, texts: () => sent.map((s) => s.text), query };
}

describe('the reverse export (scripts/office/reverse.ts)', () => {
  it('makes the State of a source back, with every record and the counters', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const state = stateOfSource(stateSource(seed), NODE_TODAY);
    expect(state.tasks).toEqual(seed.tasks);
    expect(state.settings).toEqual(seed.settings);
    expect(state.counters).toEqual(seed.counters);
  });

  it('writes in one transaction under the office lock: the deletes record, the tables empty, then the office, then the links', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres(['11111111-1111-4111-8111-111111111111']);
    const source = stateSource(seed, { signin: [
      { id: '11111111-1111-4111-8111-111111111111', email: 'a@madar.test', password_hash: null, email_confirmed: true, banned: false, password_set: true, user_id: 'usr_001' },
      { id: '22222222-2222-4222-8222-222222222222', email: 'new@madar.test', password_hash: 'pbkdf2-sha256$100000$x$y', email_confirmed: true, banned: false, password_set: true, user_id: 'usr_002' },
    ] });
    const report = await reverseExport(pg.query, source, { lockKey: 7_310_001, today: NODE_TODAY });
    const texts = pg.texts();
    expect(texts[0]).toBe('begin');
    expect(texts).toContain(RECORD_DELETES_SQL);
    expect(texts).toContain(TRUNCATE_SQL);
    expect(texts.indexOf(RECORD_DELETES_SQL)).toBeLessThan(texts.indexOf(TRUNCATE_SQL));
    expect(texts.at(-1)).toBe('commit');
    expect(report.needInvite).toEqual([{ userId: 'usr_002', email: 'new@madar.test' }]);
    expect(report.linked).toBe(1);
  });

  it('takes the job runs and the mail log of the day back too, so Supabase sends no second morning summary', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres();
    const source = stateSource(seed, { server: {
      jobRuns: [{ key: `summary:${NODE_TODAY}`, done_at: '2026-10-04T04:31:00.000Z' }],
      mailLog: [{ utc_day: NODE_TODAY, kind: 'summary', user_id: 'usr_001', ref: `summary-${NODE_TODAY}-usr_001`, resend_id: 're_1', created_at: '2026-10-04T04:31:00.000Z' }],
    } });
    await reverseExport(pg.query, source, { lockKey: 7_310_001, today: NODE_TODAY });
    expect(pg.sent.find((s) => s.text === REVERSE_JOB_RUNS_SQL)?.values).toEqual([`summary:${NODE_TODAY}`, '2026-10-04T04:31:00.000Z']);
    expect(pg.sent.find((s) => s.text === REVERSE_MAIL_LOG_SQL)?.values).toEqual([NODE_TODAY, 'summary', 'usr_001', `summary-${NODE_TODAY}-usr_001`, 're_1', '2026-10-04T04:31:00.000Z']);
    expect(pg.texts().indexOf(REVERSE_JOB_RUNS_SQL)).toBeGreaterThan(pg.texts().indexOf(TRUNCATE_SQL));
  });

  it('rolls back and writes no commit when a statement fails', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const sent: string[] = [];
    await expect(reverseExport(async (text) => {
      sent.push(text);
      if (text === TRUNCATE_SQL) throw new Error('lock timeout');
      return [];
    }, stateSource(seed), { lockKey: 7_310_001, today: NODE_TODAY })).rejects.toThrow('lock timeout');
    expect(sent.at(-1)).toBe('rollback');
    expect(sent).not.toContain('commit');
  });
});

const GOOGLE: Pick<ServerRows, 'googleConnections' | 'googleEvents' | 'googleCalendars'> = {
  googleConnections: [{ id: 'gcn_001', user_id: 'usr_002', sealed_token: 'v1.sealed', calendar_id: 'cal', state: 'ok', connected_at: '2026-10-21T08:00:00.000Z', last_error: null, last_error_at: null, changed_at: '2026-10-22T09:30:00.000Z' }],
  googleEvents: [{ user_id: 'usr_002', meeting_id: 'mtg_001', event_id: 'e1', synced_rev: 4, synced_at: '2026-10-25T07:00:00.000Z' }],
  googleCalendars: [{ user_id: 'usr_002', calendar_id: 'cal', changed_at: '2026-10-21T08:00:00.000Z' }],
};
const DAFTRA: Pick<ServerRows, 'daftraClients' | 'daftraInvoices'> = {
  daftraClients: [{ account: 'vado', client_id: 'cli_001', daftra_id: '5521', daftra_name: 'Al Noor', matched_by: 'usr_004', matched_at: '2026-10-27T11:00:00.000Z' }],
  daftraInvoices: [{ account: 'vado', id: '9001', daftra_client_id: '5521', no: '000412', total_halalas: 1_250_000, issued_on: '2026-10-20', created_at: '2026-10-20T06:00:00.000Z', payment_status: 2, paid_on: null, draft: true, seen_at: '2026-10-29T05:00:00.000Z' }],
};

describe('the Google and Daftra rows of the way back (plan E, Task H)', () => {
  it('writes them in the same transaction, after the tables are empty and before the commit, with every value', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres();
    await reverseExport(pg.query, stateSource(seed, { server: { ...GOOGLE, ...DAFTRA } }), { lockKey: 7_310_001, today: NODE_TODAY });
    const texts = pg.texts();
    const at = (sql: string) => texts.indexOf(sql);
    for (const sql of [REVERSE_GOOGLE_CONNECTION_SQL, REVERSE_GOOGLE_EVENT_SQL, REVERSE_GOOGLE_CALENDAR_SQL, REVERSE_DAFTRA_CLIENT_SQL, REVERSE_DAFTRA_INVOICE_SQL]) {
      expect(at(sql), sql.slice(0, 40)).toBeGreaterThan(at(TRUNCATE_SQL));
      expect(at(sql), sql.slice(0, 40)).toBeLessThan(texts.length - 1);
    }
    expect(texts.at(-1)).toBe('commit');
    const values = (sql: string) => pg.sent.find((x) => x.text === sql)?.values;
    expect(values(REVERSE_GOOGLE_CONNECTION_SQL)).toEqual(['gcn_001', 'usr_002', 'v1.sealed', 'cal', 'ok', '2026-10-21T08:00:00.000Z', null, null, '2026-10-22T09:30:00.000Z']);
    expect(values(REVERSE_GOOGLE_EVENT_SQL)).toEqual(['usr_002', 'mtg_001', 'e1', 4, '2026-10-25T07:00:00.000Z']);
    expect(values(REVERSE_GOOGLE_CALENDAR_SQL)).toEqual(['usr_002', 'cal', '2026-10-21T08:00:00.000Z']);
    expect(values(REVERSE_DAFTRA_CLIENT_SQL)).toEqual(['vado', 'cli_001', '5521', 'Al Noor', 'usr_004', '2026-10-27T11:00:00.000Z']);
    expect(values(REVERSE_DAFTRA_INVOICE_SQL)).toEqual(['vado', '9001', '5521', '000412', 1_250_000, '2026-10-20', '2026-10-20T06:00:00.000Z', 2, null, true, '2026-10-29T05:00:00.000Z']);
  });

  it('makes the calendar table equal to the object for a test or local target, which TRUNCATE_SQL keeps', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres();
    await reverseExport(pg.query, stateSource(seed, { server: GOOGLE }), { lockKey: 7_310_001, today: NODE_TODAY });
    expect(pg.texts().indexOf(REVERSE_TRUNCATE_CALENDARS_SQL)).toBeGreaterThan(pg.texts().indexOf(TRUNCATE_SQL));
    expect(pg.texts().indexOf(REVERSE_TRUNCATE_CALENDARS_SQL)).toBeLessThan(pg.texts().indexOf(REVERSE_GOOGLE_CALENDAR_SQL));
  });

  it('raises the version of Postgres above the version of the object first, so no open list looks current', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres();
    await reverseExport(pg.query, stateSource(seed, { server: { version: 5_000 } }), { lockKey: 7_310_001, today: NODE_TODAY });
    expect(pg.sent.find((x) => x.text === REVERSE_VERSION_SQL)?.values).toEqual([5_000]);
    expect(pg.texts().indexOf(REVERSE_VERSION_SQL)).toBeLessThan(pg.texts().indexOf(RECORD_DELETES_SQL));
  });

  it('writes the push devices back as records, and the production reverse empties and refills their table', async () => {
    expect(TABLES.map((spec) => spec.table)).toContain('push_devices');
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    seed.pushDevices = { pdv_001: {
      id: 'pdv_001', userId: 'usr_001', endpoint: 'https://web.push.apple.com/QWxhZGRpbjpvcGVuIHNlc2FtZQ', label: 'iPhone', createdAt: '2026-10-21T08:00:00.000Z', lastPushAt: null,
      keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) },
    } } as typeof seed.pushDevices;
    const source = stateSource(seed);
    expect(source.tables.find((t) => t.table === 'push_devices')?.rows.map((r) => r.id)).toEqual(['pdv_001']);
    expect(stateOfSource(source, NODE_TODAY).pushDevices).toEqual(seed.pushDevices);
    const pg = fakePostgres();
    await reverseExport(pg.query, source, { lockKey: 7_310_001, today: NODE_TODAY, to: 'production' });
    const insert = pg.sent.find((x) => /^insert into push_devices/.test(x.text));
    expect(JSON.stringify(insert?.values)).toContain('pdv_001');
    expect(REVERSE_PRODUCTION_TRUNCATE_SQL).toMatch(/\bpush_devices\b/);
    expect(reverseKeys(source)).toContain('push_devices');
  });

  it('lists what happens to each server table: every table is named, and production empties only the tables that it writes back or can rebuild', () => {
    for (const table of SERVER_TABLES) expect(REVERSE_SERVER_TABLES, table).toHaveProperty(table);
    for (const table of [...Object.keys(IMPORT_SERVER_TABLES), ...Object.keys(IMPORT_SERVER_SKIP)]) expect(REVERSE_SERVER_TABLES, table).toHaveProperty(table);
    const emptied = new Set(REVERSE_PRODUCTION_TRUNCATE_SQL.replace(/^truncate /, '').replace(/ restart identity$/, '').split(', '));
    for (const [table, what] of Object.entries(REVERSE_SERVER_TABLES)) {
      const empties = what.startsWith('emptied');
      expect(emptied.has(table), `${table}: ${what}`).toBe(empties);
      if (empties) expect(what, table).toMatch(/^emptied, (written back|rebuilt)/);
    }
    // The carried tables of the import that the reverse does not write back are never emptied by it.
    for (const table of ['usage_month', 'usage_warnings', 'mail_log', 'person_seq', 'job_runs', 'office_meta']) expect(emptied.has(table), table).toBe(false);
    // Nor the tables that only the Postgres path owns: the old agent links, the effects that wait, the stories.
    for (const table of ['agent_links', 'outbox', 'stories', 'idempotency', 'upload_intents', 'rate_limits', 'agent_confirms', 'mail_outbox', 'platform_config', 'office_deletes']) expect(emptied.has(table), table).toBe(false);
    // The wider list of the test seed still empties them, as before.
    expect(TRUNCATE_SQL).toMatch(/agent_links/);
  });

  it('the production reverse sends the production list and never the TRUNCATE of the test seed', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const pg = fakePostgres();
    await reverseExport(pg.query, stateSource(seed, { server: { ...GOOGLE, ...DAFTRA } }), { lockKey: 7_310_001, today: NODE_TODAY, to: 'production' });
    expect(pg.texts()).toContain(REVERSE_PRODUCTION_TRUNCATE_SQL);
    expect(pg.texts()).not.toContain(TRUNCATE_SQL);
    expect(pg.texts()).not.toContain(REVERSE_TRUNCATE_CALENDARS_SQL);
    expect(pg.texts().indexOf(REVERSE_PRODUCTION_TRUNCATE_SQL)).toBeLessThan(pg.texts().indexOf(REVERSE_GOOGLE_CONNECTION_SQL));
  });
});

describe('the read-back compare of the way back covers the Google and Daftra tables', () => {
  it('finds no difference for the same source, and names the table of each changed, lost or added row', async () => {
    const seed = await buildSeed(NODE_TODAY, async () => undefined);
    const server = { ...GOOGLE, ...DAFTRA };
    const source = stateSource(seed, { server });
    expect(reverseKeys(source)).toEqual(expect.arrayContaining(['google_connections', 'google_events', 'google_calendars', 'daftra_clients', 'daftra_invoices']));
    expect(reverseProblems(source, stateSource(seed, { server }))).toEqual([]);
    const sealed = stateSource(seed, { server: { ...server, googleConnections: [{ ...GOOGLE.googleConnections[0], sealed_token: 'v1.other' }] } });
    expect(reverseProblems(source, sealed)).toEqual(['google_connections']);
    const lost = stateSource(seed, { server: { ...server, daftraClients: [], daftraInvoices: [], googleCalendars: [], googleEvents: [] } });
    expect(reverseProblems(source, lost)).toEqual(['google_events', 'google_calendars', 'daftra_clients', 'daftra_invoices']);
    const more = stateSource(seed, { server: { ...server, googleCalendars: [...GOOGLE.googleCalendars, { user_id: 'usr_009', calendar_id: 'x', changed_at: '2026-10-21T08:00:00.000Z' }] } });
    expect(reverseProblems(source, more)).toEqual(['google_calendars']);
  });
});

const PROD = ['--from-office', 'https://madar.vado.sa', '--office', 'ent_001', '--to', 'production', '--yes-replace'];

describe('the arguments of the reverse export (plan E, Task H)', () => {
  it('takes production with --yes-replace, --office ent_001 and the office of production as the source', () => {
    expect(reverseArguments(PROD)).toMatchObject({ to: 'production', office: 'ent_001', typed: true, from: { kind: 'office', target: { copy: 'production', base: 'https://madar.vado.sa' } } });
  });

  it('refuses --to production without --yes-replace, naming the flag', () => {
    const run = () => reverseArguments(PROD.filter((a) => a !== '--yes-replace'));
    expect(run).toThrow(ArgumentError);
    expect(run).toThrow('--yes-replace');
  });

  it('refuses --to production for any office name but ent_001, or none, naming --office', () => {
    for (const office of [['--office', 'ent_002'], ['--office', 'rehearsal-20261110'], ['--office', 'ENT_001'], []]) {
      const run = () => reverseArguments(['--from-office', 'https://madar.vado.sa', ...office, '--to', 'production', '--yes-replace']);
      expect(run).toThrow(ArgumentError);
      expect(run).toThrow('--office');
    }
  });

  it('refuses --to production from an export folder or from any office but production, naming the source', () => {
    expect(() => reverseArguments(['--from-export', '/tmp/x', '--office', 'ent_001', '--to', 'production', '--yes-replace'])).toThrow(ArgumentError);
    expect(() => reverseArguments(['--from-export', '/tmp/x', '--office', 'ent_001', '--to', 'production', '--yes-replace'])).toThrow('--from-office');
    for (const from of ['https://preview.madar-46r.pages.dev', 'http://127.0.0.1:8792']) {
      const run = () => reverseArguments(['--from-office', from, '--office', 'ent_001', '--to', 'production', '--yes-replace']);
      expect(run, from).toThrow(ArgumentError);
      expect(run, from).toThrow('production');
    }
  });

  it('keeps the old rules: production is never a source for a test or local target, and a test target needs --yes-replace', () => {
    expect(() => reverseArguments(['--from-office', 'https://madar.vado.sa', '--to', 'test', '--yes-replace'])).toThrow('does not take production');
    expect(() => reverseArguments(['--from-office', 'https://madar.vado.sa', '--to', 'local'])).toThrow('does not take production');
    expect(() => reverseArguments(['--from-office', 'https://preview.madar-46r.pages.dev', '--to', 'test'])).toThrow('--yes-replace');
    expect(() => reverseArguments(['--from-export', '/tmp/x', '--to', 'elsewhere'])).toThrow('--to must be');
    expect(reverseArguments(['--from-export', '/tmp/x', '--to', 'local'])).toMatchObject({ to: 'local', typed: false });
    expect(reverseArguments(['--from-office', 'https://preview.madar-46r.pages.dev', '--to', 'test', '--yes-replace'])).toMatchObject({ to: 'test', typed: false });
  });

  it('ends with exit code 2 for a refused argument, and with exit code 1 for a wrong typed word, before any network or database call', () => {
    const script = fileURLToPath(new URL('./reverse.ts', import.meta.url));
    const run = (args: string[], input = '') => spawnSync(process.execPath, ['--import', 'tsx', script, ...args], { encoding: 'utf8', input, timeout: 60_000, env: { PATH: process.env.PATH ?? '' } });
    const noYes = run(PROD.filter((a) => a !== '--yes-replace'));
    expect([noYes.status, noYes.stderr]).toEqual([2, expect.stringContaining('--yes-replace')]);
    const wrongOffice = run(['--from-office', 'https://madar.vado.sa', '--office', 'ent_002', '--to', 'production', '--yes-replace']);
    expect([wrongOffice.status, wrongOffice.stderr]).toEqual([2, expect.stringContaining('--office')]);
    const wrongWord = run(PROD, 'yes\n');
    expect([wrongWord.status, wrongWord.stderr]).toEqual([1, expect.stringContaining('The typed word was not production. Nothing changed.')]);
    // No input at all (a closed terminal) is no typed word either.
    const noWord = run(PROD, '');
    expect([noWord.status, noWord.stderr]).toEqual([1, expect.stringContaining('The typed word was not production. Nothing changed.')]);
  });
});

/** The deps of one run with every outside call recorded. exportTo writes a real export folder of an office with the rows given. */
async function fakeDeps(o: { word?: string; env?: Record<string, string>; server?: Partial<ServerRows> } = {}) {
  const calls: string[] = [];
  const sent: string[] = [];
  const seed = await buildSeed(NODE_TODAY, async () => undefined);
  const deps: ReverseDeps = {
    ask: async () => (calls.push('ask'), o.word ?? 'production'),
    env: o.env ?? { MADAR_DB_PASSWORD: 'x' },
    secretOf: () => (calls.push('secret'), 'export-secret'),
    exportTo: async ({ folder }) => {
      calls.push('export');
      const t = await nodeOffice({ seed: false });
      await importOffice(partsOps(t.parts), stateSource(seed, { server: o.server }), { mode: 'empty' });
      await exportOffice(partsOps(t.parts), { copy: 'local', folder });
    },
    connect: async () => (calls.push('connect'), {
      query: async (text: string) => (sent.push(text), { rows: text.includes('returning') ? [{ version: 1, office_seq: 1, user_id: 'usr_001', seq: 1, id: 'usr_001' }] : [] }),
      end: async () => { calls.push('end'); },
    }),
    log: () => undefined,
  };
  return { deps, calls, sent };
}

describe('the run of the reverse export into production (plan E, Task H)', () => {
  it('asks for the typed word first, and a wrong word stops the run before the secret, the export and the database', async () => {
    const f = await fakeDeps({ word: 'yes' });
    await expect(runReverse(PROD, f.deps)).rejects.toThrow('The typed word was not production. Nothing changed.');
    expect(f.calls).toEqual(['ask']);
    expect(f.sent).toEqual([]);
  });

  it('refuses a bad argument before the typed word, the export and the database', async () => {
    const f = await fakeDeps();
    await expect(runReverse(PROD.filter((a) => a !== '--yes-replace'), f.deps)).rejects.toThrow(ArgumentError);
    await expect(runReverse(['--from-office', 'https://madar.vado.sa', '--office', 'ent_002', '--to', 'production', '--yes-replace'], f.deps)).rejects.toThrow(ArgumentError);
    expect(f.calls).toEqual([]);
  });

  it('stops before the export when the database password of production is missing, and names the variable but no value', async () => {
    const f = await fakeDeps({ env: {} });
    const error = await runReverse(PROD, f.deps).then(() => undefined, (e: unknown) => e as Error);
    expect(error?.message).toContain('MADAR_DB_PASSWORD');
    expect(f.calls).toEqual(['ask']);
  });

  it('exports the object, writes production, reads it back, and exits with an error when the read-back differs (exit code 1)', async () => {
    const f = await fakeDeps({ server: { ...GOOGLE, ...DAFTRA } });
    // The fake database answers no row to a read, so the read-back finds every table of the object missing, the Google and Daftra tables too.
    const error = await runReverse(PROD, f.deps).then(() => undefined, (e: unknown) => e as Error);
    expect(f.calls).toEqual(['ask', 'secret', 'export', 'connect', 'end']);
    expect(error?.message).toMatch(/^Postgres differs from the office object after the reverse export: /);
    for (const table of ['google_connections', 'google_events', 'google_calendars', 'daftra_clients', 'daftra_invoices']) expect(error?.message, table).toContain(table);
    expect(f.sent).toContain(REVERSE_PRODUCTION_TRUNCATE_SQL);
    expect(f.sent).not.toContain(TRUNCATE_SQL);
    expect(f.sent.at(-1)).toBe('commit');
  });
});

