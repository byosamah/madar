import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { columnNames } from '../loaders/query';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES } from '../tables';
import { nodeHost } from './host';
import { DEFAULT_SETTINGS, LITE_SCHEMA_VERSION, SIGNIN_TABLES, applyLiteSchema, liteSchemaSql } from './schema';
import { freshLite } from './testDb';

/** The sha256 of the schema text of LITE_SCHEMA_VERSION. A change of the schema needs a new version and a new value here. */
const PINNED_SHA256 = '77bb4e5609fac88fd2021ca83596c7c9dd62bf684ca43c5ea8cecd5d81e2b6ec';

const tablesOf = (raw: DatabaseSync) =>
  (raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((r) => r.name);
const columnsOf = (raw: DatabaseSync, table: string) =>
  (raw.prepare('select name from pragma_table_info(?)').all(table) as { name: string }[]).map((r) => r.name);

describe('the SQLite schema (server/data/lite/schema.ts)', () => {
  it('makes one table for each State collection, with the loader columns of query.ts, and only id and doc for an office list', async () => {
    const { raw } = await freshLite();
    for (const spec of TABLES) {
      expect(columnsOf(raw, spec.table), spec.table).toEqual(['id', 'doc', ...(spec.office ? [] : columnNames(spec.collection))]);
    }
  });

  it('keeps the server tables of Postgres, apart from office_deletes and platform_config, and adds its own', async () => {
    const { raw } = await freshLite();
    const kept = SERVER_TABLES.filter((table) => table !== 'office_deletes' && table !== 'platform_config');
    const expected = [...TABLES.map((spec) => spec.table), COUNTERS_TABLE, ...kept, 'agent_approvals', 'office_snapshot', 'schema_version', 'usage_day', ...SIGNIN_TABLES];
    expect(tablesOf(raw)).toEqual(expected.sort());
  });

  it('applies the steps above the version of an older office, in one transaction', async () => {
    const { raw } = await freshLite();
    raw.exec('drop table usage_day');
    raw.exec('drop table sub_companies');
    raw.exec('update schema_version set version = 2');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [3, 4] });
    expect(columnsOf(raw, 'usage_day')).toEqual(['day', 'rows_read', 'rows_written', 'requests', 'calls', 'worker_requests']);
    expect(columnsOf(raw, 'sub_companies')).toEqual(['id', 'doc']);
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: LITE_SCHEMA_VERSION });
  });

  it('steps a version 3 office to the same sub_companies table text as a new office', async () => {
    const { raw } = await freshLite();
    const fresh = raw.prepare("select sql from sqlite_master where name = 'sub_companies'").get();
    raw.exec('drop table sub_companies');
    raw.exec('update schema_version set version = 3');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [4] });
    expect(raw.prepare("select sql from sqlite_master where name = 'sub_companies'").get()).toEqual(fresh);
  });

  it('refuses an office whose version has no step to the next one, and changes nothing', async () => {
    const { raw } = await freshLite();
    raw.exec('update schema_version set version = 0');
    await expect(applyLiteSchema(nodeHost(raw))).rejects.toThrow('This build has no schema step to version 1');
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: 0 });
  });

  it('refuses an office that is newer than this build', async () => {
    const { raw } = await freshLite();
    raw.exec(`update schema_version set version = ${LITE_SCHEMA_VERSION + 1}`);
    await expect(applyLiteSchema(nodeHost(raw))).rejects.toThrow('Deploy the newer build');
  });

  it('holds the sign-in rows of wave 2 with their columns', async () => {
    const { raw } = await freshLite();
    expect(columnsOf(raw, 'auth_users')).toEqual(['id', 'user_id', 'email', 'password_hash', 'password_set', 'email_confirmed', 'banned', 'created_at', 'updated_at']);
    expect(columnsOf(raw, 'auth_links')).toEqual(['token_hash', 'auth_id', 'type', 'expires_at', 'used_at', 'created_at']);
    expect(columnsOf(raw, 'auth_sessions')).toEqual(['id', 'auth_id', 'client_id', 'amr', 'refresh_hash', 'prev_hash', 'rotated_at', 'link_until', 'expires_at', 'last_used_at', 'revoked_at', 'created_at']);
    expect(columnsOf(raw, 'oauth_clients')).toEqual(['id', 'name', 'redirect_uris', 'created_at']);
    expect(columnsOf(raw, 'oauth_requests')).toEqual(['id', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'scope', 'resource', 'auth_id', 'status', 'code_hash', 'code_until', 'expires_at', 'created_at']);
  });

  it('keeps one email and one Madar person for each sign-in row', async () => {
    const { raw } = await freshLite();
    raw.exec("insert into auth_users (id, user_id, email) values ('a1', 'usr_001', 'hala@madar.test')");
    expect(() => raw.exec("insert into auth_users (id, user_id, email) values ('a2', null, 'hala@madar.test')")).toThrow('UNIQUE');
    expect(() => raw.exec("insert into auth_users (id, user_id, email) values ('a3', 'usr_001', 'other@madar.test')")).toThrow('UNIQUE');
    raw.exec("insert into auth_users (id, user_id, email) values ('a4', null, 'four@madar.test')");
    raw.exec("insert into auth_users (id, user_id, email) values ('a5', null, 'five@madar.test')");
  });

  it('has no foreign key: a broken deferred key resets the office object', async () => {
    const { raw } = await freshLite();
    for (const table of tablesOf(raw)) expect(raw.prepare('select count(*) as n from pragma_foreign_key_list(?)').get(table), table).toEqual({ n: 0 });
  });

  it('seeds the settings row and office_meta as a fresh Postgres schema does', async () => {
    const { db } = await freshLite();
    expect(await db.statement('read', "select doc from settings where id = 'office'")).toEqual([{ doc: DEFAULT_SETTINGS }]);
    expect(await db.statement('read', 'select id, version, office_seq from office_meta')).toEqual([{ id: 1, version: 0, office_seq: 0 }]);
  });

  it('applies once: a second start reads the version and runs no schema statement', async () => {
    const raw = new DatabaseSync(':memory:');
    const log: string[] = [];
    const host = nodeHost(raw, { log });
    expect(await applyLiteSchema(host)).toEqual({ applied: true });
    log.length = 0;
    expect(await applyLiteSchema(host)).toEqual({ applied: false });
    expect(log).toEqual(['select version from schema_version where id = 1']);
  });

  it('refuses an office of another schema version', async () => {
    const { raw } = await freshLite();
    raw.exec('update schema_version set version = 99');
    await expect(applyLiteSchema(nodeHost(raw))).rejects.toThrow('is version 99');
  });

  it('never makes the statistics table of ANALYZE', async () => {
    const { raw } = await freshLite();
    expect(raw.prepare("select count(*) as n from sqlite_master where name like 'sqlite_stat%'").get()).toEqual({ n: 0 });
  });

  it('refuses an update and a delete of an event', async () => {
    const { db } = await freshLite();
    await db.tx('write', (q) => q('insert into events (id, doc, seq) values (?, ?, ?)', ['evt_001', '{}', 1]));
    await expect(db.statement('write', 'update events set seq = 2')).rejects.toThrow('events only grow');
    await expect(db.statement('write', 'delete from events')).rejects.toThrow('events only grow');
  });

  it('pins the schema text to its version', () => {
    const sha256 = createHash('sha256').update(liteSchemaSql().join('\n')).digest('hex');
    expect({ version: LITE_SCHEMA_VERSION, sha256 }).toEqual({ version: 4, sha256: PINNED_SHA256 });
  });
});
