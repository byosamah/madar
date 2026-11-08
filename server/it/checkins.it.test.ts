import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Checkin } from '../../src/api/contract/entities';
import { dropSchema, localClient, migrationFiles } from './migrate';

/**
 * The migration of the weekly answers (fbk_088) on the local stack: the table of the Checkin record. The test applies the migrations before it,
 * then this one, and checks the row round trip, the generated key columns, the id rule, the one answer for each person, week and kind, and Row
 * Level Security.
 */
const MIGRATION = '20261108000100_checkins.sql';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const schema = `madar_chk_${process.pid}`;
const STAMP = '2026-11-08T09:00:00.000+03:00';
const PLAN: Checkin = { id: 'chk_001', userId: 'usr_003', week: '2026-11-08', kind: 'plan', taskIds: ['tsk_001'], text: 'Visit the site.', createdAt: STAMP, updatedAt: STAMP };

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

describe.runIf(process.env.MADAR_IT === '1')('the weekly answers migration, on the local database', () => {
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

  it('keeps one row for each answer, reads it back as the same record, and fills the key columns', async () => {
    await db.query('insert into checkins (id, doc) values ($1, $2)', [PLAN.id, JSON.stringify(PLAN)]);
    const { rows } = await db.query('select doc, user_id, week, kind from checkins where id = $1', [PLAN.id]);
    expect(Checkin.parse(rows[0].doc)).toEqual(PLAN);
    expect(rows[0]).toMatchObject({ user_id: 'usr_003', week: '2026-11-08', kind: 'plan' });
  });

  it('refuses a row whose id differs from the id in its doc', async () => {
    await expect(db.query('insert into checkins (id, doc) values ($1, $2)', ['chk_002', JSON.stringify(PLAN)])).rejects.toThrow();
  });

  it('keeps one answer for each person, week and kind, and lets the review and another person and another week stand beside it', async () => {
    const more = (id: string, over: Partial<Checkin>) => db.query('insert into checkins (id, doc) values ($1, $2)', [id, JSON.stringify({ ...PLAN, id, ...over })]);
    await expect(more('chk_003', {})).rejects.toThrow(/checkins_one/);
    await more('chk_004', { kind: 'review' });
    await more('chk_005', { userId: 'usr_004' });
    await more('chk_006', { week: '2026-11-15' });
    const { rows } = await db.query('select count(*)::int as n from checkins');
    expect(rows[0].n).toBe(4);
  });

  it('turns on Row Level Security for the table', async () => {
    const { rows } = await db.query("select relrowsecurity from pg_class where oid = 'checkins'::regclass");
    expect(rows[0].relrowsecurity).toBe(true);
  });
});
