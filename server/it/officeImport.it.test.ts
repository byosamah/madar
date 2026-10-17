import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { buildSeed } from '../../src/data/seed';
import { recordDigest } from '../../scripts/office/digest';
import { pgSource, stateSource } from '../../scripts/office/source';
import { writeState } from '../data/whole';
import { applyMigrations, dropSchema, localClient } from './migrate';

const TODAY = '2026-10-04';
const SCHEMA = `office_import_${process.pid}`;

describe('the Postgres source of an import on the local stack', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await localClient();
    await applyMigrations(client, SCHEMA);
    await client.query(`set search_path to ${SCHEMA}, public`);
    const seed = await buildSeed(TODAY, async () => undefined);
    await client.query('begin');
    await writeState((async (text: string, values?: unknown[]) => (await client.query(text, values)).rows) as Parameters<typeof writeState>[0], seed);
    await client.query('commit');
  }, 120_000);

  afterAll(async () => {
    await dropSchema(client, SCHEMA);
    await client.end();
  });

  it('reads the same records that the State wrote, with the counters', async () => {
    const seed = await buildSeed(TODAY, async () => undefined);
    const source = await pgSource(async (text, values) => (await client.query(text, values)).rows);
    const want = stateSource(seed);
    for (const table of want.tables) {
      const got = source.tables.find((t) => t.table === table.table)!;
      expect(recordDigest(got.rows), table.table).toEqual(recordDigest(table.rows));
    }
    const byPrefix = (rows: { prefix: string; n: number }[]) => [...rows].sort((a, b) => a.prefix.localeCompare(b.prefix));
    expect(byPrefix(source.server.counters)).toEqual(byPrefix(want.server.counters));
  });
});
