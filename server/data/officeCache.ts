import type { State } from '../../src/api/store';
import type { Deps, Query } from '../core/ports';
import { OFFICE_COLLECTIONS, type OfficeCollection, type OfficeSnapshot } from '../core/types';
import { tableOf } from './tables';

/**
 * The office lists in module memory (plan 4.7; task C2): users, teams, settings, clients, stage and task templates, projects,
 * members, stages, deadlines and conversations, at the office_meta.version it read.
 *
 * - Each request reads office_meta (one small row) inside the call's transaction: a read inside its snapshot, a write after the
 *   lock. The same version gives the cached snapshot. A newer version loads only the office rows with "chg" above the cached
 *   version, and the office_deletes rows above it. Every office row comes in one statement (union all), so a refresh is one round
 *   trip.
 * - The cache holds only rows it read from the database, so it holds only committed data, or the data of the open transaction that
 *   read it. A call's own change reaches the cache on a later request, through the version.
 * - A full load runs on a cold start, and when the cache may have missed a delete: the job keeps office_deletes rows for
 *   OFFICE_DELETES_KEEP_DAYS, so a cache that was last known current more than KEEP_DAYS - 1 days ago (by the database clock)
 *   loads everything again.
 * - The snapshot is deep-frozen: a write into a cached object throws. A loader gives each call its own deep copy.
 * - The users keep their auth_user_id beside the snapshot (userIdOfAuth), for the sign-in lookup of the batch route.
 */

/** How long the 15-minute job (track N3) keeps office_deletes rows. The cache relies on it, so the job imports it. */
export const OFFICE_DELETES_KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

type Rec = Record<string, unknown>;
type Entry = { ord: number; doc: Rec; auth?: string | null };
type Tables = Map<OfficeCollection, Map<string, Entry>>;
type Cached = { version: number; syncedAt: number; tables: Tables; snapshot: OfficeSnapshot };

export type OfficeCacheDeps = Pick<Deps, 'db' | 'meter'>;
export type OfficeCache = {
  read(deps: OfficeCacheDeps, q?: Query): Promise<OfficeSnapshot>;
  /** The version the cache holds, or null when it is cold. */
  version(): number | null;
  clear(): void;
};

const META_SQL = 'select version, now() as at from office_meta';

/**
 * Every office row with "chg" above $1, in one statement: the collection, the key, the insertion order, the doc, and the
 * auth_user_id of a user row. A full load passes -1.
 */
export const OFFICE_ROWS_SQL = OFFICE_COLLECTIONS.map((c) => {
  const table = tableOf(c).table;
  return `select '${c}' as c, id, ord, doc, ${c === 'users' ? 'auth_user_id::text' : 'null::text'} as auth from ${table} where chg > $1::bigint`;
}).join(' union all ');
export const OFFICE_DELETES_SQL = 'select tbl, id from office_deletes where chg > $1::bigint';

/** Freezes an object and everything inside it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Rec)) deepFreeze(inner);
  }
  return value;
}

const authOf = new WeakMap<OfficeSnapshot, ReadonlyMap<string, string>>();

/** The Madar user id of a sign-in (auth.users id), from the snapshot the cache gave. Undefined when no user has it. */
export function userIdOfAuth(snapshot: OfficeSnapshot, authUserId: string): string | undefined {
  return authOf.get(snapshot)?.get(authUserId);
}

/** A frozen snapshot of office lists, in the order they are given. Tests and the db-mode harness make one from a State. */
export function snapshotOf(lists: Pick<State, OfficeCollection>, version: number, auth: ReadonlyMap<string, string> = new Map()): OfficeSnapshot {
  const copy = Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, structuredClone(lists[c] ?? {})])) as OfficeSnapshot['lists'];
  const snapshot = deepFreeze({ version, lists: copy }) as OfficeSnapshot;
  authOf.set(snapshot, auth);
  return snapshot;
}

