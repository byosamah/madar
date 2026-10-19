import { z } from 'zod';

/**
 * The pure parts of the database backup and the restore check (plan 5.7; task O2). scripts/backup/dump.ts makes the backup,
 * scripts/restore-check.ts restores it into a Postgres container on the Mac.
 *
 * What the restore check restores: the roles, the schema dump, and the data of the Madar schemas only. The data dump also holds
 * the auth, storage and supabase_functions rows, but a bare Postgres container does not have the tables that the Supabase
 * services make (Auth adds its own columns), so those rows wait for the one hand restore into the second Supabase project (Z5).
 */

/** The schemas whose data the restore check restores and counts. manifest.sql lists the same names (check.test.ts keeps them equal). */
export const BACKUP_SCHEMAS = ['public', 'madar_private'] as const;

/** The four files of one backup, inside the folder madar-db-<stamp>. */
export const BACKUP_FILES = ['roles.sql', 'schema.sql', 'data.sql', 'manifest.json'] as const;

const COPY_LINE = /^COPY "([^"]+)"\."([^"]+)" .* FROM stdin;$/;
const SETVAL_LINE = /^SELECT pg_catalog\.setval\('"([^"]+)"\./;
const END_OF_COPY = '\\.';

/** The rows of every COPY block of a data dump (pg_dump --data-only with COPY), as "schema.table". */
export function dumpRowCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  let open: string | null = null;
  for (const line of text.split('\n')) {
    if (open !== null) {
      if (line === END_OF_COPY) open = null;
      else counts[open] += 1;
      continue;
    }
    const copy = COPY_LINE.exec(line);
    if (copy) {
      open = `${copy[1]}.${copy[2]}`;
      counts[open] = 0;
    }
  }
  if (open !== null) throw new Error(`The data dump is cut: the rows of ${open} have no end line.`);
  return counts;
}

/**
 * The data dump with only the COPY blocks and the sequence values of the given schemas. Every other line outside a COPY block
 * (the SET lines, the comments, RESET ALL) stays.
 */
export function filterDataDump(text: string, schemas: ReadonlySet<string>): string {
  const kept: string[] = [];
  let inBlock: 'keep' | 'drop' | null = null;
  for (const line of text.split('\n')) {
    if (inBlock !== null) {
      if (inBlock === 'keep') kept.push(line);
      if (line === END_OF_COPY) inBlock = null;
      continue;
    }
    const copy = COPY_LINE.exec(line);
    if (copy) {
      inBlock = schemas.has(copy[1]) ? 'keep' : 'drop';
      if (inBlock === 'keep') kept.push(line);
      continue;
    }
    const setval = SETVAL_LINE.exec(line);
    if (setval && !schemas.has(setval[1])) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

const ROLE_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * The roles that the dumps name but roles.sql does not make. A bare Postgres container lacks some of them (for example the role
 * of the Realtime service), so the restore makes each one that is missing, without login, before roles.sql runs.
 */
export function rolesToMake(roles: string, schema: string): string[] {
  const made = new Set([...roles.matchAll(/CREATE ROLE "([^"]+)"/g)].map((match) => match[1]));
  const named = new Set<string>();
  for (const text of [roles, schema]) {
    // A quoted name with a dot after it is a schema-qualified object ('FROM "public"."events"' of CREATE STATISTICS), never a role.
    for (const match of text.matchAll(/\b(?:TO|FROM|ROLE|AUTHORIZATION)\s+"([^"]+)"(?!\.)/g)) {
      if (ROLE_NAME.test(match[1]) && !made.has(match[1])) named.add(match[1]);
    }
  }
  return [...named].sort();
}

/** SQL that makes each role only when it does not exist. */
export function rolesSql(names: string[]): string {
  return names
    .map((name) => {
      if (!ROLE_NAME.test(name)) throw new Error(`Not a role name: ${name}`);
      return `do $$ begin if not exists (select 1 from pg_roles where rolname = '${name}') then create role "${name}" nologin; end if; end $$;`;
    })
    .join('\n');
}

const TABLE_NAME = new RegExp(`^(${BACKUP_SCHEMAS.join('|')})\\.[a-z_][a-z0-9_]*$`);

export const Manifest = z.object({
  format: z.literal(1),
  madeAt: z.string(),
  lockKey: z.number().int(),
  tables: z.record(z.string().regex(TABLE_NAME), z.number().int().min(0)),
});
export type Manifest = z.infer<typeof Manifest>;

export function parseManifest(text: string): Manifest {
  return Manifest.parse(JSON.parse(text));
}

/**
 * The tables that get writes without the office lock: rate_limits (POST /api/auth/forgot, which anyone can call), upload_intents
 * (files.uploadStart), stories (story.start), outbox (the effects of a call, after its commit), mail_log (the mail lock) and
 * mail_outbox (the mail path), and google_connections and google_events (the effects gcal.sync and gcal.revoke, fbk_022). A row can land
 * in one of them between the counts of dump.ts and the snapshot of the data dump.
 */
export const OUTSIDE_OFFICE_LOCK: readonly string[] = [
  'public.google_connections',
  'public.google_events',
  'public.mail_log',
  'public.mail_outbox',
  'public.outbox',
  'public.rate_limits',
  'public.stories',
  'public.upload_intents',
];

/**
 * The differences between the manifest (the live counts that dump.ts took under the office lock), the data dump and the restored
 * tables. No problem is a pass. A table that the restore lost rows of is a broken restore; a dump that differs from the manifest
 * means a write landed during the dump that did not wait for the office lock. For a table of OUTSIDE_OFFICE_LOCK that is
 * expected, so its manifest difference is only a note; its restore must still match the dump.
 */
export function compareCounts(o: { manifest: Record<string, number>; dump: Record<string, number>; restored: Record<string, number> }): {
  problems: string[];
  notes: string[];
} {
  const problems: string[] = [];
  const notes: string[] = [];
  const names = [...new Set([...Object.keys(o.manifest), ...Object.keys(o.dump)])].sort();
  for (const name of names) {
    const inManifest = Object.hasOwn(o.manifest, name);
    const dump = o.dump[name];
    if (dump === undefined) {
      problems.push(`${name}: the manifest has it, the dump does not.`);
      continue;
    }
    if (!inManifest) problems.push(`${name}: the dump holds it, the manifest does not.`);
    const restored = o.restored[name];
    if (restored === undefined) problems.push(`${name}: the restore does not have it.`);
    else if (restored !== dump) problems.push(`${name}: the dump holds ${dump} rows, the restore has ${restored}.`);
    if (inManifest && o.manifest[name] !== dump) {
      if (OUTSIDE_OFFICE_LOCK.includes(name)) {
        notes.push(`${name}: the manifest says ${o.manifest[name]} rows, the dump holds ${dump} (this table gets writes outside the office lock).`);
      } else {
        problems.push(
          restored === dump
            ? `${name}: the manifest says ${o.manifest[name]} rows, the dump and the restore hold ${dump}.`
            : `${name}: the manifest says ${o.manifest[name]} rows, the dump holds ${dump}.`,
        );
      }
    }
  }
  return { problems, notes };
}

/**
 * The one line of a failed restore that the report may show: the first ERROR line of psql. The DETAIL and CONTEXT lines go,
 * because Postgres quotes up to 100 bytes of the broken row there (a name, an email). A value that the ERROR line quotes after
 * a colon (invalid input syntax for type uuid: "...") is hidden too.
 */
export function restoreErrorLine(stderr: string): string {
  const line = stderr.split('\n').find((text) => /\bERROR:/.test(text));
  if (line === undefined) return 'psql gave no ERROR line.';
  return line.trim().replace(/: ".*$/, ': "(value hidden)"');
}

/**
 * The leftovers of a stopped restore check: the names <prefix><pid>-<suffix> whose process is gone. A name of a live process
 * stays, so two checks at once never remove each other's container or folder.
 */
export function staleNames(names: string[], prefix: string, alive: (pid: number) => boolean): string[] {
  return names.filter((name) => {
    if (!name.startsWith(prefix)) return false;
    const match = /^([0-9]+)-/.exec(name.slice(prefix.length));
    return match !== null && !alive(Number(match[1]));
  });
}

/** What is wrong with the entries of a backup archive (tar -t), before anything is unpacked. */
export function archiveProblems(entries: string[]): string[] {
  const problems: string[] = [];
  const folders = new Set<string>();
  const files = new Set<string>();
  for (const entry of entries.filter((line) => line !== '')) {
    const match = /^(madar-db-[0-9]{8}-[0-9]{6}Z)\/([a-z.]*)$/.exec(entry);
    if (!match || (match[2] !== '' && !(BACKUP_FILES as readonly string[]).includes(match[2]))) {
      problems.push(`The archive holds an entry that a backup does not have: ${entry}`);
      continue;
    }
    folders.add(match[1]);
    if (match[2] !== '') files.add(match[2]);
  }
  if (folders.size > 1) problems.push('The archive holds more than one backup folder.');
  for (const name of BACKUP_FILES) if (!files.has(name)) problems.push(`The archive has no ${name}.`);
  return problems;
}

/** Up to n different keys, chosen with random(n) (a whole number from 0 to n - 1). */
export function pickKeys(keys: string[], n: number, random: (below: number) => number): string[] {
  const left = [...new Set(keys)];
  const picked: string[] = [];
  while (picked.length < n && left.length > 0) picked.push(left.splice(random(left.length), 1)[0]);
  return picked;
}

/** The name of a backup: its UTC time, for example 20261004-230700Z. */
export function stampOf(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}Z`;
}

/** The Postgres image of the restore: the image of the local Supabase stack (CLI 2.119.0). --image takes another one. */
export const DEFAULT_RESTORE_IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.002';

/**
 * filesLagDays: the file step samples only versions older than the backup minus this many days. 8 for the weekly copy (B2, Friday);
 * 0 for R2 alone (exit wave 4, owner decision 5), where the live bucket holds every file.
 */
export type CheckArgs = { file: string; key: string; filesRemote: string | null; image: string; filesLagDays: number };

export function parseCheckArgs(argv: string[]): CheckArgs {
  const values: Record<string, string> = {};
  let skipFiles = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--skip-files') skipFiles = true;
    else if (arg.startsWith('--')) values[arg.slice(2)] = argv[++i] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const problems: string[] = [];
  if (!values.file) problems.push('--file <backup .age file> is missing.');
  if (!values.key) problems.push('--key <age key file> is missing.');
  if (!values['files-remote'] && !skipFiles) {
    problems.push('--files-remote <rclone path of the file copy, for example madar-copy:current> is missing. Use --skip-files only when no file copy exists yet.');
  }
  const lagText = values['files-lag-days'];
  const filesLagDays = lagText === undefined ? 8 : lagText.trim() === '' ? Number.NaN : Number(lagText);
  if (!Number.isInteger(filesLagDays) || filesLagDays < 0) problems.push('--files-lag-days must be a whole number from 0.');
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return { file: values.file, key: values.key, filesRemote: skipFiles ? null : values['files-remote'], image: values.image || DEFAULT_RESTORE_IMAGE, filesLagDays };
}
