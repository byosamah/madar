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
 * The rule for every write of an office table or of a sign-in link (the save, the harness write-down, the import,
 * setLiteAuthLink): in the same transaction it raises office_meta.version and calls writeOfficeSnapshot with the whole office
 * lists after the write.
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

/** The sign-in links (Supabase exit, wave 2): auth_users.id to users.id. The snapshot body carries them, for principalOf. */
export const LINKS_LITE = 'select id, user_id from auth_users where user_id is not null';

type Links = [authId: string, userId: string][];
type Body = { lists: OfficeLists; links: Links };

async function linksOf(q: Query): Promise<Links> {
  return (await q<{ id: string; user_id: string }>(LINKS_LITE)).map((row) => [row.id, row.user_id]);
}

/** A body of wave 1 holds the lists alone and no link. */
function bodyOf(text: string): Body {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return Array.isArray(parsed.links) && parsed.lists !== undefined ? (parsed as unknown as Body) : { lists: parsed as unknown as OfficeLists, links: [] };
}

/**
 * Writes the snapshot of the office lists and the sign-in links at a version, inside the transaction of q, and puts it into memory
 * after the commit. The links come from auth_users (about 15 rows read, only on an office write), so a save never needs them.
 */
export async function writeOfficeSnapshot(q: Query, lists: OfficeLists, version: number): Promise<void> {
  const office = listsOf(lists);
  const links = await linksOf(q);
  const parts = partsOf(JSON.stringify({ lists: office, links } satisfies Body));
  await q('delete from office_snapshot where part >= ?', [parts.length]);
  for (const [part, body] of parts.entries()) {
    await q('insert into office_snapshot (part, version, body) values (?, ?, ?) on conflict (part) do update set version = excluded.version, body = excluded.body', [part, version, body]);
  }
  const db = liteDbOf(q);
  onCommit(q, () => MEMORY.set(db, snapshotOf(office, version, new Map(links))));
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
  const body = current ? bodyOf(parts.map((part) => part.body).join('')) : { lists: await listsFromTables(q), links: await linksOf(q) };
  const snapshot = snapshotOf(body.lists, version, new Map(body.links));
  if (!wroteIn(q)) MEMORY.set(db, snapshot);
  return snapshot;
}

/**
 * Writes (or with null clears) the sign-in link of a Madar person, the SQLite twin of setAuthUserId (officeCache.ts). One
 * transaction: the link moves off any other sign-in row, office_meta.version rises and the snapshot holds the new links, so every
 * later read of the office object and every wake sees it. The lists come from the office before the version rises, so the write
 * reads no office table. False, and no write, for a person who is not in the office.
 */
export async function setLiteAuthLink(q: Query, userId: string, authId: string | null): Promise<boolean> {
  const office = await readLiteOffice(liteDbOf(q), q);
  if (!office.lists.users[userId]) return false;
  const stamp = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
  await q(`update auth_users set user_id = null, updated_at = ${stamp} where user_id = ?1 and id is not ?2`, [userId, authId]);
  if (authId !== null) await q(`update auth_users set user_id = ?1, updated_at = ${stamp} where id = ?2`, [userId, authId]);
  const [meta] = await q<{ version: number }>('update office_meta set version = version + 1 where id = 1 returning version');
  await writeOfficeSnapshot(q, office.lists, Number(meta.version));
  return true;
}
