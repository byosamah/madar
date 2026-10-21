import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { columnNames } from '../loaders/query';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES } from '../tables';
import { nodeHost } from './host';
import { DEFAULT_SETTINGS, LITE_SCHEMA_VERSION, SIGNIN_TABLES, applyLiteSchema, liteSchemaSql } from './schema';
import { freshLite } from './testDb';

/** The sha256 of the schema text of LITE_SCHEMA_VERSION. A change of the schema needs a new version and a new value here. */
const PINNED_SHA256 = '2095146c6c3b917aa75a4c774baf7f5857a541f820fd752a2cb7c1e7d3da4e5c';

const tablesOf = (raw: DatabaseSync) =>
  (raw.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((r) => r.name);
const columnsOf = (raw: DatabaseSync, table: string) =>
  (raw.prepare('select name from pragma_table_info(?)').all(table) as { name: string }[]).map((r) => r.name);
/** Takes the index of version 10 away (chat presence design C4): the steps of a version below 10 make it again. */
const dropConversationIndex = (raw: DatabaseSync) => raw.exec('drop index chat_reads_conversation');
/**
 * Takes the Google tables away, as an office below version 8 has none (fbk_022). google_calendars is version 9: dropCalendars takes only
 * that one, and the index of version 10 with it, as an office below version 9 has neither.
 */
const dropCalendars = (raw: DatabaseSync) => {
  raw.exec('drop table google_calendars');
  dropConversationIndex(raw);
};
const dropGoogle = (raw: DatabaseSync) => {
  raw.exec('drop table google_connections');
  raw.exec('drop table google_events');
  dropCalendars(raw);
};

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
    raw.exec('alter table messages drop column search_text');
    raw.exec('alter table comments drop column search_text');
    raw.exec('drop table meetings');
    dropGoogle(raw);
    raw.exec('update schema_version set version = 2');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [3, 4, 5, 6, 7, 8, 9, 10] });
    expect(columnsOf(raw, 'usage_day')).toEqual(['day', 'rows_read', 'rows_written', 'requests', 'calls', 'worker_requests']);
    expect(columnsOf(raw, 'sub_companies')).toEqual(['id', 'doc']);
    expect(columnsOf(raw, 'meetings')).toEqual(['id', 'doc', ...columnNames('meetings')]);
    expect(columnsOf(raw, 'google_connections')).toEqual(['id', 'user_id', 'sealed_token', 'calendar_id', 'state', 'connected_at', 'last_error', 'last_error_at', 'changed_at']);
    expect(columnsOf(raw, 'google_events')).toEqual(['user_id', 'meeting_id', 'event_id', 'synced_rev', 'synced_at']);
    expect(columnsOf(raw, 'google_calendars')).toEqual(['user_id', 'calendar_id', 'changed_at']);
    expect(raw.prepare('select version from schema_version').get()).toEqual({ version: LITE_SCHEMA_VERSION });
  });

  it('steps a version 3 office to the same sub_companies table text as a new office', async () => {
    const { raw } = await freshLite();
    const fresh = raw.prepare("select sql from sqlite_master where name = 'sub_companies'").get();
    raw.exec('drop table sub_companies');
    raw.exec('drop table meetings');
    dropGoogle(raw);
    raw.exec('update schema_version set version = 3');
    raw.exec('alter table messages drop column search_text');
    raw.exec('alter table comments drop column search_text');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [4, 5, 6, 7, 8, 9, 10] });
    expect(raw.prepare("select sql from sqlite_master where name = 'sub_companies'").get()).toEqual(fresh);
  });

  it('steps a version 4 office to the same meetings table and indexes as a new office (fbk_022)', async () => {
    const { raw } = await freshLite();
    const objects = () => raw.prepare("select name, sql from sqlite_master where tbl_name = 'meetings' order by name").all();
    const fresh = objects();
    expect(fresh.map((row) => (row as { name: string }).name)).toEqual(['meetings', 'meetings_project_starts', 'meetings_starts', 'meetings_to_settle', 'sqlite_autoindex_meetings_1']);
    raw.exec('drop table meetings');
    dropGoogle(raw);
    raw.exec('alter table messages drop column search_text');
    raw.exec('alter table comments drop column search_text');
    raw.exec('update schema_version set version = 4');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [5, 6, 7, 8, 9, 10] });
    expect(objects()).toEqual(fresh);
  });

  it('steps a version 5 office to the same messages and comments table texts as a new office', async () => {
    const { raw } = await freshLite();
    const text = (table: string) => raw.prepare('select sql from sqlite_master where name = ?').get(table);
    const fresh = [text('messages'), text('comments')];
    raw.exec('alter table messages drop column search_text');
    raw.exec('alter table comments drop column search_text');
    raw.exec('drop index meetings_to_settle');
    dropGoogle(raw);
    raw.exec('update schema_version set version = 5');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [6, 7, 8, 9, 10] });
    expect([text('messages'), text('comments')]).toEqual(fresh);
    expect(columnsOf(raw, 'messages')).toEqual(['id', 'doc', 'conversation_id', 'created_at', 'search_text']);
    expect(columnsOf(raw, 'comments')).toEqual(['id', 'doc', 'target_type', 'target_id', 'created_at', 'project_id', 'search_text']);
  });

  it('steps a version 6 office to the same settle index as a new office (fbk_022, wave 2)', async () => {
    const { raw } = await freshLite();
    const objects = () => raw.prepare("select name, sql from sqlite_master where tbl_name = 'meetings' order by name").all();
    const fresh = objects();
    expect(fresh.map((row) => (row as { name: string; sql: string }).sql)).toContain(
      "CREATE INDEX meetings_to_settle on meetings (ends_at) where status = 'scheduled' and settled_at is null",
    );
    raw.exec('drop index meetings_to_settle');
    dropGoogle(raw);
    raw.exec('update schema_version set version = 6');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [7, 8, 9, 10] });
    expect(objects()).toEqual(fresh);
  });

  it('steps a version 7 office to the same Google tables and indexes as a new office (fbk_022)', async () => {
    const { raw } = await freshLite();
    const objects = () => raw.prepare("select name, sql from sqlite_master where tbl_name in ('google_connections', 'google_events') order by name").all();
    const fresh = objects();
    expect(fresh.map((row) => (row as { name: string }).name)).toEqual([
      'google_connections', 'google_connections_person', 'google_events', 'google_events_meeting', 'sqlite_autoindex_google_events_1', 'sqlite_autoindex_google_connections_1',
    ].sort());
    dropGoogle(raw);
    raw.exec('update schema_version set version = 7');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [8, 9, 10] });
    expect(objects()).toEqual(fresh);
  });

  it('steps a version 8 office to the same google_calendars table as a new office (fbk_022, one calendar for each person)', async () => {
    const { raw } = await freshLite();
    const objects = () => raw.prepare("select name, sql from sqlite_master where tbl_name = 'google_calendars' order by name").all();
    const fresh = objects();
    expect(fresh.map((row) => (row as { name: string }).name)).toEqual(['google_calendars', 'sqlite_autoindex_google_calendars_1']);
    dropCalendars(raw);
    raw.exec('update schema_version set version = 8');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [9, 10] });
    expect(objects()).toEqual(fresh);
    expect(columnsOf(raw, 'google_calendars')).toEqual(['user_id', 'calendar_id', 'changed_at']);
  });

  it('steps a version 9 office to the same chat_reads_conversation index as a new office (chat presence design C4)', async () => {
    const { raw } = await freshLite();
    const objects = () => raw.prepare("select name, sql from sqlite_master where tbl_name = 'chat_reads' order by name").all();
    const fresh = objects();
    expect(fresh.map((row) => (row as { name: string }).name)).toContain('chat_reads_conversation');
    dropConversationIndex(raw);
    raw.exec('update schema_version set version = 9');
    expect(await applyLiteSchema(nodeHost(raw))).toEqual({ applied: true, steps: [10] });
    expect(objects()).toEqual(fresh);
  });

  it('keeps one calendar for each person (fbk_022)', async () => {
    const { raw } = await freshLite();
    const add = (user: string, calendar: string | null) => raw.prepare("insert into google_calendars (user_id, calendar_id, changed_at) values (?, ?, '2026-10-21T06:00:00.000Z')").run(user, calendar);
    add('usr_003', 'cal-1@group.calendar.google.com');
    expect(() => add('usr_003', 'cal-2@group.calendar.google.com')).toThrow('UNIQUE');
    expect(() => add('usr_004', null)).toThrow('NOT NULL');
    add('usr_004', 'cal-3@group.calendar.google.com');
  });

  it('keeps one live connection for each person, and lets a revoking row live beside it (fbk_022)', async () => {
    const { raw } = await freshLite();
    const add = (id: string, state: string) => raw.prepare("insert into google_connections (id, user_id, state, connected_at, changed_at) values (?, 'usr_003', ?, '2026-10-21T06:00:00.000Z', '2026-10-21T06:00:00.000Z')").run(id, state);
    add('c1', 'ok');
    expect(() => add('c2', 'not_synced')).toThrow('UNIQUE');
    expect(() => add('c3', 'not_a_state')).toThrow('CHECK');
    add('c4', 'revoking');
    add('c5', 'revoking');
    raw.prepare("update google_connections set state = 'revoking' where id = 'c1'").run();
    add('c6', 'broken');
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
    expect({ version: LITE_SCHEMA_VERSION, sha256 }).toEqual({ version: 10, sha256: PINNED_SHA256 });
  });
});
