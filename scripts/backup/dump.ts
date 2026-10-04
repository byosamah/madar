// The nightly database backup (plan 5.7; task O2). .github/workflows/db-backup.yml runs it; scripts/restore-check.test.ts runs
// it on the local stack.
//
//   BACKUP_DB_URL=<session pooler address, as postgres> BACKUP_AGE_RECIPIENT=<age1...> npx tsx scripts/backup/dump.ts --out <dir>
//
// Three dumps of the Supabase CLI (platform facts 11.4): the roles, the schema, and the data with COPY. For a remote database the
// CLI only prints its pg_dump script (--dry-run), and this script runs it with the local pg_dump 17 under verify-full and the
// Supabase root certificate: the CLI itself starts pg_dump with PGHOST and PGPASSWORD but no TLS mode, so libpq would use
// "prefer" and check no certificate. On this machine (the tests) the CLI runs the dump itself.
//
// Before the data dump it opens a transaction, takes the office lock (pg_advisory_xact_lock, the key that every office write of
// the server takes) and counts the rows of every Madar table with manifest.sql, so no office write lands between the counts and
// the dump. The transaction ends after the data dump, which has a time limit of DATA_DUMP_TIMEOUT_MS. An office write in that
// window waits for its lock_timeout (5 s, server/data/sql.ts), then fails as busy and the person tries again. If this client is
// lost, idle_in_transaction_session_timeout ends its session and Postgres frees the lock by itself; a transaction lock never
// stays on a pooled backend the way a session lock can. Then tar, and age to the owner's public key: the file
// madar-db-<stamp>.tar.gz.age in --out. The plain dump lives only in a private temporary folder, which it removes.
// It prints one JSON line with the file, the name and the number of tables and rows. It never prints the address.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { stampOf, type Manifest } from './check';
import { run } from './run';

/** The office lock key of the server (DEFAULT_LOCK_KEY of server/core/deps.ts; dump.test.ts keeps them equal). */
export const OFFICE_LOCK_KEY = 7_310_001;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
/** The public Supabase root certificate, as scripts/first-admin.ts uses it for the pooler. */
const SUPABASE_CA = new URL('../proof/supabase-root-2021-ca.crt', import.meta.url);
const MANIFEST_SQL = new URL('./manifest.sql', import.meta.url);
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
/** The time limit of the data dump. The office lock is held for it, so office writes fail as busy until it ends. */
export const DATA_DUMP_TIMEOUT_MS = 5 * 60_000;
/** The idle cap of the lock transaction: longer than the data dump, so only a lost client meets it. */
export const IDLE_CAP_MS = 6 * 60_000;
/** How long the backup waits for the office lock while an office write holds it. */
const LOCK_WAIT = '60s';

export type BackupOptions = {
  dbUrl: string;
  recipient: string;
  outDir: string;
  lockKey?: number;
  now?: Date;
  /** The Supabase CLI command (default: npx supabase). */
  supabase?: string[];
  /** The age program (default: MADAR_AGE or age). */
  age?: string;
  /** The shell that runs the pg_dump script for a remote database, from stdin (default: bash -s). */
  shell?: string[];
};

export type BackupResult = { file: string; name: string; tables: number; rows: number };

/** The pg settings for the address: TLS with the Supabase root certificate, except on this machine. */
export function clientConfig(dbUrl: string): pg.ClientConfig {
  const url = new URL(dbUrl);
  const config: pg.ClientConfig = {
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
    connectionTimeoutMillis: 15_000,
  };
  if (!LOCAL_HOSTS.has(url.hostname)) config.ssl = { ca: readFileSync(SUPABASE_CA, 'utf8'), rejectUnauthorized: true, servername: url.hostname };
  return config;
}

/**
 * One dump into file. A remote database: the CLI prints its pg_dump script, and shell runs it with PGSSLMODE=verify-full and
 * PGSSLROOTCERT, which the script does not set, so pg_dump checks the certificate and the host name. This machine: the CLI runs
 * the dump itself.
 */
