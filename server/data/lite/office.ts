import type { State } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { OFFICE_COLLECTIONS, type OfficeCollection, type OfficeSnapshot } from '../../core/types';
import { snapshotOf } from '../officeCache';
import { collectionOf, tableOf } from '../tables';
import { liteDbOf, onCommit, wroteIn, type LiteDb } from './db';

/**
 * The office lists of a SQLite office (Supabase exit, wave 1). The office object is the one writer, so the lists live in its
 * memory and follow each commit: no chg column, no office_deletes, no xmin test. A wake reads the snapshot rows (one row for an
 * office of today's size) in place of every office table (1,459 rows on one year of data, wave 0).
 *
 * The rule for every write of an office table (the save, the harness write-down, later the import and the sign-in link): in the
 * same transaction it raises office_meta.version and calls writeOfficeSnapshot with the whole office lists after the write.
 */

export type OfficeLists = Pick<State, OfficeCollection>;

/**
 * At most this many UTF-16 units in one snapshot row. A unit is at most 3 bytes of UTF-8, so a row stays under the 2 MB limit of
 * the office object.
 */
export const SNAPSHOT_PART = 600_000;

const MEMORY = new WeakMap<LiteDb, OfficeSnapshot>();

/** The parts of a text, each at most size units long, and no part ends inside a surrogate pair. */
export function partsOf(body: string, size = SNAPSHOT_PART): string[] {
  const parts: string[] = [];
  let at = 0;
  while (at < body.length) {
    let end = Math.min(at + size, body.length);
    const last = body.charCodeAt(end - 1);
    if (end < body.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(body.slice(at, end));
    at = end;
  }
  return parts;
}

function listsOf(lists: OfficeLists): OfficeLists {
  return Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, lists[c]])) as unknown as OfficeLists;
}

/** Writes the snapshot of the office lists at a version, inside the transaction of q, and puts it into memory after the commit. */
export async function writeOfficeSnapshot(q: Query, lists: OfficeLists, version: number): Promise<void> {
  const office = listsOf(lists);
  const parts = partsOf(JSON.stringify(office));
  await q('delete from office_snapshot where part >= ?', [parts.length]);
  for (const [part, body] of parts.entries()) {
    await q('insert into office_snapshot (part, version, body) values (?, ?, ?) on conflict (part) do update set version = excluded.version, body = excluded.body', [part, version, body]);
  }
  const db = liteDbOf(q);
  onCommit(q, () => MEMORY.set(db, snapshotOf(office, version)));
}

async function listsFromTables(q: Query): Promise<OfficeLists> {
  const lists: Record<string, unknown> = {};
  for (const c of OFFICE_COLLECTIONS) {
    const spec = tableOf(c);
    const rows = await q<{ ord: number; doc: Record<string, unknown> }>(`select rowid as ord, doc from ${spec.table}`);
    rows.sort((a, b) => a.ord - b.ord);
    lists[c] = collectionOf(spec, rows.map((row) => row.doc));
  }
  return lists as unknown as OfficeLists;
}

/**
 * The office lists at the office_meta version: from memory, else from the snapshot rows, else from every office table (no
 * snapshot yet, or an old one). A read inside a transaction that wrote keeps nothing in memory: it may still roll back.
 */
export async function readLiteOffice(db: LiteDb, q: Query): Promise<OfficeSnapshot> {
  const [meta] = await q<{ version: number }>('select version from office_meta where id = 1');
  const version = Number(meta.version);
  const held = MEMORY.get(db);
  if (held && held.version === version) return held;
  const parts = await q<{ version: number; body: string }>('select version, body from office_snapshot order by part');
  const current = parts.length > 0 && parts.every((part) => Number(part.version) === version);
  const lists = current ? (JSON.parse(parts.map((part) => part.body).join('')) as OfficeLists) : await listsFromTables(q);
  const snapshot = snapshotOf(lists, version);
  if (!wroteIn(q)) MEMORY.set(db, snapshot);
  return snapshot;
}
