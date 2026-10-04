// The sample office on the test project, for the browser checks on the test deployment (plan 7.5; task X1).
//
//   npx tsx scripts/seed-test-office.ts [--dry-run] [--url <project URL or ref>]
//
// It runs only on madar-test (qdgwpnesxppnqsaabqzd) and refuses every other project, the local stack and the production project
// among them. A run:
//   1. reads the plan: the Madar tables with their rows now and after, the 4 accounts, and the other Auth users;
//   2. sets the 4 Auth accounts (one for each office role): a new password on an Auth user that exists, or a new Auth user;
//   3. in one transaction as postgres under the office lock: records every office row as deleted (so a warm office cache drops
//      it), empties the Madar tables, writes the sample office of today (writeState of buildSeed), and links the 4 accounts.
//      A lock wait over 5 seconds stops the run with "madar-test is busy" and changes no table;
//   4. removes every other Auth user: after step 3 no person in Madar has it.
// --dry-run prints the plan and changes nothing.
//
// Values: load ~/dev/madar/.env.local first (set -a; . ~/dev/madar/.env.local; set +a); secrets/test.env is read too when it
// exists. The database password: MADAR_TEST_DB_PASSWORD. The secret key: MADAR_SECRET_KEY, else the Management API with
// SUPABASE_ACCESS_TOKEN. The 4 passwords: the secrets that tests/e2e-deploy/accounts.ts names (MADAR_TEST_PASSWORD_<ROLE>).
// The script never prints a password or a key.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { State } from '../src/api/store';
import { buildSeed } from '../src/data/seed';
import { settleFuture } from '../src/data/shift';
import { todayISO } from '../src/lib/dates';
import { ApiError } from '../src/api/errors';
import { authAdminPort, AuthAdminError } from '../server/auth/admin';
import { LOCK_TIMEOUT_CODE, takeOfficeLock } from '../server/core/lock';
import type { AuthUserInfo, Query } from '../server/core/ports';
import { setAuthUserId } from '../server/data/officeCache';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES } from '../server/data/tables';
import { writeState } from '../server/data/whole';
import { DEPLOY_ACCOUNTS, DEPLOY_ROLES, type DeployAccount } from '../tests/e2e-deploy/accounts';
import { clientDb, cloudTarget, OFFICE_LOCK_KEY, secretKeyFromApi, type FirstAdminDb } from './first-admin';

/** madar-test, the only project this script changes. */
export const TEST_REF = 'qdgwpnesxppnqsaabqzd';
const TEST_URL = `https://${TEST_REF}.supabase.co`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIN_PASSWORD = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SeedRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefused';
  }
}

export type SeedArgs = { target: string; dryRun: boolean };

export function parseArgs(argv: string[]): SeedArgs {
  let target = TEST_URL;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--url') target = argv[++i] ?? '';
    else throw new Error(`${arg} is not an option. Use --dry-run and --url <project URL or ref>.`);
  }
  return { target, dryRun };
}

/** The project of a URL or a bare ref. Only madar-test passes; everything else is refused before any connection. */
export function seedTarget(target: string): { ref: string; supabaseUrl: string } {
  const refuse = (what: string) => new SeedRefused(`This script runs only on madar-test (${TEST_REF}), not on ${what}.`);
  const value = target.trim();
  let ref: string | undefined;
  if (/^[a-z0-9]{20}$/.test(value)) {
    ref = value;
  } else {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw refuse(`"${value.slice(0, 60)}"`);
    }
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
    if (url.protocol !== 'https:' || !match || url.port !== '' || (url.pathname !== '/' && url.pathname !== '')) throw refuse(url.host);
    ref = match[1];
  }
  if (ref !== TEST_REF) throw refuse(`the project ${ref}`);
  return { ref, supabaseUrl: TEST_URL };
}

// ---------- The tables ----------

/**
 * The server tables that a reseed keeps: the office version and the change counters (open screens and warm caches compare
 * them, so they only rise), the office deletes (a warm cache needs them), the project values (the token hook), and the
 * quota, usage and job records (the email quota of the UTC day, the meters and the morning summary count real sends).
 */
export const KEEP_TABLES = ['office_meta', 'office_deletes', 'person_seq', 'platform_config', 'mail_log', 'usage_month', 'usage_warnings', 'job_runs'] as const;

/** Every State table, the counters, and the server tables of the old office (stories, keys, effects, uploads, agents, test mail, limits). */
export const TRUNCATE_TABLES: readonly string[] = [
  ...TABLES.map((spec) => spec.table),
  COUNTERS_TABLE,
  ...SERVER_TABLES.filter((table) => !(KEEP_TABLES as readonly string[]).includes(table)),
];

