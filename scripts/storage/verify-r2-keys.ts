import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FileStoreKind } from '../../server/core/ports';
import { KEYS_IN_USE_SQL } from '../../server/files/effects';
import { isObjectKey } from '../../server/files/keys';
import { r2FilesPort, type R2Env } from '../../server/files/r2';
import type { Target } from '../deploy/secrets';
import { accessToken, copyEnv, envArg, readLocalEnv, readSecretsText } from './env';

/**
 * The key check after the switch to R2 (owner, 2026-10-16; scripts/deploy/CLAUDE.md, "Switch the files to R2"). Read only:
 *
 *   npx tsx scripts/storage/verify-r2-keys.ts --env test|production
 *
 * It reads every key that a record names (the data and the small picture of each file version, and each report screenshot), with
 * one read-only query through the Management API SQL endpoint and SUPABASE_ACCESS_TOKEN (the environment, else .env.local).
 * The places of the keys come from KEYS_IN_USE_SQL (server/files/effects.ts), so this check names the same keys as the
 * r2.delete handler. Then it heads each key on R2 with the R2 values of secrets/<env>.env, 8 at a time. It prints the counts and
 * the missing keys (keys are not secrets) as JSON, and exits 1 when a key is missing on R2 or is not an object key.
 * It changes nothing, so production needs no typed word. Network calls need the sandbox off.
 */

export type KeyPlace = { table: string; array: string; field: string };

/** The tables, arrays and fields of the stored keys, as KEYS_IN_USE_SQL names them. */
export function keyPlaces(sql: string = KEYS_IN_USE_SQL): KeyPlace[] {
  const places: KeyPlace[] = [];
  for (const part of sql.split('exists (').slice(1)) {
    const table = /from (\w+) \w+ where/.exec(part)?.[1];
    for (const match of part.matchAll(/\w+\.doc->'(\w+)' @> jsonb_build_array\(jsonb_build_object\('(\w+)', k\)\)/g)) {
      if (table) places.push({ table, array: match[1], field: match[2] });
    }
  }
  if (places.length === 0) throw new Error('KEYS_IN_USE_SQL names no key field that this check can read. Update keyPlaces with it.');
  return places;
}

/** Every key of the places, once each. The names come from KEYS_IN_USE_SQL (word characters only), never from a record. */
export function recordKeysSql(places: KeyPlace[]): string {
  const parts = places.map((place) =>
    `select e->>'${place.field}' as key from ${place.table} t cross join lateral jsonb_array_elements(`
    + `case when jsonb_typeof(t.doc->'${place.array}') = 'array' then t.doc->'${place.array}' else '[]'::jsonb end) e`);
  return `select distinct key from (${parts.join(' union all ')}) x where key is not null and key <> '' order by key`;
}

/** The record count of each table of the places. */
export function countsSql(places: KeyPlace[]): string {
  const tables = [...new Set(places.map((place) => place.table))];
  return `select ${tables.map((table) => `(select count(*) from ${table})::int as ${table}`).join(', ')}`;
}

/** One read-only query through the Management API SQL endpoint. Errors name the status, never the token. */
export async function managementQuery<T = Record<string, unknown>>(ref: string, token: string, sql: string, fetcher: typeof fetch = fetch): Promise<T[]> {
  const response = await fetcher(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  if (!response.ok) throw new Error(`The Management API refused the query with ${response.status}.`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('The Management API gave no list of rows.');
  return rows as T[];
}

/** How many heads run at once. */
const HEADS_AT_ONCE = 8;

/** Heads each object key once. A value that is not an object key is in no store, so it never goes to R2. */
export async function verifyKeys(
  keys: string[], head: (key: string) => Promise<{ size: number } | null>,
): Promise<{ keys: number; present: number; missing: string[]; notObjectKeys: string[] }> {
  const unique = [...new Set(keys)];
  const notObjectKeys = unique.filter((key) => !isObjectKey(key));
  const checked = unique.filter((key) => isObjectKey(key));
  const missing: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < checked.length) {
      const key = checked[next];
      next += 1;
      if (!(await head(key))) missing.push(key);
    }
  };
  await Promise.all(Array.from({ length: Math.min(HEADS_AT_ONCE, checked.length) }, worker));
  return { keys: unique.length, present: checked.length - missing.length, missing: missing.sort(), notObjectKeys: notObjectKeys.sort() };
}

export function parseVerifyArgs(argv: string[]): { env: Target } {
  const env = envArg(argv);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--env') i += 1;
    else throw new Error(`${argv[i]} is not an option. Use --env test or --env production.`);
  }
  if (!env) throw new Error('Name the copy: --env test or --env production.');
  return { env };
}

export type VerifyReport = {
  env: Target;
  bucket: string;
  /** The store of the screens in secrets/<env>.env. */
  fileStore: FileStoreKind;
  records: Record<string, number>;
  keys: number;
  present: number;
  missing: string[];
  notObjectKeys: string[];
};

export async function runVerify(o: {
  target: Target; fileStore: FileStoreKind; r2: R2Env;
  query: (sql: string) => Promise<Record<string, unknown>[]>;
  head: (key: string) => Promise<{ size: number } | null>;
}): Promise<{ code: number; report: VerifyReport }> {
  const places = keyPlaces();
  const [counts] = await o.query(countsSql(places));
  const keys = (await o.query(recordKeysSql(places))).map((row) => String(row.key));
  const result = await verifyKeys(keys, o.head);
  const records = Object.fromEntries(Object.entries(counts ?? {}).map(([table, n]) => [table, Number(n)]));
  const report: VerifyReport = { env: o.target, bucket: o.r2.bucket, fileStore: o.fileStore, records, ...result };
  return { code: result.missing.length > 0 || result.notObjectKeys.length > 0 ? 1 : 0, report };
}

async function main(argv: string[]): Promise<number> {
  const { env } = parseVerifyArgs(argv);
  const copy = copyEnv(env, readSecretsText(env));
  const token = accessToken(process.env, readLocalEnv);
  const port = r2FilesPort(copy.r2);
  const { code, report } = await runVerify({
    target: env, fileStore: copy.fileStore, r2: copy.r2,
    query: (sql) => managementQuery(copy.ref, token, sql),
    head: (key) => port.head(key, { timeoutMs: 30_000 }),
  });
  console.log(JSON.stringify(report, null, 2));
  return code;
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