function build(tables: Tables, version: number): OfficeSnapshot {
  const lists: Record<string, unknown> = {};
  const auth = new Map<string, string>();
  for (const [id, entry] of tables.get('users') ?? []) if (entry.auth) auth.set(entry.auth, id);
  for (const c of OFFICE_COLLECTIONS) {
    const entries = [...(tables.get(c)?.values() ?? [])].sort((a, b) => a.ord - b.ord);
    lists[c] = c === 'settings' ? entries[0]?.doc : Object.fromEntries(entries.map((entry) => [tableOf(c).key(entry.doc), entry.doc]));
  }
  const snapshot = deepFreeze({ version, lists }) as unknown as OfficeSnapshot;
  authOf.set(snapshot, auth);
  return snapshot;
}

export function createOfficeCache(o: { keepMs?: number } = {}): OfficeCache {
  const keepMs = o.keepMs ?? (OFFICE_DELETES_KEEP_DAYS - 1) * DAY_MS;
  let cached: Cached | undefined;

  async function rowsAbove(deps: OfficeCacheDeps, q: Query, version: number) {
    const rows = await q<{ c: OfficeCollection; id: string; ord: string | number; doc: Rec; auth: string | null }>(OFFICE_ROWS_SQL, [version]);
    const deletes = version < 0 ? [] : await q<{ tbl: string; id: string }>(OFFICE_DELETES_SQL, [version]);
    deps.meter.addBytes(new TextEncoder().encode(JSON.stringify(rows) + JSON.stringify(deletes)).length);
    return { rows, deletes };
  }

  async function refresh(deps: OfficeCacheDeps, q: Query, version: number, at: number): Promise<OfficeSnapshot> {
    const from = cached && cached.version < version && at - cached.syncedAt <= keepMs ? cached : undefined;
    const tables: Tables = new Map(OFFICE_COLLECTIONS.map((c) => [c, new Map(from?.tables.get(c))]));
    const { rows, deletes } = await rowsAbove(deps, q, from ? from.version : -1);
    const byTable = new Map(OFFICE_COLLECTIONS.map((c) => [tableOf(c).table, c]));
    // A row deleted and then written again (an Undo) is in both lists: the delete goes first, the row stays.
    for (const gone of deletes) tables.get(byTable.get(gone.tbl)!)?.delete(gone.id);
    for (const row of rows) tables.get(row.c)!.set(row.id, { ord: Number(row.ord), doc: row.doc, auth: row.auth });
    const snapshot = build(tables, version);
    cached = { version, syncedAt: at, tables, snapshot };
    return snapshot;
  }

  const cache: OfficeCache = {
    async read(deps, q) {
      if (!q) return deps.db.tx('read', (inner) => cache.read(deps, inner));
      const [meta] = await q<{ version: string | number; at: Date | string }>(META_SQL);
      const version = Number(meta.version);
      const at = new Date(meta.at).getTime();
      if (cached && cached.version === version) {
        // Still current at this time, so no delete above the version happened before it.
        if (at > cached.syncedAt) cached.syncedAt = at;
        return cached.snapshot;
      }
      return refresh(deps, q, version, at);
    },
    version: () => cached?.version ?? null,
    clear() {
      cached = undefined;
    },
  };
  return cache;
}

/** One cache for each office: the database and the lock key of the office (each db-mode worker has its own). */
const caches = new Map<string, OfficeCache>();

function cacheOf(deps: Deps): OfficeCache {
  const key = `${deps.config.supabaseUrl}|${deps.config.lockKey}`;
  let cache = caches.get(key);
  if (!cache) {
    cache = createOfficeCache();
    caches.set(key, cache);
  }
  return cache;
}

/**
 * The office lists in module memory, at the office_meta.version it read (plan 4.7).
 * q: read inside a transaction that is open (runCall). Without q, one read of its own, for example the sign-in lookup of the batch route (E3).
 */
export function readOffice(deps: Deps, q?: Query): Promise<OfficeSnapshot> {
  return cacheOf(deps).read(deps, q);
}

/** Forgets every cached office. The db-mode harness calls it when a test transaction rolls back (plan 7.2). */
export function clearOfficeCaches(): void {
  caches.clear();
}