/** One statement for every table, so the project foreign keys need no order. No table name carries a schema (TM 5). */
export const TRUNCATE_SQL = `truncate ${TRUNCATE_TABLES.join(', ')} restart identity`;

/**
 * The rule of the office cache (server/data/officeCache.ts): a write of an office table raises office_meta.version and records a
 * deleted row in office_deletes. TRUNCATE records nothing, so every office row is recorded as deleted first, under one new
 * version. writeState then raises the version again and writes the new rows, and the cache applies the deletes first.
 */
export const RECORD_DELETES_SQL =
  'with v as (update office_meta set version = version + 1 returning version) insert into office_deletes (tbl, id, chg) select x.tbl, x.id, v.version from v, ('
  + TABLES.filter((spec) => spec.office).map((spec) => `select '${spec.table}' as tbl, id from ${spec.table}`).join(' union all ')
  + ') x on conflict do nothing';

/**
 * The first statement of the seed transaction (proof.md Z0a item 4: set local passes through Supavisor). The office lock and
 * TRUNCATE (an ACCESS EXCLUSIVE lock on each table) wait at most 5 seconds, as the server's own writes do (server/core/lock.ts).
 * Without it, one idle or long session would stop the seed with no end, and every later read and write of madar-test behind it.
 */
export const SEED_LOCK_TIMEOUT_SQL = "set local lock_timeout = '5s'";

/** A lock wait that ran out: Postgres 55P03, or the busy refusal that takeOfficeLock makes of it. */
function isBusy(error: unknown): boolean {
  if (error instanceof ApiError) return error.details.reason === 'busy';
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === LOCK_TIMEOUT_CODE;
}

/** Which of the tables exist (on the search path). */
export const PRESENT_SQL = 'select t, to_regclass(t) is not null as present from unnest($1::text[]) as t';

const ALL_TABLES: readonly string[] = [...TRUNCATE_TABLES, ...KEEP_TABLES];

function countSql(tables: readonly string[]): string {
  return tables.map((table) => `select '${table}' as t, count(*)::int as n from ${table}`).join(' union all ');
}

/** The rows that writeState writes into each table for a State. */
function rowsAfter(state: State): Map<string, number> {
  const rows = new Map<string, number>();
  for (const spec of TABLES) rows.set(spec.table, spec.collection === 'settings' ? 1 : Object.keys((state[spec.collection] ?? {}) as object).length);
  rows.set(COUNTERS_TABLE, Object.keys(state.counters ?? {}).length);
  return rows;
}

// ---------- The accounts ----------

/** The 4 accounts, after a check that each still names a person of the sample office with that role and that email. */
export function seedAccounts(state: State): DeployAccount[] {
  return DEPLOY_ROLES.map((role) => {
    const account = DEPLOY_ACCOUNTS[role];
    const user = state.users[account.userId];
    if (!user || user.kind !== 'human' || !user.active || user.systemRole !== role || user.email !== account.email) {
      throw new Error(`The sample office has no active person ${account.userId} with the role ${role} and the email ${account.email}. Update tests/e2e-deploy/accounts.ts.`);
    }
    return account;
  });
}

/** The Auth admin calls of the seed. listUsers and createUser come from server/auth/admin.ts. */
export type SeedAuth = {
  listUsers(): Promise<AuthUserInfo[]>;
  createUser(email: string, password: string): Promise<{ authUserId: string }>;
  /** A new password, a confirmed email, and no ban. */
  setPassword(authUserId: string, password: string): Promise<void>;
  deleteUser(authUserId: string): Promise<void>;
};

