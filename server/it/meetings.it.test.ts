import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Meeting } from '../../src/api/contract/entities';
import { dropSchema, localClient, migrationFiles } from './migrate';

/**
 * The migration of meetings (fbk_022) on the local stack: the table of the Meeting record. The test applies the migrations before
 * it, then this one, and checks the row round trip, the generated columns, the id rule, the indexes and Row Level Security.
 */
const MIGRATION = '20261020000100_meetings.sql';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const schema = `madar_mtg_${process.pid}`;
const STAMP = '2026-10-19T09:00:00.000+03:00';
const OFFICE_MEETING: Meeting = {
  id: 'mtg_001', kind: 'meeting', title: 'Meet a new client', projectId: null, startsAt: '2026-10-21T10:00:00.000+03:00', endsAt: '2026-10-21T11:00:00.000+03:00',
  where: 'Meeting room', guests: '', notes: '', organizerId: 'usr_004', attendeeIds: ['usr_006', 'usr_007'], minutesById: 'usr_004', status: 'scheduled', rev: 1,
  createdBy: 'usr_004', createdAt: STAMP,
};
const PROJECT_MEETING: Meeting = {
  ...OFFICE_MEETING, id: 'mtg_002', kind: 'client', projectId: 'prj_001', startsAt: '2026-10-22T09:00:00.000+03:00', endsAt: '2026-10-22T10:00:00.000+03:00',
  organizerId: 'usr_002', attendeeIds: ['usr_003'], minutesById: null, settledAt: '2026-10-22T10:15:00.000+03:00',
};

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

describe.runIf(process.env.MADAR_IT === '1')('the meetings migration, on the local database', () => {
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

  it('keeps one row for each meeting, and reads it back as the same record', async () => {
    for (const meeting of [OFFICE_MEETING, PROJECT_MEETING]) await db.query('insert into meetings (id, doc) values ($1, $2)', [meeting.id, JSON.stringify(meeting)]);
    const { rows } = await db.query('select doc from meetings order by ord');
    expect(rows.map((row) => Meeting.parse(row.doc))).toEqual([OFFICE_MEETING, PROJECT_MEETING]);
  });

  it('generates the key columns from the doc, with null for a meeting with no project and for a meeting not settled', async () => {
    const { rows } = await db.query('select id, project_id, organizer_id, starts_at, ends_at, status, settled_at from meetings order by ord');
    expect(rows).toEqual([
      { id: 'mtg_001', project_id: null, organizer_id: 'usr_004', starts_at: OFFICE_MEETING.startsAt, ends_at: OFFICE_MEETING.endsAt, status: 'scheduled', settled_at: null },
      { id: 'mtg_002', project_id: 'prj_001', organizer_id: 'usr_002', starts_at: PROJECT_MEETING.startsAt, ends_at: PROJECT_MEETING.endsAt, status: 'scheduled', settled_at: PROJECT_MEETING.settledAt },
    ]);
  });

  it('refuses a row whose id differs from the id in its doc', async () => {
    await expect(db.query('insert into meetings (id, doc) values ($1, $2)', ['mtg_009', JSON.stringify(OFFICE_MEETING)])).rejects.toThrow();
  });

  it('finds the meetings of one attendee and one day window with the loader conditions', async () => {
    const mine = await db.query("select id from meetings t where t.doc->'attendeeIds' ? $1::text order by t.ord", ['usr_006']);
    expect(mine.rows).toEqual([{ id: 'mtg_001' }]);
    const window = await db.query(
      `select id from meetings t where (t.starts_at)::timestamptz >= $1::timestamptz and t.starts_at collate "C" >= $2::text
       and (t.starts_at)::timestamptz < $3::timestamptz and t.starts_at collate "C" < $4::text order by t.ord`,
      ['2026-10-22T00:00:00.000+03:00', '2026-10-20T12:00:00', '2026-10-23T00:00:00.000+03:00', '2026-10-24T12:00:00'],
    );
    expect(window.rows).toEqual([{ id: 'mtg_002' }]);
  });

  it('has the three read indexes', async () => {
    const { rows } = await db.query("select indexname from pg_indexes where schemaname = $1 and tablename = 'meetings' order by indexname", [schema]);
    expect(rows.map((row) => row.indexname)).toEqual(['meetings_attendees', 'meetings_pkey', 'meetings_project_starts', 'meetings_starts']);
  });

  it('turns on Row Level Security for the table', async () => {
    const { rows } = await db.query("select relrowsecurity from pg_class where oid = 'meetings'::regclass");
    expect(rows[0].relrowsecurity).toBe(true);
  });
});
