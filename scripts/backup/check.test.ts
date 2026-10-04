import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_SCHEMAS,
  OUTSIDE_OFFICE_LOCK,
  archiveProblems,
  compareCounts,
  dumpRowCounts,
  filterDataDump,
  parseCheckArgs,
  parseManifest,
  pickKeys,
  restoreErrorLine,
  rolesToMake,
  rolesSql,
  staleNames,
  stampOf,
} from './check';

/**
 * The pure parts of the backup and the restore check (plan 5.7; task O2). scripts/restore-check.test.ts runs the whole check on
 * the local stack [Docker].
 */

const DATA = [
  'SET session_replication_role = replica;',
  'SET statement_timeout = 0;',
  '',
  '--',
  '-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin',
  '--',
  '',
  'COPY "auth"."users" ("instance_id", "id", "email") FROM stdin;',
  '\\N\t1\tsecret@example.com',
  '\\.',
  '',
  'COPY "public"."users" ("id", "ord", "doc") FROM stdin;',
  'usr_001\t1\t{"id": "usr_001"}',
  'usr_002\t2\t{"id": "usr_002", "note": "a line\\nwith an escaped break"}',
  '\\.',
  '',
  'COPY "public"."events" ("id", "ord", "doc") FROM stdin;',
  '\\.',
  '',
  'COPY "storage"."buckets" ("id", "name") FROM stdin;',
  'madar-files\tmadar-files',
  '\\.',
  '',
  'SELECT pg_catalog.setval(\'"auth"."refresh_tokens_id_seq"\', 1, false);',
  'SELECT pg_catalog.setval(\'"public"."users_ord_seq"\', 2, true);',
  '',
  'RESET ALL;',
  '',
].join('\n');

describe('dumpRowCounts', () => {
  it('counts the rows of every COPY block, by schema and table', () => {
    expect(dumpRowCounts(DATA)).toEqual({ 'auth.users': 1, 'public.users': 2, 'public.events': 0, 'storage.buckets': 1 });
  });

  it('refuses a COPY block with no end line, the sign of a cut dump', () => {
    const cut = DATA.slice(0, DATA.indexOf('usr_002'));
    expect(() => dumpRowCounts(cut)).toThrow(/public\.users.*no end/);
  });
});

describe('filterDataDump', () => {
  it('keeps the settings and only the COPY blocks and sequence values of the Madar schemas', () => {
    const kept = filterDataDump(DATA, new Set(BACKUP_SCHEMAS));
    expect(dumpRowCounts(kept)).toEqual({ 'public.users': 2, 'public.events': 0 });
    expect(kept).toContain('SET session_replication_role = replica;');
    expect(kept).toContain('"public"."users_ord_seq"');
    expect(kept).not.toContain('refresh_tokens_id_seq');
    expect(kept).not.toContain('secret@example.com');
    expect(kept).not.toContain('madar-files');
    expect(kept.trimEnd().endsWith('RESET ALL;')).toBe(true);
  });

  it('keeps a data line that looks like a statement, because it sits inside a kept block', () => {
    const tricky = 'COPY "public"."notes" ("id", "doc") FROM stdin;\nn1\tSELECT pg_catalog.setval(\'"auth"."x"\', 1, false);\n\\.\n';
    expect(filterDataDump(tricky, new Set(['public']))).toBe(tricky);
  });
});

describe('rolesToMake', () => {
  it('names each role that the dumps use but do not make, and never a role that roles.sql makes', () => {
    const roles = [
      'CREATE ROLE "madar_server";',
      'ALTER ROLE "madar_server" WITH NOINHERIT NOLOGIN;',
      'ALTER ROLE "anon" SET "statement_timeout" TO \'3s\';',
      'GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin";',
    ].join('\n');
    const schema = [
      'ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";',
      'REVOKE ALL ON TABLE "public"."users" FROM "authenticated";',
      'CREATE POLICY "server_all" ON "public"."users" TO "madar_server" USING (true);',
      'SELECT pg_catalog.set_config(\'search_path\', \'\', false);',
      'ALTER SCHEMA "madar_private" OWNER TO "postgres";',
    ].join('\n');
    expect(rolesToMake(roles, schema)).toEqual(['anon', 'authenticated', 'postgres', 'service_role', 'supabase_realtime_admin']);
  });

  it('writes SQL that makes each role only when it is missing, without login', () => {
    const sql = rolesSql(['supabase_realtime_admin']);
    expect(sql).toContain("rolname = 'supabase_realtime_admin'");
    expect(sql).toContain('create role "supabase_realtime_admin" nologin');
    expect(rolesSql([])).toBe('');
    expect(() => rolesSql(['bad"name'])).toThrow();
  });
});

