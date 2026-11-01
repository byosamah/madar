import { OFFICE_COLLECTIONS, type OfficeCollection } from '../core/types';
import { tableOf } from './tables';

/**
 * The compressed office copy (to-do tsk_496): the office lists of the office cache as one text, gzip then base64, in the one row of
 * the table office_copy (supabase/migrations/20261101000100_office_copy.sql). A cold read of the office cache starts from it and
 * loads only the rows above its version (server/data/officeCache.ts).
 *
 * - The copy is derived data. The tables stay the truth: a copy that is missing, broken, newer than the database or too old is
 *   never used, and the cache then reads every row.
 * - The text holds what a cache entry holds, in the same fields: the key, "ord", the doc and the sign-in link of a user. So the order
 *   of each list and userIdOfAuth come out as from a full read.
 * - gzip runs in CompressionStream, which Deno, Workers and Node all have. base64 carries the bytes as text (bytea in the text
 *   protocol is hex, twice the size).
 */

type Rec = Record<string, unknown>;
type Entry = { ord: number; doc: Rec; auth?: string | null };
export type CopyTables = Map<OfficeCollection, Map<string, Entry>>;

/** The version of the text form. A copy of another form is not used. */
export const OFFICE_COPY_FORMAT = 1;

/** The marks of the two extra row kinds in the answer of OFFICE_COLD_SQL: the copy itself, and a deleted row. */
export const COPY_ROW = '#copy';
export const GONE_ROW = '#gone';

/**
 * The cold read in one statement. $1 is the office_meta.version of this read, $2 the oldest "at" a copy may have (the database
 * time of the read less the keep time of office_deletes). The row of the copy comes only when it is not newer than the database
 * and not too old. Then the statement gives the rows and the deletes above its version. With no usable copy it gives every row and
 * no delete, which is the full read of today, in the same one round trip.
 * Columns: c, id, ord, doc, auth as OFFICE_ROWS_SQL, and snap_at and body for the copy row. A deleted row (GONE_ROW) gives its id in id
 * and its table in body.
 */
export const OFFICE_COLD_SQL = [
  'with s as (select version, at, body from office_copy where id = 1 and version <= $1::bigint and at >= $2::timestamptz),',
  'v as (select coalesce((select version from s), -1) as v)',
  `select '${COPY_ROW}' as c, s.version::text as id, 0::bigint as ord, null::jsonb as doc, null::text as auth, s.at as snap_at, s.body as body from s`,
  ...OFFICE_COLLECTIONS.map((c) => {
    const table = tableOf(c).table;
    return `union all select '${c}', id, ord, doc, ${c === 'users' ? 'auth_user_id::text' : 'null::text'}, null::timestamptz, null::text from ${table} where chg > (select v from v)`;
  }),
  `union all select '${GONE_ROW}', id, 0::bigint, null::jsonb, null::text, null::timestamptz, tbl from office_deletes where chg > (select version from s)`,
].join(' ');

/**
 * Writes the copy. The newest version wins: a copy replaces the row only when the row is not newer, or when the row is newer than the
 * office_meta of this database (a database that went back, a restore). Two writers at once keep the newer one, because the
 * row lock of the conflict serializes them. $1 version, $2 at, $3 row count, $4 body.
 */
export const OFFICE_COPY_UPSERT_SQL = [
  'insert into office_copy (id, version, at, row_count, body) values (1, $1::bigint, $2::timestamptz, $3::integer, $4::text)',
  'on conflict (id) do update set version = excluded.version, at = excluded.at, row_count = excluded.row_count, body = excluded.body',
  'where office_copy.version < excluded.version',
  'or (office_copy.version = excluded.version and office_copy.at <= excluded.at)',
  'or office_copy.version > (select version from office_meta)',
].join(' ');

/** When a request that merged a delta writes a new copy: this many rows, this many bytes of delta, or a copy this old. */
export const COPY_DELTA_ROWS = 25;
export const COPY_DELTA_BYTES = 8 * 1024;
export const COPY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let at = 0; at < bytes.length; at += CHUNK) text += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const source = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(source).arrayBuffer());
}

/** The text of a copy and its row count. */
export async function encodeCopy(version: number, tables: CopyTables): Promise<{ body: string; rows: number }> {
  const t: Record<string, unknown[][]> = {};
  let rows = 0;
  for (const c of OFFICE_COLLECTIONS) {
    t[c] = [...(tables.get(c) ?? [])].map(([id, entry]) => [id, entry.ord, entry.doc, entry.auth ?? null]);
    rows += t[c].length;
  }
  const json = JSON.stringify({ f: OFFICE_COPY_FORMAT, version, rows, t });
  return { body: toBase64(await through(new TextEncoder().encode(json), new CompressionStream('gzip'))), rows };
}

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The tables of a copy, or null when anything is wrong: the text does not decode, the form or the version is not the expected one,
 * a count differs, or an entry has a wrong shape or a key that differs from its id. A null makes the cache read every row.
 */
export async function decodeCopy(body: string, version: number): Promise<CopyTables | null> {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await through(fromBase64(body), new DecompressionStream('gzip'))));
    if (!isRec(parsed) || parsed.f !== OFFICE_COPY_FORMAT || parsed.version !== version || !isRec(parsed.t)) return null;
    const tables: CopyTables = new Map();
    let rows = 0;
    for (const c of OFFICE_COLLECTIONS) {
      const list = parsed.t[c];
      if (!Array.isArray(list)) return null;
      const spec = tableOf(c);
      const entries = new Map<string, Entry>();
      for (const item of list) {
        if (!Array.isArray(item) || item.length !== 4) return null;
        const [id, ord, doc, auth] = item as [unknown, unknown, unknown, unknown];
        if (typeof id !== 'string' || typeof ord !== 'number' || !Number.isFinite(ord) || !isRec(doc)) return null;
        if (auth !== null && typeof auth !== 'string') return null;
        if (spec.key(doc) !== id || entries.has(id)) return null;
        entries.set(id, { ord, doc, auth });
      }
      if (c === 'settings' && entries.size > 1) return null;
      rows += entries.size;
      tables.set(c, entries);
    }
    return rows === parsed.rows ? tables : null;
  } catch {
    return null;
  }
}
