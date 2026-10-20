// The sample office on the test project, for the browser checks on the test deployment (plan 7.5; task X1).
//
//   npx tsx scripts/seed-test-office.ts [--dry-run] [--url <project URL or ref>]
//
// It runs only on madar-test (qdgwpnesxppnqsaabqzd) and refuses every other project, the local stack and the production project
// among them. A run:
//   1. reads the plan: the Madar tables with their rows now and after, the 4 accounts, and the other Auth users;
//   2. sets the 4 Auth accounts (one for each office role): a new password on an Auth user that exists, or a new Auth user;
//      then uploads the sample files to the file store of madar-test, each under a real object key (the pictures as PNG,
//      scripts/seed-pictures.ts): Supabase Storage, or the R2 bucket madar-files-test when MADAR_FILE_STORE is r2;
//   3. in one transaction as postgres under the office lock: records every office row as deleted (so a warm office cache drops
//      it), empties the Madar tables and the platform table agent_approvals, writes the sample office of today (writeState of
//      buildSeed, without its agents: testOffice), and links the 4 accounts. With MAIL_DRIVER=outbox it also empties mail_log;
//      A lock wait over 5 seconds stops the run with "madar-test is busy" and changes no table;
//   4. removes every other Auth user: after step 3 no person in Madar has it;
//   5. signs in as each of the 4 accounts and revokes its AI app grants, so no app that a check approved stays in Settings.
// --dry-run prints the plan and changes nothing.
//
// Values: load ~/dev/madar/.env.local first (set -a; . ~/dev/madar/.env.local; set +a); secrets/test.env is read too when it
// exists. The database password: MADAR_TEST_DB_PASSWORD. The secret key: MADAR_SECRET_KEY, else the Management API with
// SUPABASE_ACCESS_TOKEN. The 4 passwords: the secrets that tests/e2e-deploy/accounts.ts names (MADAR_TEST_PASSWORD_<ROLE>).
// MADAR_FILE_STORE and the four R2 values of secrets/test.env choose the file store (seedFilesFor).
// The script never prints a password or a key.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type { State } from '../src/api/store';
import { buildSeed } from '../src/data/seed';
import { settleFuture } from '../src/data/shift';
import { todayISO } from '../src/lib/dates';
import { PASSWORD_SET_MARK } from '../src/api/contract/server';
import { ApiError } from '../src/api/errors';
import { authAdminPort, AuthAdminError } from '../server/auth/admin';
import { LOCK_TIMEOUT_CODE, takeOfficeLock } from '../server/core/lock';
import type { AuthUserInfo, Query } from '../server/core/ports';
import { setAuthUserId } from '../server/data/officeCache';
import { fileStoreKind } from '../server/core/ports';
import { assertObjectKey, isObjectKey, objectKey } from '../server/files/keys';
import { storedMimeType } from '../server/files/links';
import type { R2Env } from '../server/files/r2';
import { COUNTERS_TABLE, SERVER_TABLES, TABLES } from '../server/data/tables';
import { writeState } from '../server/data/whole';
import { DEPLOY_ACCOUNTS, DEPLOY_ROLES, type DeployAccount } from '../tests/e2e-deploy/accounts';
import { R2_BUCKETS, r2Values } from './deploy/secrets';
import { clientDb, cloudTarget, OFFICE_LOCK_KEY, secretKeyFromApi, type FirstAdminDb } from './first-admin';
import { PNG_PICTURES } from './seed-pictures';
import { r2Target } from './storage/move-to-r2';

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
 * quota, usage and job records (the email quota of the UTC day, the meters and the morning summary count real sends), and the
 * Madar calendar of each person (google_calendars): the calendar lives in a real Google account, so the next connect after a reseed
 * uses it again and makes no second calendar "Madar" (owner test, 2026-10-20).
 */
export const KEEP_TABLES = ['office_meta', 'office_deletes', 'person_seq', 'platform_config', 'mail_log', 'usage_month', 'usage_warnings', 'job_runs', 'google_calendars'] as const;

