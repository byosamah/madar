import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SubCompany } from '../../src/api/contract/entities';
import { dropSchema, localClient, migrationFiles } from './migrate';

/**
 * The migration of sub-companies (fbk_007) on the local stack: the table of the SubCompany record. The test applies the
 * migrations before it, then this one, and checks the row round trip, the id rule and Row Level Security.
 */
const MIGRATION = '20261019000100_sub_companies.sql';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const schema = `madar_sub_${process.pid}`;
const STAMP = '2026-10-18T09:00:00.000+03:00';
const VADO: SubCompany = { id: 'sub_001', name: 'Vado', nameAr: 'فادو', logo: null, createdBy: 'usr_001', createdAt: STAMP };

async function apply(db: pg.Client, names: string[]): Promise<void> {
  await db.query('begin');
  try {
    await db.query("select pg_advisory_xact_lock(hashtext('madar_migrations'))");
    await db.query(`set local search_path to ${schema}`);
    for (const name of names) await db.query(readFileSync(new URL(name, MIGRATIONS), 'utf8'));
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

describe.runIf(process.env.MADAR_IT === '1')('the sub-companies migration, on the local database', () => {
  let db: pg.Client;

  beforeAll(async () => {
    db = await localClient();
    await db.query(`drop schema if exists ${schema} cascade`);
    await db.query(`create schema ${schema}`);
    const files = migrationFiles({ platform: false });
    expect(files).toContain(MIGRATION);
    await apply(db, files.filter((name) => name < MIGRATION));
    await apply(db, files.filter((name) => name >= MIGRATION));
    await db.query(`set search_path to ${schema}`);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await dropSchema(db, schema);
    await db.end();
  });

  it('keeps one row for each sub-company, and reads it back as the same record', async () => {
    await db.query('insert into sub_companies (id, doc) values ($1, $2)', [VADO.id, JSON.stringify(VADO)]);
    const { rows } = await db.query('select doc from sub_companies where id = $1', [VADO.id]);
    expect(SubCompany.parse(rows[0].doc)).toEqual(VADO);
  });

  it('refuses a row whose id differs from the id in its doc', async () => {
    await expect(db.query('insert into sub_companies (id, doc) values ($1, $2)', ['sub_002', JSON.stringify(VADO)])).rejects.toThrow();
  });

  it('turns on Row Level Security for the table', async () => {
    const { rows } = await db.query("select relrowsecurity from pg_class where oid = 'sub_companies'::regclass");
    expect(rows[0].relrowsecurity).toBe(true);
  });
});