export async function dumpOne(o: {
  dbUrl: string;
  label: string;
  file: string;
  flags: string[];
  supabase?: string[];
  shell?: string[];
  timeoutMs?: number;
}): Promise<void> {
  const supabase = o.supabase ?? ['npx', 'supabase'];
  const redact = [o.dbUrl, decodeURIComponent(new URL(o.dbUrl).password)];
  const cli = [...supabase.slice(1), 'db', 'dump', '--db-url', o.dbUrl];
  if (LOCAL_HOSTS.has(new URL(o.dbUrl).hostname)) {
    await run(o.label, supabase[0], [...cli, '-f', o.file, ...o.flags], { redact, timeoutMs: o.timeoutMs });
    return;
  }
  const script = (await run(`${o.label} (the script of the CLI)`, supabase[0], [...cli, '--dry-run', ...o.flags], { redact })).stdout;
  const shell = o.shell ?? ['bash', '-s'];
  const env = { ...process.env, PGSSLMODE: 'verify-full', PGSSLROOTCERT: fileURLToPath(SUPABASE_CA), PGCONNECT_TIMEOUT: '15' };
  await run(o.label, shell[0], shell.slice(1), { input: script, env, stdoutFile: o.file, redact, timeoutMs: o.timeoutMs });
}

export async function makeBackup(o: BackupOptions): Promise<BackupResult> {
  if (!AGE_RECIPIENT.test(o.recipient)) throw new Error('The age recipient must be a public key that starts with age1.');
  const age = o.age ?? process.env.MADAR_AGE ?? 'age';
  const lockKey = o.lockKey ?? OFFICE_LOCK_KEY;
  const name = `madar-db-${stampOf(o.now ?? new Date())}`;
  const work = mkdtempSync(join(tmpdir(), 'madar-backup-'));
  const folder = join(work, name);
  const dump = (label: string, file: string, flags: string[], timeoutMs?: number) =>
    dumpOne({ dbUrl: o.dbUrl, label, file: join(folder, file), flags, supabase: o.supabase, shell: o.shell, timeoutMs });
  try {
    await run('make the backup folder', 'mkdir', ['-m', '700', folder]);
    await dump('the role dump', 'roles.sql', ['--role-only']);
    await dump('the schema dump', 'schema.sql', []);

    const client = new pg.Client(clientConfig(o.dbUrl));
    await client.connect();
    let tables: Record<string, number>;
    try {
      await client.query('begin');
      let committed = false;
      try {
        await client.query(`set local idle_in_transaction_session_timeout = '${IDLE_CAP_MS / 1000}s'`);
        await client.query(`set local lock_timeout = '${LOCK_WAIT}'`);
        await client.query('select pg_advisory_xact_lock($1::bigint)', [lockKey]);
        const rows = (await client.query<{ manifest: Record<string, string | number> }>(readFileSync(MANIFEST_SQL, 'utf8'))).rows;
        tables = Object.fromEntries(Object.entries(rows[0].manifest).map(([table, n]) => [table, Number(n)]));
        await dump('the data dump', 'data.sql', ['--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes'], DATA_DUMP_TIMEOUT_MS);
        // A commit that fails (the idle cap ended the session) fails the backup: the counts may not match the dump.
        await client.query('commit');
        committed = true;
      } finally {
        if (!committed) await client.query('rollback').catch(() => undefined);
      }
    } finally {
      await client.end().catch(() => undefined);
    }

    const manifest: Manifest = { format: 1, madeAt: (o.now ?? new Date()).toISOString(), lockKey, tables };
    writeFileSync(join(folder, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const archive = join(work, `${name}.tar.gz`);
    await run('tar', 'tar', ['-C', work, '-czf', archive, name]);
    const file = resolve(o.outDir, `${name}.tar.gz.age`);
    await run('age', age, ['-r', o.recipient, '-o', file, archive]);
    return { file, name, tables: Object.keys(tables).length, rows: Object.values(tables).reduce((sum, n) => sum + n, 0) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main(argv: string[]): Promise<void> {
  const at = argv.indexOf('--out');
  const outDir = at === -1 ? '' : (argv[at + 1] ?? '');
  const dbUrl = process.env.BACKUP_DB_URL ?? '';
  const recipient = (process.env.BACKUP_AGE_RECIPIENT ?? '').trim();
  const problems = [
    ...(outDir === '' ? ['--out <folder> is missing.'] : []),
    ...(dbUrl === '' ? ['BACKUP_DB_URL is missing.'] : []),
    ...(recipient === '' ? ['BACKUP_AGE_RECIPIENT is missing.'] : []),
  ];
  if (problems.length > 0) throw new Error(problems.join('\n'));
  console.log(JSON.stringify(await makeBackup({ dbUrl, recipient, outDir })));
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