/**
 * The platform tables of the old office that a reseed empties: the agent approvals (20261004000402_platform_agent_approvals.sql).
 * agent_links goes with the server tables, so an approval left behind would let the same AI app link again with no new approval,
 * and a removed link would no longer stop it (X1 follow-up). The app-migration harness has no platform table, so a Docker test
 * of the seed makes this one in its own schema.
 */
export const PLATFORM_SEED_TABLES = ['agent_approvals'] as const;

/**
 * Every State table, the counters, the server tables of the old office (stories, keys, effects, uploads, agents, test mail,
 * limits), and the platform tables above.
 */
export const TRUNCATE_TABLES: readonly string[] = [
  ...TABLES.map((spec) => spec.table),
  COUNTERS_TABLE,
  ...SERVER_TABLES.filter((table) => !(KEEP_TABLES as readonly string[]).includes(table)),
  ...PLATFORM_SEED_TABLES,
];

/**
 * The mail count of the day, emptied when madar-test sends no mail (MAIL_DRIVER=outbox: every mail stays in mail_outbox). Its
 * count then only blocks the test invitations after a busy test day, until 03:00 Riyadh (2026-10-06). With any other driver the
 * reseed keeps it, because the Resend day quota counts real sends.
 */
export const CLEAR_MAIL_LOG_SQL = 'truncate mail_log';

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

// ---------- The office ----------

/**
 * The sample office without its agents and the posts they wrote. The sample agent ("Madar Assistant") has no agent_links row and
 * no approval, so Settings, Agents would show it as "Not used yet" with a Remove that revokes nothing: on madar-test a real agent
 * needs a real approval (X1 follow-up). It refuses an office where any other record still names a left-out agent. The 4 people
 * of the accounts get the role emails of tests/e2e-deploy/accounts.ts (admin@madar.test and the like). The given State does not
 * change.
 */
export function testOffice(state: State): State {
  const office = structuredClone(state);
  for (const account of Object.values(DEPLOY_ACCOUNTS)) {
    const user = office.users[account.userId];
    if (user) user.email = account.email;
  }
  const agents = new Set(Object.values(office.users).filter((user) => user.kind === 'agent').map((user) => user.id));
  if (agents.size === 0) return office;
  for (const id of agents) delete office.users[id];
  for (const [id, update] of Object.entries(office.updates)) if (agents.has(update.authorId)) delete office.updates[id];
  for (const [collection, records] of Object.entries(office)) {
    if (!records || typeof records !== 'object') continue;
    for (const [id, record] of Object.entries(records as Record<string, unknown>)) {
      const text = JSON.stringify(record);
      for (const agent of agents) {
        if (new RegExp(`\\b${agent}\\b`).test(text)) throw new Error(`The office of madar-test leaves out the agent ${agent}, but ${collection} ${id} names it. Leave that record out too.`);
      }
    }
  }
  return office;
}

// ---------- The files ----------

/**
 * The office with a real object key on every file version, and the uploads that give each key its content. buildSeed names a
 * version with a prototype key (blob_seed_001 and the like), which no store accepts (server/files/keys.ts), so on madar-test every
 * sample file and cover picture failed to open (2026-10-06). The new key is objectKey of the project, the file and the version
 * number. Every other record that names the old key (the file events of the History) gets the new one too. The given State does
 * not change.
 */
export function withObjectKeys(state: State, blobs: ReadonlyMap<string, Blob>): { office: State; uploads: { key: string; blob: Blob }[] } {
  const office = structuredClone(state);
  const keys = new Map<string, string>();
  const uploads: { key: string; blob: Blob }[] = [];
  for (const file of Object.values(office.files)) {
    file.versions.forEach((version, i) => {
      if (isObjectKey(version.blobKey)) return;
      const blob = blobs.get(version.blobKey);
      if (!blob) throw new Error(`The sample file ${file.id} names ${version.blobKey}, but the sample office made no content for it.`);
      const key = objectKey(file.projectId!, file.id, i + 1);
      keys.set(version.blobKey, key);
      uploads.push({ key, blob });
    });
  }
  const swap = (value: unknown): unknown => {
    if (typeof value === 'string') return keys.get(value) ?? value;
    if (value && typeof value === 'object') {
      for (const [field, inner] of Object.entries(value)) (value as Record<string, unknown>)[field] = swap(inner);
    }
    return value;
  };
  swap(office);
  return { office, uploads };
}