describe('parseManifest', () => {
  it('reads the manifest that dump.ts writes', () => {
    const text = JSON.stringify({ format: 1, madeAt: '2026-10-04T23:07:00.000Z', lockKey: 7310001, tables: { 'public.users': 12 } });
    expect(parseManifest(text).tables).toEqual({ 'public.users': 12 });
  });

  it('refuses a manifest with a table outside the Madar schemas or a count that is not a whole number', () => {
    expect(() => parseManifest(JSON.stringify({ format: 1, madeAt: 'x', lockKey: 1, tables: { 'auth.users': 1 } }))).toThrow();
    expect(() => parseManifest(JSON.stringify({ format: 1, madeAt: 'x', lockKey: 1, tables: { 'public.users': 1.5 } }))).toThrow();
    expect(() => parseManifest('not json')).toThrow();
  });
});

describe('compareCounts', () => {
  const manifest = { 'public.users': 2, 'public.events': 5 };

  it('passes when the manifest, the dump and the restore agree', () => {
    expect(compareCounts({ manifest, dump: { ...manifest }, restored: { ...manifest } })).toEqual({ problems: [], notes: [] });
  });

  it('names a table that lost rows in the restore', () => {
    expect(compareCounts({ manifest, dump: { ...manifest }, restored: { 'public.users': 2, 'public.events': 4 } }).problems).toEqual([
      'public.events: the dump holds 5 rows, the restore has 4.',
    ]);
  });

  it('names a dump that differs from the manifest, and a table that only one of them has', () => {
    const { problems } = compareCounts({
      manifest,
      dump: { 'public.users': 2, 'public.events': 4, 'public.extra': 0 },
      restored: { 'public.users': 2, 'public.events': 4, 'public.extra': 0 },
    });
    expect(problems).toEqual([
      'public.events: the manifest says 5 rows, the dump and the restore hold 4.',
      'public.extra: the dump holds it, the manifest does not.',
    ]);
  });

  it('names a manifest table that the dump does not hold', () => {
    expect(compareCounts({ manifest, dump: { 'public.users': 2 }, restored: { 'public.users': 2 } }).problems).toEqual([
      'public.events: the manifest has it, the dump does not.',
    ]);
  });

  it('only notes a manifest difference of a table that gets writes outside the office lock, but still fails its restore', () => {
    expect(OUTSIDE_OFFICE_LOCK).toEqual(
      expect.arrayContaining(['public.rate_limits', 'public.upload_intents', 'public.mail_log', 'public.mail_outbox', 'public.stories', 'public.outbox']),
    );
    const loose = { ...manifest, 'public.rate_limits': 3 };
    const dump = { ...manifest, 'public.rate_limits': 4 };
    expect(compareCounts({ manifest: loose, dump, restored: { ...dump } })).toEqual({
      problems: [],
      notes: ['public.rate_limits: the manifest says 3 rows, the dump holds 4 (this table gets writes outside the office lock).'],
    });
    expect(compareCounts({ manifest: loose, dump, restored: { ...dump, 'public.rate_limits': 2 } }).problems).toEqual([
      'public.rate_limits: the dump holds 4 rows, the restore has 2.',
    ]);
  });
});

describe('restoreErrorLine', () => {
  it('keeps only the first ERROR line of psql, without the DETAIL and CONTEXT lines that quote the row', () => {
    const stderr = [
      'psql:/restore/data-madar.sql:812: ERROR:  invalid input syntax for type json',
      'DETAIL:  Token "broken" is invalid.',
      'CONTEXT:  JSON data, line 1: {"id": broken...',
      'COPY users, line 1, column doc: "{"id": broken, "name": "Sara Al-Qahtani", "email": "sara@example.com"}"',
    ].join('\n');
    const line = restoreErrorLine(stderr);
    expect(line).toBe('psql:/restore/data-madar.sql:812: ERROR:  invalid input syntax for type json');
    expect(line).not.toMatch(/broken|Sara|example\.com/);
  });

  it('hides a value that the ERROR line itself quotes, and keeps the name of a constraint', () => {
    expect(restoreErrorLine('psql:/restore/data-madar.sql:9: ERROR:  invalid input syntax for type uuid: "sara@example.com"')).toBe(
      'psql:/restore/data-madar.sql:9: ERROR:  invalid input syntax for type uuid: "(value hidden)"',
    );
    expect(restoreErrorLine('psql:x.sql:3: ERROR:  duplicate key value violates unique constraint "users_pkey"\nDETAIL:  Key (id)=(usr_001) already exists.')).toBe(
      'psql:x.sql:3: ERROR:  duplicate key value violates unique constraint "users_pkey"',
    );
  });

  it('says so when psql gave no ERROR line, and never passes the other text on', () => {
    expect(restoreErrorLine('could not connect: sara@example.com')).toBe('psql gave no ERROR line.');
  });
});

