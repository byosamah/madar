// The monthly restore check (plan 5.7, change 12; task O2). It runs on the owner's Mac, because only the Mac has the offline age
// key. The reminder issue (.github/workflows/restore-reminder.yml) gives the steps.
//
//   gh release download --repo byosamah/madar-backups --pattern '*.age' --dir ~/Downloads/madar-backup     (the newest backup)
//   npx tsx scripts/restore-check.ts --file <madar-db-....tar.gz.age> --key <age key file> --files-remote <rclone path>
//
// --files-remote is the rclone path of the weekly file copy, for example madar-copy:current (the crypt remote over the B2 bucket,
// in the owner's rclone config). --skip-files only when no file copy exists yet. --image takes another Postgres image.
// Needs: Docker, age, tar, and rclone for the file step.
//
// Steps: decrypt with the key, check the archive entries, unpack into a private temporary folder, start a Postgres container
// (the Supabase image, on 127.0.0.1 only), restore the roles, the schema and the data of the Madar schemas, compare the row counts
// with the manifest and the dump, check that madar_server has no right to change events and that UPDATE on events fails for it
// and for the owner, run dashboard.get through runCall as madar_server for an active Admin, and look up 5 random file keys in
// the file copy with their sizes. The file step samples only versions older than the backup minus 8 days, because the weekly
// copy (Friday) cannot hold newer uploads yet.
// It prints one JSON report with no client data (a failed restore shows only the psql ERROR line, never the row), removes the
// container and the plain dump, also on Ctrl-C, and exits 1 when a step fails. At the start it removes what a stopped run left.
import { spawnSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { runCall } from '../server/core/runCall';
import { FILE_STORE_LIMITS, type Deps, type Logger } from '../server/core/ports';
import { pgDb } from '../server/data/sql';
import {
  BACKUP_SCHEMAS,
  archiveProblems,
  compareCounts,
  dumpRowCounts,
  filterDataDump,
  parseCheckArgs,
  parseManifest,
  pickKeys,
  restoreErrorLine,
  rolesSql,
  rolesToMake,
  staleNames,
} from './backup/check';
import { run } from './backup/run';

export type Step = { step: string; ok: boolean; detail: string };
export type CheckReport = { ok: boolean; steps: Step[] };

export type CheckOptions = {
  file: string;
  key: string;
  /** The rclone path of the file copy, or null to skip the file step on purpose. */
  filesRemote: string | null;
  image: string;
  /** How many file keys to look up (default 5). */
  fileSample?: number;
  /** A whole number from 0 to below - 1 (default: crypto randomInt). */
  random?: (below: number) => number;
  age?: string;
  rclone?: string;
  docker?: string;
};

/** Stops the check at a step that the later steps need. */
class Stop extends Error {}

/** The weekly file copy runs every 7 days; one more day covers a late run. A version this much older than the backup is in it. */
const COPY_LAG_MS = 8 * 24 * 3600_000;

/** What a running check must remove when the process gets SIGINT or SIGTERM: Node skips the finally blocks then. */
const cleanups = new Set<() => void>();

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** Removes the private folders and the containers of earlier checks whose process is gone (a stopped run, a crash). */
function removeLeftovers(docker: string): void {
  for (const name of staleNames(readdirSync(tmpdir()), 'madar-restore-', isAlive)) rmSync(join(tmpdir(), name), { recursive: true, force: true });
  const listed = spawnSync(docker, ['ps', '-a', '--filter', 'name=madar-restore-check-', '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 30_000 });
  if (listed.status !== 0) return;
  const names = listed.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  for (const name of staleNames(names, 'madar-restore-check-', isAlive)) spawnSync(docker, ['rm', '-f', '-v', name], { stdio: 'ignore', timeout: 60_000 });
}

/** The office lock key of the server; a read does not take it, but the config needs one. */
const LOCK_KEY = 7_310_001;

/** Ports that refuse: dashboard.get reads only, so it never reaches them. */
function readOnlyDeps(db: Deps['db']): Deps {
  const refuse = (what: string) => () => {
    throw new Error(`The restore check reads only; it does not ${what}.`);
  };
  const quiet: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const local = 'http://127.0.0.1';
  return {
    db,
    clock: { now: () => new Date() },
    files: {
      kind: 'supabase',
      maxFileBytes: FILE_STORE_LIMITS.supabase.maxFileBytes,
      presignPut: refuse('sign an upload'),
      presignGet: refuse('sign a download'),
      head: refuse('read a file'),
      copy: refuse('copy a file'),
      remove: refuse('remove a file'),
    },
    mail: { send: refuse('send mail') },
    signal: { send: async () => undefined },
    authAdmin: {
      generateLink: refuse('make a sign-in link'),
      createUser: refuse('make a person'),
      setBanned: refuse('turn a person off'),
      updateEmail: refuse('change an email'),
      listUsers: refuse('list the Auth users'),
      getUser: refuse('read an Auth user'),
    },
    meter: { addBytes: () => undefined, countRequest: async () => undefined, signalsFailed: () => undefined },
    config: {
      lockKey: LOCK_KEY,
      appUrl: local,
      apiUrl: local,
      mcpUrl: local,
      supabaseUrl: local,
      mailFrom: 'Madar <restore-check@madar.invalid>',
      minClientBuild: '0',
      allowedOrigins: [],
      region: 'restore-check',
      forwardRegion: 'eu-central-1',
      fileStore: 'supabase',
      limits: { maxFileBytes: FILE_STORE_LIMITS.supabase.maxFileBytes, filesTotalBytes: FILE_STORE_LIMITS.supabase.totalBytes },
      servingHost: 'supabase',
    },
    log: quiet,
  };
}

const quote = (name: string) => name.split('.').map((part) => `"${part}"`).join('.');

export async function restoreCheck(o: CheckOptions): Promise<CheckReport> {
  const steps: Step[] = [];
  const pass = (step: string, detail: string) => steps.push({ step, ok: true, detail });
  const fail = (step: string, detail: string) => steps.push({ step, ok: false, detail });
  const age = o.age ?? process.env.MADAR_AGE ?? 'age';
  const rclone = o.rclone ?? 'rclone';
  const docker = o.docker ?? 'docker';
  const random = o.random ?? ((below: number) => randomInt(below));
  removeLeftovers(docker);
  const work = mkdtempSync(join(tmpdir(), `madar-restore-${process.pid}-`));
  const container = `madar-restore-check-${process.pid}-${randomBytes(3).toString('hex')}`;
  const adminPassword = randomBytes(18).toString('hex');
  const serverPassword = randomBytes(18).toString('hex');
  let started = false;
  let admin: pg.Client | undefined;
  const cleanNow = () => {
    if (started) spawnSync(docker, ['rm', '-f', '-v', container], { stdio: 'ignore', timeout: 60_000 });
    rmSync(work, { recursive: true, force: true });
  };
  cleanups.add(cleanNow);

  const attempt = async (step: string, job: () => Promise<string>, how: { stop?: boolean } = {}) => {
    try {
      pass(step, await job());
    } catch (error) {
      fail(step, error instanceof Error ? error.message : String(error));
      if (how.stop) throw new Stop(step);
    }
  };

  try {
    // 1. Decrypt. age checks the whole file, so a changed byte fails here.
    const archive = join(work, 'backup.tar.gz');
    await attempt('decrypt', async () => {
      await run('age --decrypt', age, ['--decrypt', '-i', o.key, '-o', archive, o.file]);
      return 'The key opened the backup.';
    }, { stop: true });

    // 2. The archive holds one backup folder with its four files, and nothing else.
    let folder = '';
    await attempt('archive', async () => {
      const entries = (await run('tar -t', 'tar', ['-tzf', archive])).stdout.split('\n').map((line) => line.trim());
      const problems = archiveProblems(entries);
      if (problems.length > 0) throw new Error(problems.join(' '));
      await run('tar -x', 'tar', ['-xzf', archive, '-C', work]);
      folder = join(work, entries.find((entry) => entry !== '')!.split('/')[0]);
      return `One backup: ${folder.split('/').pop()}.`;
    }, { stop: true });

    const roles = readFileSync(join(folder, 'roles.sql'), 'utf8');
    const schema = readFileSync(join(folder, 'schema.sql'), 'utf8');
    const data = readFileSync(join(folder, 'data.sql'), 'utf8');
    let manifest: Record<string, number> = {};
    let madeAt = new Date(Number.NaN);
    let dump: Record<string, number> = {};
    await attempt('manifest', async () => {
      const parsed = parseManifest(readFileSync(join(folder, 'manifest.json'), 'utf8'));
      manifest = parsed.tables;
      madeAt = new Date(parsed.madeAt);
      const madar = new Set<string>(BACKUP_SCHEMAS);
      dump = Object.fromEntries(Object.entries(dumpRowCounts(data)).filter(([name]) => madar.has(name.split('.')[0])));
      return `${Object.keys(manifest).length} tables in the manifest.`;
    }, { stop: true });

    // 3. A Postgres container on 127.0.0.1 only, then the restore in one transaction as the superuser of the image.
    let port = 0;
    await attempt('container', async () => {
      // Before the run, so a stop during docker run still removes the container.
      started = true;
      await run('docker run', docker, ['run', '-d', '--name', container, '-e', `POSTGRES_PASSWORD=${adminPassword}`, '-p', '127.0.0.1::5432', o.image], { redact: [adminPassword] });
      port = Number((await run('docker port', docker, ['port', container, '5432/tcp'])).stdout.trim().split('\n')[0].split(':').pop());
      const deadline = Date.now() + 90_000;
      for (;;) {
        try {
          admin = new pg.Client({ host: '127.0.0.1', port, user: 'supabase_admin', password: adminPassword, database: 'postgres' });
          await admin.connect();
          await admin.query('select 1');
          break;
        } catch (error) {
          await admin?.end().catch(() => undefined);
          admin = undefined;
          if (Date.now() > deadline) throw error;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
      return `${o.image} answers on 127.0.0.1.`;
    }, { stop: true });

    await attempt('restore', async () => {
      writeFileSync(join(folder, 'roles-first.sql'), `${rolesSql(rolesToMake(roles, schema))}\n`);
      writeFileSync(join(folder, 'data-madar.sql'), filterDataDump(data, new Set(BACKUP_SCHEMAS)));
      await run('docker exec mkdir', docker, ['exec', container, 'mkdir', '-p', '/restore']);
      for (const file of ['roles-first.sql', 'roles.sql', 'schema.sql', 'data-madar.sql']) {
        await run('docker cp', docker, ['cp', join(folder, file), `${container}:/restore/${file}`]);
      }
      await run('psql restore', docker, [
        'exec', '-e', `PGPASSWORD=${adminPassword}`, container,
        'psql', '-X', '-q', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '--single-transaction', '-v', 'ON_ERROR_STOP=1',
        '-f', '/restore/roles-first.sql', '-f', '/restore/roles.sql', '-f', '/restore/schema.sql', '-f', '/restore/data-madar.sql',
      ], { redact: [adminPassword], errorText: restoreErrorLine });
      return 'The roles, the schema and the data of the Madar schemas restored in one transaction.';
    }, { stop: true });

    const sql = async <R extends pg.QueryResultRow>(text: string, values?: unknown[]) => (await admin!.query<R>(text, values)).rows;

    // 4. Row counts: the restore against the dump, and the dump against the manifest.
    await attempt('counts', async () => {
      const restored: Record<string, number> = {};
      for (const name of new Set([...Object.keys(manifest), ...Object.keys(dump)])) {
        const exists = (await sql<{ t: string | null }>('select to_regclass($1)::text as t', [quote(name)]))[0].t;
        if (exists !== null) restored[name] = Number((await sql<{ n: string }>(`select count(*) as n from ${quote(name)}`))[0].n);
      }
      const { problems, notes } = compareCounts({ manifest, dump, restored });
      if (problems.length > 0) throw new Error([...problems, ...notes].join(' '));
      const rows = Object.values(restored).reduce((sum, n) => sum + n, 0);
      return [`${Object.keys(restored).length} tables and ${rows} rows match the manifest.`, ...notes].join(' ');
    });

    // 5. The History only grows: madar_server has no right to change events, and the trigger refuses even the owner. The
    // rights come first: the trigger answers with the same code 42501, and it cannot stop TRUNCATE.
    await attempt('events guard', async () => {
      const rights = await sql<{ name: string }>(
        "select name from unnest(array['UPDATE', 'DELETE', 'TRUNCATE']) as name where has_table_privilege('madar_server', 'public.events', name)",
      );
      if (rights.length > 0) throw new Error(`madar_server has the right ${rights.map((r) => r.name).join(', ')} on events.`);
      const refusal = async (asServer: boolean) => {
        await admin!.query('begin');
        try {
          if (asServer) await admin!.query('set local role madar_server');
          await admin!.query('update public.events set doc = doc where id = (select id from public.events order by ord limit 1)');
          return null;
        } catch (error) {
          return error as { code?: string; message?: string };
        } finally {
          await admin!.query('rollback');
        }
      };
      const server = await refusal(true);
      if (server?.code !== '42501') throw new Error(`UPDATE on events as madar_server did not fail with a missing right (${server?.code ?? 'it worked'}).`);
      const events = Number((await sql<{ n: string }>('select count(*) as n from public.events'))[0].n);
      if (events === 0) return 'madar_server cannot change events. The office has no event, so the trigger had no row to refuse.';
      const owner = await refusal(false);
      if (!owner?.message?.includes('events only grow')) throw new Error(`UPDATE on events as the owner did not meet the trigger (${owner?.message ?? 'it worked'}).`);
      return 'madar_server cannot change events, and the trigger refuses the owner.';
    });

    // 6. dashboard.get through runCall, as madar_server, for the first active Admin.
    await attempt('dashboard.get', async () => {
      const people = Number((await sql<{ n: string }>('select count(*) as n from public.users'))[0].n);
      if (people === 0) return 'Skipped: the restored office has no person yet.';
      const admins = await sql<{ id: string }>("select id from public.users where active and kind = 'human' and doc->>'systemRole' = 'admin' order by ord limit 1");
      if (admins.length === 0) throw new Error('The restored office has people but no active Admin.');
      await admin!.query(`alter role madar_server login password '${serverPassword}'`);
      const url = `postgresql://madar_server:${serverPassword}@127.0.0.1:${port}/postgres`;
      const db = pgDb({ writeUrl: url, readUrl: url });
      try {
        const result = await runCall(readOnlyDeps(db), {
          principal: { userId: admins[0].id },
          name: 'dashboard.get',
          input: {},
          batch: { storyRefs: new Map(), overviewCalls: 0 },
        });
        if (!result.ok) throw new Error(`dashboard.get failed: ${result.error.code}.`);
      } finally {
        await db.close();
      }
      return 'dashboard.get ran on the restored data for an active Admin.';
    });

    // 7. Five random file keys of the restored office are in the file copy, with the same size. Only versions that the last weekly
    // copy can hold: older than the backup minus 8 days.
    await attempt('files', async () => {
      if (o.filesRemote === null) return 'Skipped on purpose (--skip-files).';
      if (Number.isNaN(madeAt.getTime())) throw new Error('The manifest has no valid time, so the check cannot tell which files the copy holds.');
      // The remote must answer first, so a wrong remote name or a missing rclone never looks like lost files.
      const remote = o.filesRemote.replace(/\/$/, '');
      const remoteRoot = remote.includes(':') ? remote.slice(0, remote.indexOf(':') + 1) : remote;
      try {
        await run('rclone lsf', rclone, ['lsf', '--max-depth', '1', remoteRoot]);
      } catch (error) {
        throw new Error(`The file copy cannot be read: ${error instanceof Error ? error.message : String(error)}`);
      }
      const cutoff = new Date(madeAt.getTime() - COPY_LAG_MS);
      const versions = await sql<{ key: string; size: string; newer: boolean | null }>(
        "select v->>'blobKey' as key, v->>'size' as size, (v->>'uploadedAt')::timestamptz >= $1 as newer from public.files f, jsonb_array_elements(f.doc->'versions') v where v->>'blobKey' is not null",
        [cutoff.toISOString()],
      );
      const newer = versions.filter((v) => v.newer === true).length;
      const skipped = newer === 0 ? '' : ` ${newer} newer file versions were skipped: the weekly copy cannot hold them yet.`;
      if (versions.length === 0) return 'The restored office has no file yet.';
      const sizes = new Map(versions.filter((v) => v.newer !== true).map((v) => [v.key, Number(v.size)]));
      if (sizes.size === 0) return `No file version is old enough for the weekly copy yet.${skipped}`;
      const picked = pickKeys([...sizes.keys()], o.fileSample ?? 5, random);
      const problems: string[] = [];
      for (const key of picked) {
        try {
          const found = JSON.parse((await run('rclone lsjson', rclone, ['lsjson', '--stat', `${remote}/${key}`])).stdout) as { Size?: number };
          if (found.Size !== sizes.get(key)) problems.push(`${key}: ${found.Size ?? 'no'} bytes in the copy, ${sizes.get(key)} in the office.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          problems.push(/not found|doesn't exist|no such file/i.test(message) ? `${key}: not in the copy.` : `${key}: rclone could not read it (${message}).`);
        }
      }
      if (problems.length > 0) throw new Error(problems.join(' '));
      return `${picked.length} of ${sizes.size} file keys are in the copy with their sizes.${skipped}`;
    });
  } catch (error) {
    if (!(error instanceof Stop)) fail('check', error instanceof Error ? error.message : String(error));
  } finally {
    await admin?.end().catch(() => undefined);
    if (started) await run('docker rm', docker, ['rm', '-f', '-v', container]).catch(() => undefined);
    rmSync(work, { recursive: true, force: true });
    cleanups.delete(cleanNow);
  }
  return { ok: steps.length > 0 && steps.every((s) => s.ok), steps };
}

async function main(argv: string[]): Promise<void> {
  const args = parseCheckArgs(argv);
  // Ctrl-C (130) or SIGTERM (143): remove the container and the plain dump before the process ends.
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    process.once(signal, () => {
      for (const clean of cleanups) {
        try {
          clean();
        } catch {
          // Remove what can be removed; the next run removes the rest.
        }
      }
      console.error('Stopped. The container and the plain dump are removed.');
      process.exit(code);
    });
  }
  const report = await restoreCheck(args);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