/** The file store call of the seed: one sample file into the bucket of the real store. where names the store in the plan. */
export type SeedFiles = { where: string; put(key: string, blob: Blob): Promise<void> };

/**
 * Puts a file with the secret key, and replaces the object of an earlier seed (x-upsert). The object keeps the type that the
 * real store keeps (storedMimeType): a download-only type such as SVG goes as application/octet-stream.
 */
export function seedFilesPort(o: { supabaseUrl: string; secretKey: string; bucket: string; fetch?: typeof fetch }): SeedFiles {
  const send = o.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const base = `${o.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${o.bucket}`;
  return {
    where: 'Supabase Storage',
    async put(key, blob) {
      assertObjectKey(key);
      const response = await send(`${base}/${key}`, {
        method: 'POST',
        headers: { apikey: o.secretKey, Authorization: `Bearer ${o.secretKey}`, 'Content-Type': storedMimeType(blob.type), 'x-upsert': 'true' },
        body: blob,
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Storage refused the sample file ${key} with ${response.status}.`);
    },
  };
}

/**
 * Puts a file into the R2 bucket madar-files-test (owner, 2026-10-16), signed with the R2 values of secrets/test.env, on the R2
 * EU endpoint. An R2 PUT replaces the object of an earlier seed, as x-upsert does on Storage. The object keeps the type that
 * the real store keeps (storedMimeType). It refuses every other bucket and every other endpoint, so a seed never writes into
 * the bucket of production. Errors name the key and the status, never a key of the account.
 */
export function seedR2Port(env: R2Env): SeedFiles {
  if (env.bucket !== R2_BUCKETS.test) throw new SeedRefused(`The seed writes only into the R2 bucket ${R2_BUCKETS.test}, not ${env.bucket}.`);
  if (env.endpoint !== undefined) throw new SeedRefused('The seed writes only to the R2 EU endpoint of the account.');
  const target = r2Target(env);
  return {
    where: `the R2 bucket ${env.bucket}`,
    async put(key, blob) {
      assertObjectKey(key);
      try {
        await target.write(key, await blob.arrayBuffer(), storedMimeType(blob.type));
      } catch (error) {
        throw new Error(`R2 refused the sample file ${key}: ${error instanceof Error ? error.message : 'network error'}`);
      }
    },
  };
}

/**
 * The file store of the seed, by MADAR_FILE_STORE (the environment, then secrets/test.env): Supabase Storage before the switch,
 * the R2 bucket madar-files-test after it. Without the R2 port, a seed after the switch left every sample file with no content.
 */
export function seedFilesFor(env: Record<string, string | undefined>, o: { supabaseUrl: string; secretKey: string; fetch?: typeof fetch }): SeedFiles {
  if (fileStoreKind(env.MADAR_FILE_STORE) === 'supabase') {
    return seedFilesPort({ supabaseUrl: o.supabaseUrl, secretKey: o.secretKey, bucket: env.FILES_BUCKET ?? 'madar-files', ...(o.fetch ? { fetch: o.fetch } : {}) });
  }
  const r2 = r2Values(env, 'test');
  if (!r2) throw new SeedRefused('MADAR_FILE_STORE is r2, but the R2 values are missing: add the four R2 lines to secrets/test.env. Nothing changed.');
  return seedR2Port({ ...r2, ...(o.fetch ? { fetch: o.fetch } : {}) });
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
  /** A new password, a confirmed email, the password mark (PASSWORD_SET_MARK), and no ban. */
  setPassword(authUserId: string, password: string): Promise<void>;
  deleteUser(authUserId: string): Promise<void>;
  /**
   * Signs in as the account and revokes every AI app grant of it, then signs out. Gives the number revoked. A check that approved
   * an app left a grant in Auth, and Settings, Agents showed it after a seed (2026-10-05). Auth has no admin call for one person's
   * grant (proof.md H), so the account's own session revokes it, as the Remove button does.
   */
  revokeGrants(email: string, password: string): Promise<number>;
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
    setPassword: (authUserId, password) => call('PUT', authUserId, { password, email_confirm: true, ban_duration: 'none', user_metadata: { [PASSWORD_SET_MARK]: true } }),
    deleteUser: (authUserId) => call('DELETE', authUserId),
    async revokeGrants(email, password) {
      const root = `${o.supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
      const base = { apikey: o.secretKey, 'Content-Type': 'application/json' };
      const token = await send(`${root}/token?grant_type=password`, {
        method: 'POST', headers: base, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(10_000),
      });
      if (!token.ok) throw new AuthAdminError(token.status, `http_${token.status}`, `Auth refused the sign-in of ${email} with ${token.status}.`);
      const accessToken = String(((await token.json()) as { access_token?: unknown }).access_token ?? '');
      const headers = { ...base, Authorization: `Bearer ${accessToken}` };
      const list = await send(`${root}/user/oauth/grants`, { headers, signal: AbortSignal.timeout(10_000) });
      // An Auth without the OAuth server has no grants to revoke.
      const rows: unknown = list.status === 404 ? [] : await list.json();
      if (!list.ok && list.status !== 404) throw new AuthAdminError(list.status, `http_${list.status}`, `Auth refused the grant list of ${email} with ${list.status}.`);
      let revoked = 0;
      for (const row of Array.isArray(rows) ? rows : []) {
        const clientId = (row as { client?: { id?: unknown } }).client?.id;
        if (typeof clientId !== 'string' || clientId === '') continue;
        const gone = await send(`${root}/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) });
        // 404: no active grant any more, so the access is gone already.
        if (!gone.ok && gone.status !== 404) throw new AuthAdminError(gone.status, `http_${gone.status}`, `Auth refused to revoke a grant of ${email} with ${gone.status}.`);
        revoked += 1;
      }
      await send(`${root}/logout?scope=local`, { method: 'POST', headers, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
      return revoked;
    },
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
  /** The sample files that the run uploads, and the store that gets them (SeedFiles.where). */
  uploads: number;
  uploadsTo?: string;
  /** True with MAIL_DRIVER=outbox: the run empties mail_log (CLEAR_MAIL_LOG_SQL). */
  clearMailLog: boolean;
};

export function planText(plan: SeedPlan): string {
  const lines = [`${plan.dryRun ? 'Dry run on' : 'Plan for'} madar-test (${plan.ref}): the sample office of ${plan.today}.`];
  if (plan.missingTables.length > 0) {
    lines.push(`The Madar tables are missing (${plan.missingTables.length}, for example ${plan.missingTables.slice(0, 3).join(', ')}): apply the migrations first (Z1).`);
  } else {
    lines.push('Tables (one transaction as postgres, under the office lock):');
    for (const t of plan.tables) lines.push(t.kept ? `  ${t.table}: ${t.rowsNow} rows, kept` : `  ${t.table}: ${t.rowsNow} rows now, ${t.rowsAfter} after`);
    if (plan.clearMailLog) lines.push('  The mail count of the day starts again: madar-test sends no mail (MAIL_DRIVER=outbox).');
  }
  if (plan.uploads > 0) lines.push(`Upload ${plan.uploads} sample files to ${plan.uploadsTo ?? 'the file store'}, so they open on madar-test.`);
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

async function readPlan(o: {
  q: Query; auth: SeedAuth; seed: State; ref: string; env: Record<string, string | undefined>; dryRun: boolean; uploads: number; uploadsTo?: string;
}): Promise<SeedPlan> {
  const clearMailLog = o.env.MAIL_DRIVER === 'outbox';
  const accounts = seedAccounts(o.seed);
  const present = await o.q<{ t: string; present: boolean }>(PRESENT_SQL, [ALL_TABLES]);
  const missingTables = present.filter((row) => !row.present).map((row) => row.t);
  const counts = new Map<string, number>();
  if (missingTables.length === 0) for (const row of await o.q<{ t: string; n: number }>(countSql(ALL_TABLES))) counts.set(row.t, Number(row.n));
  const after = rowsAfter(o.seed);
  const tables = ALL_TABLES.map((table) => {
    const kept = (KEEP_TABLES as readonly string[]).includes(table) && !(clearMailLog && table === 'mail_log');
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
    uploads: o.uploads, ...(o.uploadsTo ? { uploadsTo: o.uploadsTo } : {}), clearMailLog,
  };
}

// ---------- The run ----------

export type SeedOptions = {
  db: FirstAdminDb;
  auth: SeedAuth;
  /**
   * The sample office to write. The command line passes buildSeed of today, with the stamps of later today settled. The run
   * writes testOffice of it (no agents).
   */
  seed: State;
  ref: string;
  env: Record<string, string | undefined>;
  dryRun: boolean;
  lockKey: number;
  log: (line: string) => void;
  writeOffice?: (q: Query, state: State) => Promise<unknown>;
  /** The content of each prototype file key of the seed (the PutBlob of buildSeed). With it the run uploads the files (files). */
  blobs?: ReadonlyMap<string, Blob>;
  files?: SeedFiles;
};

/** Prints the plan, and without dryRun makes it so. It refuses (SeedRefused) before any change when a check fails. */
export async function runSeed(o: SeedOptions): Promise<{ changed: boolean; plan: SeedPlan }> {
  if (o.ref !== TEST_REF) throw new SeedRefused(`This script runs only on madar-test (${TEST_REF}), not on the project ${o.ref}.`);
  const { office, uploads } = o.blobs ? withObjectKeys(testOffice(o.seed), o.blobs) : { office: testOffice(o.seed), uploads: [] };
  if (uploads.length > 0 && !o.files) throw new Error('The run has sample files to upload, but no file store port.');
  const plan = await readPlan({ q: o.db.q, auth: o.auth, seed: office, ref: o.ref, env: o.env, dryRun: o.dryRun, uploads: uploads.length, uploadsTo: o.files?.where });
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

  // Before the tables, so no row names an object that is not there yet. A key of an earlier seed gets the new content.
  for (const upload of uploads) await o.files!.put(upload.key, upload.blob);
  if (uploads.length > 0) changes.push(`Uploaded ${uploads.length} sample files to ${o.files!.where}.`);

  const writeOffice = o.writeOffice ?? writeState;
  try {
    await o.db.tx(async (q) => {
      await q(SEED_LOCK_TIMEOUT_SQL);
      await takeOfficeLock(q, o.lockKey);
      await q(RECORD_DELETES_SQL);
      await q(TRUNCATE_SQL);
      if (plan.clearMailLog) await q(CLEAR_MAIL_LOG_SQL);
      await writeOffice(q, office);
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
  for (const account of plan.accounts) {
    const revoked = await o.auth.revokeGrants(account.email, o.env[account.passwordSecret]!);
    if (revoked > 0) changes.push(`Revoked ${revoked} AI app grant${revoked === 1 ? '' : 's'} of ${account.email}.`);
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
  const blobs = new Map<string, Blob>();
  const seed = settleFuture(await buildSeed(todayISO(now), async (key, blob) => void blobs.set(key, blob), PNG_PICTURES), now);
  // The store of the screens gets the sample files: Supabase Storage, or madar-files-test after the switch to R2.
  const store = { blobs, files: seedFilesFor(process.env, { supabaseUrl: target.supabaseUrl, secretKey }) };
  const client = new pg.Client(cloud.pg);
  await client.connect();
  try {
    const lockText = process.env.MADAR_LOCK_KEY;
    await runSeed({
      db: clientDb(client), auth: seedAuthPort({ supabaseUrl: target.supabaseUrl, secretKey }), seed, ref: target.ref, env: process.env,
      dryRun: args.dryRun, lockKey: lockText ? Number(lockText) : OFFICE_LOCK_KEY, log: (line) => console.log(line), ...store,
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
