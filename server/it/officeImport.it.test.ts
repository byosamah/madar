import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildSeed } from '../../src/data/seed';
import { exportOffice } from '../../scripts/backup/officeExport';
import { sourceDigests } from '../../scripts/office/compare';
import { recordDigest } from '../../scripts/office/digest';
import { importOffice } from '../../scripts/office/import';
import { partsOps } from '../../scripts/office/ops';
import { reverseExport, reverseKeys } from '../../scripts/office/reverse';
import { exportSource, pgSource, stateSource } from '../../scripts/office/source';
import { authAdminPort } from '../auth/admin';
import { setAuthUserId } from '../data/officeCache';
import { writeState } from '../data/whole';
import { nodeOffice } from '../office/test/nodeOffice';
import { localStack } from './authStack';
import { applyMigrations, dropSchema, localClient } from './migrate';

const TODAY = '2026-10-04';
const SCHEMA = `office_import_${process.pid}`;

/** The platform table that the TRUNCATE of the test seed empties: the app migrations have no platform table (scripts/seed-test-office.test.ts). */
const AGENT_APPROVALS_SQL = 'create table agent_approvals (client_id uuid not null, owner_user_id text not null, approved_at timestamptz not null default now(), primary key (client_id, owner_user_id))';

describe('the Postgres source of an import on the local stack', () => {
  let client: pg.Client;
  const rows = async (text: string, values?: unknown[]) => (await client.query(text, values)).rows as Record<string, unknown>[];

  beforeAll(async () => {
    client = await localClient();
    await applyMigrations(client, SCHEMA);
    await client.query(`set search_path to ${SCHEMA}, public`);
    const seed = await buildSeed(TODAY, async () => undefined);
    await client.query('begin');
    await writeState(rows as Parameters<typeof writeState>[0], seed);
    await client.query('commit');
  }, 120_000);

  afterAll(async () => {
    await dropSchema(client, SCHEMA);
    await client.end();
  });

  it('reads the same records that the State wrote, with the counters', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const source = await pgSource(rows);
    const want = stateSource(seed);
    for (const table of want.tables) {
      const got = source.tables.find((t) => t.table === table.table)!;
      expect(recordDigest(got.rows), table.table).toEqual(recordDigest(table.rows));
    }
    const byPrefix = (list: { prefix: string; n: number }[]) => [...list].sort((a, b) => a.prefix.localeCompare(b.prefix));
    expect(byPrefix(source.server.counters)).toEqual(byPrefix(want.server.counters));
  });

  it('takes an office back from an office object to Postgres with the same records, counters and signal number, and the sign-in link', async () => {
    // One real Auth user of the local stack, linked to usr_001: the import carries the link in, the reverse links it again.
    const stack = localStack();
    const admin = authAdminPort({ supabaseUrl: stack.apiUrl, secretKey: stack.secretKey });
    const { authUserId } = await admin.createUser(`reverse-${Date.now()}@madar.test`, 'a reverse test password');
    try {
      // One row in each Google and Daftra table: the import carries them in, the reverse writes them back (plan E, Task H).
      await client.query("insert into google_connections (id, user_id, sealed_token, calendar_id, state, connected_at, changed_at) values ('gcn_001', 'usr_002', 'v1.sealed', 'cal', 'ok', '2026-10-21T08:00:00Z', '2026-10-22T09:30:00Z')");
      await client.query("insert into google_events (user_id, meeting_id, event_id, synced_rev, synced_at) values ('usr_002', 'mtg_001', 'e1', 4, '2026-10-25T07:00:00Z')");
      await client.query("insert into google_calendars (user_id, calendar_id, changed_at) values ('usr_002', 'cal', '2026-10-21T08:00:00Z')");
      await client.query("insert into daftra_clients (account, client_id, daftra_id, daftra_name, matched_by, matched_at) values ('vado', 'cli_001', '5521', 'Al Noor', 'usr_004', '2026-10-27T11:00:00Z')");
      await client.query("insert into daftra_invoices (account, id, daftra_client_id, no, total_halalas, issued_on, created_at, payment_status, paid_on, draft, seen_at) values ('vado', '9001', '5521', '000412', 1250000, '2026-10-20', '2026-10-20T06:00:00Z', 2, null, true, '2026-10-29T05:00:00Z')");
      const linkFirst = rows as Parameters<typeof setAuthUserId>[0];
      expect(await setAuthUserId(linkFirst, 'usr_001', authUserId)).toBe(true);
      const first = await pgSource(rows);
      expect(first.signin.find((s) => s.id === authUserId)?.user_id).toBe('usr_001');
      const t = await nodeOffice({ seed: false });
      await importOffice(partsOps(t.parts), first, { mode: 'empty' });
      const folder = mkdtempSync(join(tmpdir(), 'madar-reverse-it-'));
      await exportOffice(partsOps(t.parts), { copy: 'local', folder });
      const back = `${SCHEMA}_back`;
      await applyMigrations(client, back);
      await client.query(`set search_path to ${back}, public`);
      try {
        await client.query(AGENT_APPROVALS_SQL);
        const report = await reverseExport(rows, exportSource(folder, { today: TODAY }), { lockKey: 7_310_001, today: TODAY });
        expect(report).toMatchObject({ linked: 1, needInvite: [] });
        expect(await rows("select auth_user_id::text as id from users where id = 'usr_001'")).toEqual([{ id: authUserId }]);
        const second = await pgSource(rows);
        const a = sourceDigests(first);
        const b = sourceDigests(second);
        for (const key of reverseKeys(first)) expect(b[key], key).toEqual(a[key]);
        expect(b.google_connections.rows).toBe(1);
        expect(b.daftra_invoices.rows).toBe(1);
        // The production reverse empties only what it writes back: a row of a table that it does not write back stays (plan E, Task H).
        await client.query("insert into rate_limits (key, window_start, count) values ('k', now(), 1)");
        await reverseExport(rows, exportSource(folder, { today: TODAY }), { lockKey: 7_310_001, today: TODAY, to: 'production' });
        expect(await rows('select count(*)::int as n from rate_limits')).toEqual([{ n: 1 }]);
        const third = sourceDigests(await pgSource(rows));
        for (const key of reverseKeys(first)) expect(third[key], key).toEqual(a[key]);
      } finally {
        await client.query(`set search_path to ${SCHEMA}, public`);
        await dropSchema(client, back);
      }
    } finally {
      await client.query('delete from auth.users where id = $1', [authUserId]);
    }
  }, 120_000);
});
