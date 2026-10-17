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
import { reverseExport } from '../../scripts/office/reverse';
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
        for (const key of [...first.tables.map((x) => x.table), 'counters', 'person_seq', 'office_seq']) expect(b[key], key).toEqual(a[key]);
      } finally {
        await client.query(`set search_path to ${SCHEMA}, public`);
        await dropSchema(client, back);
      }
    } finally {
      await client.query('delete from auth.users where id = $1', [authUserId]);
    }
  }, 120_000);
});
