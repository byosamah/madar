// The nightly database backup (plan 5.7; task O2). .github/workflows/db-backup.yml runs it; scripts/restore-check.test.ts runs
// it on the local stack.
//
//   BACKUP_DB_URL=<session pooler address, as postgres> BACKUP_AGE_RECIPIENT=<age1...> npx tsx scripts/backup/dump.ts --out <dir>
//
// Three dumps with the Supabase CLI (platform facts 11.4): the roles, the schema, and the data with COPY. Before the data dump it
// takes the office lock (the key of pg_advisory_xact_lock that every write of the server takes) as a session lock and counts the
// rows of every Madar table with manifest.sql, so no office write lands between the counts and the dump. It holds the lock only
// for the count and the data dump (seconds); a write waits for it. Then tar, and age to the owner's public key: the file
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

export async function makeBackup(o: BackupOptions): Promise<BackupResult> {
  if (!AGE_RECIPIENT.test(o.recipient)) throw new Error('The age recipient must be a public key that starts with age1.');
  const supabase = o.supabase ?? ['npx', 'supabase'];
  const age = o.age ?? process.env.MADAR_AGE ?? 'age';
  const lockKey = o.lockKey ?? OFFICE_LOCK_KEY;
  const name = `madar-db-${stampOf(o.now ?? new Date())}`;
  const work = mkdtempSync(join(tmpdir(), 'madar-backup-'));
  const folder = join(work, name);
  const secret = [o.dbUrl, decodeURIComponent(new URL(o.dbUrl).password)];
  const dump = (label: string, file: string, more: string[]) =>
    run(label, supabase[0], [...supabase.slice(1), 'db', 'dump', '--db-url', o.dbUrl, '-f', join(folder, file), ...more], { redact: secret });
  try {
    await run('make the backup folder', 'mkdir', ['-m', '700', folder]);
    await dump('the role dump', 'roles.sql', ['--role-only']);
    await dump('the schema dump', 'schema.sql', []);

    const client = new pg.Client(clientConfig(o.dbUrl));
    await client.connect();
    let tables: Record<string, number>;
    try {
      await client.query('select pg_advisory_lock($1::bigint)', [lockKey]);
      try {
        const rows = (await client.query<{ manifest: Record<string, string | number> }>(readFileSync(MANIFEST_SQL, 'utf8'))).rows;
        tables = Object.fromEntries(Object.entries(rows[0].manifest).map(([table, n]) => [table, Number(n)]));
        await dump('the data dump', 'data.sql', ['--use-copy', '--data-only', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes']);
      } finally {
        await client.query('select pg_advisory_unlock($1::bigint)', [lockKey]);
      }
    } finally {
      await client.end();
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
