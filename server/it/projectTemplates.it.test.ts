import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectTemplate, type StageTemplate } from '../../src/api/contract/entities';
import { projectTemplateFromStages } from '../../src/api/projectTemplates';
import { dropSchema, localClient, migrationFiles } from './migrate';

/**
 * The migration of project templates (owner, 2026-10-05, item 6a) on the local stack: it makes the table, and it turns each
 * stage template into a project template with stages and no tasks, as the prototype step of version 9 does. The test applies
 * the migrations before it, writes stage templates, then applies it.
 */
const MIGRATION = '20261005000100_project_templates.sql';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const schema = `madar_ptp_${process.pid}`;
const STAMP = '2026-09-05T09:00:00.000+03:00';
const OLD: StageTemplate[] = [
  { id: 'stt_001', name: 'Interior fit-out', stages: ['Concept', 'Permits'], createdBy: 'usr_001', createdAt: STAMP },
  { id: 'stt_003', name: 'Competition entry', stages: ['Brief'], createdBy: 'usr_003', createdAt: STAMP },
];

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

describe.runIf(process.env.MADAR_IT === '1')('the project templates migration, on the local database', () => {
  let db: pg.Client;
  let versionBefore = 0;

  beforeAll(async () => {
    db = await localClient();
    await db.query(`drop schema if exists ${schema} cascade`);
    await db.query(`create schema ${schema}`);
    const files = migrationFiles({ platform: false });
    expect(files).toContain(MIGRATION);
    await apply(db, files.filter((name) => name < MIGRATION));
    await db.query(`set search_path to ${schema}`);
    for (const old of OLD) await db.query('insert into stage_templates (id, doc) values ($1, $2)', [old.id, JSON.stringify(old)]);
    await db.query(`insert into counters (prefix, n) values ('stt', 3)`);
    versionBefore = Number((await db.query('select version from office_meta')).rows[0].version);
    await apply(db, files.filter((name) => name >= MIGRATION));
    await db.query(`set search_path to ${schema}`);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await dropSchema(db, schema);
    await db.end();
  });

  it('makes one project template for each stage template, the same record as the prototype step', async () => {
    const { rows } = await db.query('select id, doc from project_templates order by ord');
    expect(rows.map((row) => row.id)).toEqual(['ptp_001', 'ptp_002']);
    expect(rows.map((row) => row.doc)).toEqual([projectTemplateFromStages(OLD[0], 'ptp_001'), projectTemplateFromStages(OLD[1], 'ptp_002')]);
    for (const row of rows) expect(ProjectTemplate.safeParse(row.doc).success).toBe(true);
  });

  it('keeps the stage templates, sets the ptp counter, and raises the office version for the office cache', async () => {
    expect((await db.query('select count(*)::integer as n from stage_templates')).rows[0].n).toBe(2);
    expect((await db.query(`select n from counters where prefix = 'ptp'`)).rows).toEqual([{ n: 2 }]);
    const version = Number((await db.query('select version from office_meta')).rows[0].version);
    expect(version).toBe(versionBefore + 1);
    const { rows } = await db.query('select distinct chg from project_templates');
    expect(rows.map((row) => Number(row.chg))).toEqual([version]);
  });

  it('gives the table the rules of every Madar table: RLS, one policy for madar_server, no right for the browser roles', async () => {
    const { rows: rls } = await db.query(
      `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relname = 'project_templates'`, [schema],
    );
    expect(rls).toEqual([{ relrowsecurity: true }]);
    const { rows: policies } = await db.query(`select policyname, roles::text[] as roles from pg_policies where schemaname = $1 and tablename = 'project_templates'`, [schema]);
    expect(policies).toEqual([{ policyname: 'server_all', roles: ['madar_server'] }]);
    const { rows: grants } = await db.query(
      `select grantee, privilege_type from information_schema.role_table_grants where table_schema = $1 and table_name = 'project_templates' and grantee in ('anon', 'authenticated', 'madar_server') order by 1, 2`,
      [schema],
    );
    expect(grants.map((row) => `${row.grantee}:${row.privilege_type}`)).toEqual(['madar_server:DELETE', 'madar_server:INSERT', 'madar_server:SELECT', 'madar_server:UPDATE']);
  });
});