describe('staleNames', () => {
  it('names the leftovers of a check whose process is gone, and keeps those of a live one and the foreign names', () => {
    const alive = (pid: number) => pid === 42;
    const names = ['madar-restore-check-42-a1b2c3', 'madar-restore-check-7-ffffff', 'madar-restore-check-x-1', 'other-7-1'];
    expect(staleNames(names, 'madar-restore-check-', alive)).toEqual(['madar-restore-check-7-ffffff']);
    expect(staleNames(['madar-restore-9-Ab12Cd', 'madar-restore-42-xyz', 'madar-restore-check-9-a'], 'madar-restore-', alive)).toEqual([
      'madar-restore-9-Ab12Cd',
    ]);
  });
});

describe('archiveProblems', () => {
  const good = ['madar-db-20261004-230700Z/', 'madar-db-20261004-230700Z/roles.sql', 'madar-db-20261004-230700Z/schema.sql', 'madar-db-20261004-230700Z/data.sql', 'madar-db-20261004-230700Z/manifest.json'];

  it('accepts the folder of one backup with its four files', () => {
    expect(archiveProblems(good)).toEqual([]);
    expect(archiveProblems(good.slice(1))).toEqual([]);
  });

  it('refuses a missing file, an extra entry and a path that leaves the folder', () => {
    expect(archiveProblems(good.slice(0, 4))).toEqual(['The archive has no manifest.json.']);
    expect(archiveProblems([...good, '../evil.sh'])).toEqual(['The archive holds an entry that a backup does not have: ../evil.sh']);
    expect(archiveProblems([...good, 'madar-db-20261004-230700Z/../../x'])).toHaveLength(1);
    expect(archiveProblems([...good, 'madar-db-other/roles.sql'])).toHaveLength(1);
  });
});

describe('pickKeys', () => {
  it('picks up to n different keys with the given random source', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const picked = pickKeys(keys, 5, (n) => n - 1);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    expect(pickKeys(['a', 'b'], 5, () => 0).sort()).toEqual(['a', 'b']);
    expect(pickKeys([], 5, () => 0)).toEqual([]);
  });
});

describe('stampOf', () => {
  it('names a backup by its UTC time', () => {
    expect(stampOf(new Date('2026-10-04T23:07:05.123Z'))).toBe('20261004-230705Z');
  });
});

describe('parseCheckArgs', () => {
  it('reads the backup file, the key, the file copy and the image', () => {
    const args = parseCheckArgs(['--file', 'b.age', '--key', 'k.txt', '--files-remote', 'madar-copy:current', '--image', 'img:1']);
    expect(args).toEqual({ file: 'b.age', key: 'k.txt', filesRemote: 'madar-copy:current', image: 'img:1' });
  });

  it('asks for the file copy, or for --skip-files on purpose', () => {
    expect(() => parseCheckArgs(['--file', 'b.age', '--key', 'k.txt'])).toThrow(/--files-remote.*--skip-files/);
    expect(parseCheckArgs(['--file', 'b.age', '--key', 'k.txt', '--skip-files']).filesRemote).toBeNull();
  });

  it('names every missing value', () => {
    expect(() => parseCheckArgs([])).toThrow(/--file[\s\S]*--key/);
  });
});

describe('manifest.sql', () => {
  const sql = readFileSync(new URL('./manifest.sql', import.meta.url), 'utf8');

  it('counts the tables of exactly the schemas that the restore check restores', () => {
    const listed = /nspname in \(([^)]*)\)/.exec(sql)?.[1] ?? '';
    expect(listed.split(',').map((part) => part.trim().replace(/'/g, ''))).toEqual([...BACKUP_SCHEMAS]);
  });

  it('gives one column named manifest', () => {
    expect(sql).toMatch(/as manifest\b/);
  });
});
