import type { SqlHost } from '../../data/lite/host';
import { serverTableSql } from '../../data/lite/schema';
import { MAIL_POOL_SCHEMA } from './mailPool';

/**
 * The schema of the platform object (Madar enterprises, design 5.1). It follows the pattern of applyLiteSchema: a new object gets the
 * whole schema, an older one runs the steps above its version in one transaction, and a current one runs one read.
 *
 * Version 1: the list of enterprises, the email directory, the owners, the status rows, the account meter, and empty copies of the
 * sign-in tables (rate_limits, auth_users, auth_links, auth_sessions). The copies stay empty: the refuse steps run the real
 * sign-in code on them, so an unknown email gets the same answer and the same work as a wrong password.
 *
 * Version 2 (plan C): the column logo of enterprises (picture data, null for none), for the list of the platform page. The step is in
 * PLATFORM_STEPS.
 *
 * Version 3 (plan D): the table mail_pool, the places of the mail quota of the whole account (mailPool.ts).
 *
 * Version 4 (plan F, design D8): the tables platform_accounts and platform_sessions, the sign-in of the people of the platform. They belong
 * to no company. The table owners of version 1 stays (a released step never changes) and nothing reads or writes it any more (design D11).
 *
 * Version 5 (the open items of the review of 2026-11-10): the empty copies of the sign-in tables auth_old_hashes and auth_known_addresses
 * (schema version 17 of the office object), because the refuse steps of a refresh and of a password sign-in now read them; and the twins of
 * the platform accounts, platform_old_hashes and platform_known_addresses (accounts.ts). The step is in PLATFORM_STEPS.
 */
export const PLATFORM_SCHEMA_VERSION = 5;

/** The server tables that the platform object copies empty, for the refuse steps. The ones of version 1 come first; a later step adds the rest. */
const FIRST_COPIED_TABLES: readonly string[] = ['rate_limits', 'auth_users', 'auth_links', 'auth_sessions'];
/** The copies of version 5: the sign-in memory of the office object (review 2026-11-10). */
const MEMORY_COPIED_TABLES: readonly string[] = ['auth_old_hashes', 'auth_known_addresses'];
export const PLATFORM_COPIED_TABLES: readonly string[] = [...FIRST_COPIED_TABLES, ...MEMORY_COPIED_TABLES];

/** The platform accounts and their sessions (version 4). The refresh hash is the sha256 of the secret; prev_hash and used_at serve the reuse window. */
const ACCOUNT_SQL: readonly string[] = [
  'create table platform_accounts (id text primary key, email text not null unique, name text not null, password_hash text not null, state text not null, created_at text not null)',
  'create table platform_sessions (id text primary key, account_id text not null, refresh_hash text not null unique, prev_hash text, used_at text, ends_at text not null, created_at text not null)',
  'create index platform_sessions_prev on platform_sessions (prev_hash) where prev_hash is not null',
  'create index platform_sessions_account on platform_sessions (account_id)',
];

/**
 * The sign-in memory of the platform accounts (version 5, review 2026-11-10), the twins of auth_old_hashes and auth_known_addresses: the
 * refresh hashes that left a platform session row, and the pairs of an email and an address where an account signed in (pair_key is an
 * HMAC with the prefix pknown, under a key from the server secret that is in no database and in no backup: server/auth/own/knownKey.ts).
 */
const MEMORY_SQL: readonly string[] = [
  'create table platform_old_hashes (hash text primary key, session_id text not null, at text not null)',
  'create table platform_known_addresses (pair_key text primary key, seen_at text not null)',
];

const PLATFORM_SQL: readonly string[] = [
  'create table enterprises (id text primary key, address text not null unique, state text not null, name text not null, name_ar text not null, limits text not null, created_at text not null, first_admin text not null, logo text)',
  'create table emails (email text primary key, ent text not null)',
  'create table owners (ent text not null, user_id text not null, primary key (ent, user_id))',
  'create table status (ent text primary key, doc text not null, at text not null)',
  'create table account_day (day text not null, ent text not null, requests integer not null default 0, rows_read integer not null default 0, rows_written integer not null default 0, mails integer not null default 0, primary key (day, ent))',
  MAIL_POOL_SCHEMA,
  ...ACCOUNT_SQL,
  ...MEMORY_SQL,
  'create table schema_version (id integer primary key check (id = 1), version integer not null)',
];

/** The steps of an older object. The key is the version that the step makes. Version 1 is the first schema. */
export const PLATFORM_STEPS: Readonly<Record<number, readonly string[]>> = {
  2: ['alter table enterprises add column logo text'],
  3: [MAIL_POOL_SCHEMA],
  4: ACCOUNT_SQL,
  5: [...MEMORY_SQL, ...serverTableSql(MEMORY_COPIED_TABLES)],
};

export function platformSchemaSql(): string[] {
  return [...PLATFORM_SQL, ...serverTableSql(PLATFORM_COPIED_TABLES), `insert into schema_version (id, version) values (1, ${PLATFORM_SCHEMA_VERSION})`];
}

function versionOf(host: SqlHost): number | undefined {
  try {
    const [row] = host.exec('select version from schema_version where id = 1', []).rows;
    return row === undefined ? undefined : Number(row.version);
  } catch (error) {
    if (error instanceof Error && error.message.includes('no such table')) return undefined;
    throw error;
  }
}

export async function applyPlatformSchema(host: SqlHost): Promise<{ applied: boolean; steps?: number[] }> {
  const version = versionOf(host);
  if (version === PLATFORM_SCHEMA_VERSION) return { applied: false };
  if (version !== undefined && version > PLATFORM_SCHEMA_VERSION) {
    throw new Error(`The platform schema is version ${version}, and this build knows version ${PLATFORM_SCHEMA_VERSION}. Deploy the newer build.`);
  }
  if (version !== undefined) {
    const steps: number[] = [];
    for (let next = version + 1; next <= PLATFORM_SCHEMA_VERSION; next += 1) {
      if (!PLATFORM_STEPS[next]) throw new Error(`This build has no platform schema step to version ${next} (server/enterprise/platform/schema.ts).`);
      steps.push(next);
    }
    await host.transaction(async () => {
      for (const next of steps) for (const text of PLATFORM_STEPS[next]) host.exec(text, []);
      host.exec('update schema_version set version = ? where id = 1', [PLATFORM_SCHEMA_VERSION]);
    });
    return { applied: true, steps };
  }
  await host.transaction(async () => {
    for (const text of platformSchemaSql()) host.exec(text, []);
  });
  return { applied: true };
}