export function seedAuthPort(o: { supabaseUrl: string; secretKey: string; fetch?: typeof fetch }): SeedAuth {
  const admin = authAdminPort(o);
  const base = `${o.supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin/users`;
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  async function call(method: 'PUT' | 'DELETE', authUserId: string, body?: Record<string, unknown>): Promise<void> {
    if (!UUID.test(authUserId)) throw new Error(`"${authUserId.slice(0, 40)}" is not an Auth user id.`);
    const response = await send(`${base}/${encodeURIComponent(authUserId)}`, {
      method,
      headers: { apikey: o.secretKey, Authorization: `Bearer ${o.secretKey}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new AuthAdminError(response.status, `http_${response.status}`, `The Auth admin API refused ${method} /users with ${response.status}.`);
  }
  return {
    listUsers: () => admin.listUsers(),
    createUser: (email, password) => admin.createUser(email, password),
    setPassword: (authUserId, password) => call('PUT', authUserId, { password, email_confirm: true, ban_duration: 'none' }),
    deleteUser: (authUserId) => call('DELETE', authUserId),
  };
}

// ---------- The plan ----------

export type SeedPlan = {
  ref: string;
  today: string;
  dryRun: boolean;
  /** Tables that the migrations make and the project does not have. */
  missingTables: string[];
  tables: { table: string; rowsNow: number; rowsAfter: number; kept?: boolean }[];
  accounts: (DeployAccount & { secretSet: boolean; authUserId: string | null })[];
  /** The other Auth users, which the run removes: id and email. */
  removeAuth: { authUserId: string; email: string | null }[];
  missingSecrets: string[];
  shortSecrets: string[];
};

export function planText(plan: SeedPlan): string {
  const lines = [`${plan.dryRun ? 'Dry run on' : 'Plan for'} madar-test (${plan.ref}): the sample office of ${plan.today}.`];
  if (plan.missingTables.length > 0) {
    lines.push(`The Madar tables are missing (${plan.missingTables.length}, for example ${plan.missingTables.slice(0, 3).join(', ')}): apply the migrations first (Z1).`);
  } else {
    lines.push('Tables (one transaction as postgres, under the office lock):');
    for (const t of plan.tables) lines.push(t.kept ? `  ${t.table}: ${t.rowsNow} rows, kept` : `  ${t.table}: ${t.rowsNow} rows now, ${t.rowsAfter} after`);
  }
  lines.push('Accounts:');
  for (const a of plan.accounts) {
    const what = a.authUserId ? 'set a new password on the existing Auth user' : 'make a new Auth user';
    lines.push(`  ${a.email} (${a.role}, ${a.userId}): ${what}; password from ${a.passwordSecret}${a.secretSet ? '' : ' (not set)'}`);
  }
  if (plan.removeAuth.length > 0) {
    lines.push(`Remove ${plan.removeAuth.length} other Auth user${plan.removeAuth.length === 1 ? '' : 's'} (no person in Madar has them after the seed):`);
    for (const user of plan.removeAuth) lines.push(`  ${user.email ?? user.authUserId}`);
  } else {
    lines.push('No other Auth user to remove.');
  }
  if (plan.missingSecrets.length > 0) lines.push(`Missing secrets: ${plan.missingSecrets.join(', ')}.`);
  if (plan.shortSecrets.length > 0) lines.push(`Passwords shorter than ${MIN_PASSWORD} characters: ${plan.shortSecrets.join(', ')}.`);
  return lines.join('\n');
}

async function readPlan(o: { q: Query; auth: SeedAuth; seed: State; ref: string; env: Record<string, string | undefined>; dryRun: boolean }): Promise<SeedPlan> {
  const accounts = seedAccounts(o.seed);
  const present = await o.q<{ t: string; present: boolean }>(PRESENT_SQL, [ALL_TABLES]);
  const missingTables = present.filter((row) => !row.present).map((row) => row.t);
  const counts = new Map<string, number>();
  if (missingTables.length === 0) for (const row of await o.q<{ t: string; n: number }>(countSql(ALL_TABLES))) counts.set(row.t, Number(row.n));
  const after = rowsAfter(o.seed);
  const tables = ALL_TABLES.map((table) => {
    const kept = (KEEP_TABLES as readonly string[]).includes(table);
    const rowsNow = counts.get(table) ?? 0;
    return { table, rowsNow, rowsAfter: kept ? rowsNow : (after.get(table) ?? 0), ...(kept ? { kept } : {}) };
  });
  const users = await o.auth.listUsers();
  const byEmail = new Map(users.filter((user) => user.email).map((user) => [user.email!.toLowerCase(), user]));
  const mine = new Set<string>();
  const planned = accounts.map((account) => {
    const user = byEmail.get(account.email);
    if (user) mine.add(user.authUserId);
    return { ...account, secretSet: Boolean(o.env[account.passwordSecret]), authUserId: user?.authUserId ?? null };
  });
  return {
    ref: o.ref, today: o.seed.seededOn, dryRun: o.dryRun, missingTables, tables: missingTables.length > 0 ? [] : tables, accounts: planned,
    removeAuth: users.filter((user) => !mine.has(user.authUserId)).map((user) => ({ authUserId: user.authUserId, email: user.email })),
    missingSecrets: accounts.filter((a) => !o.env[a.passwordSecret]).map((a) => a.passwordSecret),
    shortSecrets: accounts.filter((a) => (o.env[a.passwordSecret] ?? '').length > 0 && o.env[a.passwordSecret]!.length < MIN_PASSWORD).map((a) => a.passwordSecret),
  };
}

// ---------- The run ----------

export type SeedOptions = {
  db: FirstAdminDb;
  auth: SeedAuth;
  /** The sample office to write. The command line passes buildSeed of today, with the stamps of later today settled. */
  seed: State;
  ref: string;
  env: Record<string, string | undefined>;
  dryRun: boolean;
  lockKey: number;
  log: (line: string) => void;
  writeOffice?: (q: Query, state: State) => Promise<unknown>;
};

/** Prints the plan, and without dryRun makes it so. It refuses (SeedRefused) before any change when a check fails. */
export async function runSeed(o: SeedOptions): Promise<{ changed: boolean; plan: SeedPlan }> {
  if (o.ref !== TEST_REF) throw new SeedRefused(`This script runs only on madar-test (${TEST_REF}), not on the project ${o.ref}.`);
  const plan = await readPlan({ q: o.db.q, auth: o.auth, seed: o.seed, ref: o.ref, env: o.env, dryRun: o.dryRun });
  o.log(planText(plan));
  if (o.dryRun) {
    o.log('Nothing changed (dry run).');
    return { changed: false, plan };
  }
  if (plan.missingTables.length > 0) throw new SeedRefused('The Madar tables are missing. Apply the migrations first (Z1), then seed.');
  const bad = [...plan.missingSecrets, ...plan.shortSecrets];
  if (bad.length > 0) throw new SeedRefused(`Set a password of at least ${MIN_PASSWORD} characters in ${bad.join(', ')} first. Nothing changed.`);

  const changes: string[] = [];
  const links: { userId: string; email: string; authUserId: string }[] = [];
  for (const account of plan.accounts) {
    const password = o.env[account.passwordSecret]!;
    if (account.authUserId) {
      await o.auth.setPassword(account.authUserId, password);
      changes.push(`Set a new password for the Auth user ${account.email}.`);
      links.push({ userId: account.userId, email: account.email, authUserId: account.authUserId });
    } else {
      const made = await o.auth.createUser(account.email, password);
      changes.push(`Made the Auth user ${account.email}.`);
      links.push({ userId: account.userId, email: account.email, authUserId: made.authUserId });
    }
  }

  const writeOffice = o.writeOffice ?? writeState;
  try {
    await o.db.tx(async (q) => {
      await q(SEED_LOCK_TIMEOUT_SQL);
      await takeOfficeLock(q, o.lockKey);
      await q(RECORD_DELETES_SQL);
      await q(TRUNCATE_SQL);
      await writeOffice(q, o.seed);
      for (const link of links) {
        if (!(await setAuthUserId(q, link.userId, link.authUserId))) throw new Error(`The users row ${link.userId} is missing after the seed.`);
      }
    });
  } catch (error) {
    if (!isBusy(error)) throw error;
    throw new SeedRefused(
      'madar-test is busy: another session held a lock on the Madar tables for more than 5 seconds. The Madar tables did not change. '
      + 'The 4 Auth accounts have their new passwords, and the next run links them. Run the script again.',
    );
  }
  for (const t of plan.tables) if (!t.kept) changes.push(`${t.table}: removed ${t.rowsNow} rows, wrote ${t.rowsAfter}.`);
  for (const link of links) changes.push(`Linked ${link.email} to ${link.userId}.`);

  for (const user of plan.removeAuth) {
    await o.auth.deleteUser(user.authUserId);
    changes.push(`Removed the Auth user ${user.email ?? user.authUserId}.`);
  }
  o.log([`Seeded madar-test (${o.ref}) with the sample office of ${plan.today}:`, ...changes.map((line) => `  ${line}`)].join('\n'));
  return { changed: true, plan };
}

// ---------- The command line ----------

function loadSecretsFile(): void {
  const file = `${ROOT}secrets/test.env`;
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = seedTarget(args.target);
  loadSecretsFile();
  const cloud = cloudTarget('test', process.env);
  if (cloud.ref !== target.ref) throw new SeedRefused('The database and the project do not match.');
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const secretKey = process.env.MADAR_SECRET_KEY ?? (token ? await secretKeyFromApi(target.ref, token) : '');
  if (!secretKey) throw new Error('MADAR_SECRET_KEY and SUPABASE_ACCESS_TOKEN are missing: load ~/dev/madar/.env.local first.');
  const now = new Date();
  const seed = settleFuture(await buildSeed(todayISO(now), async () => undefined), now);
  const client = new pg.Client(cloud.pg);
  await client.connect();
  try {
    const lockText = process.env.MADAR_LOCK_KEY;
    await runSeed({
      db: clientDb(client), auth: seedAuthPort({ supabaseUrl: target.supabaseUrl, secretKey }), seed, ref: target.ref, env: process.env,
      dryRun: args.dryRun, lockKey: lockText ? Number(lockText) : OFFICE_LOCK_KEY, log: (line) => console.log(line),
    });
  } finally {
    await client.end().catch(() => undefined);
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
