import type { SqlHost } from '../../data/lite/host';
import { serverTableSql } from '../../data/lite/schema';

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
 */
export const PLATFORM_SCHEMA_VERSION = 2;

/** The server tables that the platform object copies empty, for the refuse steps. */
export const PLATFORM_COPIED_TABLES: readonly string[] = ['rate_limits', 'auth_users', 'auth_links', 'auth_sessions'];

const PLATFORM_SQL: readonly string[] = [
  'create table enterprises (id text primary key, address text not null unique, state text not null, name text not null, name_ar text not null, limits text not null, created_at text not null, first_admin text not null, logo text)',
  'create table emails (email text primary key, ent text not null)',
  'create table owners (ent text not null, user_id text not null, primary key (ent, user_id))',
  'create table status (ent text primary key, doc text not null, at text not null)',
  'create table account_day (day text not null, ent text not null, requests integer not null default 0, rows_read integer not null default 0, rows_written integer not null default 0, mails integer not null default 0, primary key (day, ent))',
  'create table schema_version (id integer primary key check (id = 1), version integer not null)',
];

/** The steps of an older object. The key is the version that the step makes. Version 1 is the first schema. */
export const PLATFORM_STEPS: Readonly<Record<number, readonly string[]>> = {
  2: ['alter table enterprises add column logo text'],
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
