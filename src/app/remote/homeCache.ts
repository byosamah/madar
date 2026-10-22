import { hashKey, type QueryClient } from '@tanstack/react-query';
import type { CallName } from '../../api/calls';
import { todayMeetingsInput } from '../../features/meetings/readInputs';
import { todayISO } from '../../lib/dates';
import type { AuthPort } from '../auth';
import type { Runtime } from '../runtime';
import { whenIdle } from '../whenIdle';

/**
 * The last Home lists of one person on this device (performance audit 2026-10-21, DF-14, owner: "keep the last Home lists of each
 * person in the browser, show them at once, replace them with fresh data in about 1 s. Clear at sign-out and on a role change").
 * The real build only. The prototype stores nothing.
 *
 * What is kept: the answers of the reads that a cold Home sends in its first request (`homeKeys`), one record for each auth user id,
 * in a small IndexedDB of its own. The record holds the build and the time. A record of another build, or older than 7 days, is
 * ignored and deleted. Safari can delete the data of a site and can refuse IndexedDB: every step fails soft and gives the plain load.
 *
 * The start: the read runs next to the first request, never before it. It waits 150 ms at most. Each stored answer goes into the
 * query cache with its stored time, and the same read goes to the server at once (the real build keeps an answer until a change
 * signal names it, so a stored answer would stay for ever): the fresh answer replaces it.
 * The write: after the fresh answers settle (at idle), then at most once a minute.
 * The clear: at a sign-out, at the end of the session, when another person signs in, and when the fresh session shows another role
 * or other rights than the stored one (the shown stored answers go at once).
 * Never kept: a token or a file link. The reads below hold none.
 */

export const HOME_DB = 'madar-home-cache';
const STORE = 'last';
/** A record older than this is ignored and deleted. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** A record over this size is not written. */
export const MAX_BYTES = 1_000_000;
/** The read at the start gives up after this time. */
export const READ_LIMIT_MS = 150;
/** The write after a change waits for this time since the last write. */
export const WRITE_GAP_MS = 60_000;

type Entry = { key: unknown[]; data: unknown; at: number };
export type HomeRecord = { build: string; at: number; fingerprint: string; entries: Entry[] };

/** The reads of a cold Home in its first request, for a role and a day. The stored list and the written list use this one function. */
export function homeKeys(role: string | undefined, today: string): unknown[][] {
  const admin = role === 'admin';
  return [
    ['api', 'session.get', {}],
    ['api', 'chats.unreadCount', {}],
    ['api', 'notifications.count', {}],
    ['api', 'tasks.list', { filter: 'mine' }],
    ['api', 'tasks.list', { filter: 'review_for_me' }],
    ['api', 'meetings.list', todayMeetingsInput(today)],
    ['api', 'projects.list', admin ? { filter: 'all', sort: 'deadline' } : { filter: 'mine', status: 'all', sort: 'deadline' }],
    ['api', 'subCompanies.list', {}],
    ['api', 'users.list', {}],
  ];
}

const HOME_NAMES = new Set<string>(homeKeys(undefined, '').map((key) => key[1] as string));

type SessionLike = { user?: { systemRole?: string; roleId?: string | null }; authority?: { officeRights?: string[] } };

/** The role and the rights of a session answer, as one text. Another text means another role or other rights. */
export function fingerprintOf(session: unknown): string {
  const s = (session ?? {}) as SessionLike;
  const rights = [...(s.authority?.officeRights ?? [])].sort().join(',');
  return `${s.user?.systemRole ?? ''}|${s.user?.roleId ?? ''}|${rights}`;
}

// ---- IndexedDB, with no package. Each step opens the database and closes it, so a delete never waits for a held connection. ----

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('No IndexedDB.'));
      return;
    }
    const request = indexedDB.open(HOME_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB failed.'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB failed.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB stopped.'));
    });
  } finally {
    db.close();
  }
}

/** Every clear raises this. A write or a start that began before a clear sees the new number and stops. */
let epoch = 0;

/** Deletes the whole database: every record of every person. It never creates one. Never throws. */
export async function clearHomeCache(): Promise<void> {
  epoch += 1;
  try {
    if (typeof indexedDB === 'undefined') return;
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(HOME_DB);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  } catch {
    // Blocked or missing IndexedDB: there is nothing to clear.
  }
}

async function deleteRecord(userId: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(userId));
  } catch {
    // The next start asks again.
  }
}

/** Deletes the records of every other person (a clear that did not finish, or a person who left). */
async function pruneOthers(userId: string): Promise<void> {
  try {
    const keys = await withStore('readonly', (store) => store.getAllKeys());
    for (const key of keys) if (key !== userId) await deleteRecord(String(key));
  } catch {
    // Nothing to prune.
  }
}

/** Saves the record of one person. Never throws. */
export async function saveHomeRecord(userId: string, record: HomeRecord): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(record, userId));
  } catch {
    // A full disk or a refused database: the next start loads as before.
  }
}

/** The stored record of one person, or null when there is none, the read fails, or it takes longer than the limit. */
export async function readHomeRecord(userId: string, limitMs: number = READ_LIMIT_MS): Promise<HomeRecord | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), limitMs);
  });
  const read = withStore<unknown>('readonly', (store) => store.get(userId)).then((value) => (isRecord(value) ? value : null), () => null);
  try {
    return await Promise.race([read, late]);
  } finally {
    clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is HomeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Partial<HomeRecord>;
  return typeof r.build === 'string' && typeof r.at === 'number' && typeof r.fingerprint === 'string' && Array.isArray(r.entries);
}

// ---- The query cache side ----

export type HomeCacheOptions = {
  queryClient: QueryClient;
  runtime: Pick<Runtime, 'api' | 'auth' | 'mode'>;
  /** VITE_MADAR_BUILD. A record of another build is ignored. */
  build: string;
  today?: () => string;
  readLimitMs?: number;
  gapMs?: number;
};

const hashOf = (key: readonly unknown[]) => hashKey(key);

/**
 * Starts the stored Home lists for the person who is signed in, and follows the sign-in port: a sign-out clears, another person
 * clears and starts new. Returns the stop. The prototype and a port with no user id store nothing.
 */
export function startHomeCache(o: HomeCacheOptions): () => void {
  const { runtime } = o;
  const auth: AuthPort | undefined = runtime.auth;
  if (runtime.mode !== 'remote' || !auth?.userId) return () => undefined;
  let active: { userId: string; stop: () => void } | undefined;
  let first = true;

  const signedInId = (): string | null => (auth.status() === 'signed_in' ? auth.userId?.() ?? null : null);
  const follow = () => {
    const id = signedInId();
    if (active?.userId === id) return;
    if (active) {
      active.stop();
      active = undefined;
      // The person left or another person came: nothing of the first person stays on this device.
      void clearHomeCache();
    }
    if (id) {
      active = { userId: id, ...begin(o, id, first, signedInId) };
    } else if (first) {
      // A start with no session: a record that stayed behind goes.
      void clearHomeCache();
    }
    first = false;
  };
  follow();
  const off = auth.subscribe(follow);
  return () => {
    off();
    active?.stop();
    active = undefined;
  };
}

/** One signed-in person: the read at the start (only for the first sign-in of this page) and the writes. */
function begin(o: HomeCacheOptions, userId: string, hydrateNow: boolean, signedInId: () => string | null): { stop: () => void } {
  const { queryClient, build } = o;
  const now = Date.now;
  const today = o.today ?? (() => todayISO());
  const gapMs = o.gapMs ?? WRITE_GAP_MS;
  const cache = queryClient.getQueryCache();
  const startedAt = now();
  const startEpoch = epoch;
  let stopped = false;
  /** The answers that came from the record and were not replaced yet: hash -> stored time. */
  const shown = new Map<string, number>();
  /** The role and rights of the record that was shown. Empty when nothing was shown. */
  let shownFingerprint: string | undefined;
  let lastJson = '';
  let lastWrite = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const alive = () => !stopped && epoch === startEpoch;

  function show(record: HomeRecord): void {
    // The fresh session came first (a late read): when it names another role or other rights, the record fits no more.
    const freshSession = cache.find({ queryKey: ['api', 'session.get', {}], exact: true })?.state.data;
    if (freshSession !== undefined && fingerprintOf(freshSession) !== record.fingerprint) {
      void deleteRecord(userId);
      return;
    }
    const wanted = new Set(homeKeys(roleOf(record), today()).map(hashOf));
    for (const entry of record.entries) {
      const hash = hashOf(entry.key);
      if (!wanted.has(hash) || typeof entry.at !== 'number' || !shapeOk(entry.key[1] as string, entry.data)) continue;
      const query = cache.find({ queryKey: entry.key, exact: true });
      // A fresh answer that came first wins. Only a query with no data takes the stored one.
      if (query && query.state.data !== undefined) continue;
      queryClient.setQueryData(entry.key, entry.data, { updatedAt: entry.at });
      shown.set(hash, entry.at);
      shownFingerprint = record.fingerprint;
      // The fresh answer follows at once. A read that is already on the wire is joined, not sent again.
      const [, name, input] = entry.key as ['api', CallName, never];
      void queryClient.fetchQuery({ queryKey: entry.key, queryFn: () => o.runtime.api.call(name, input), staleTime: 0 }).catch(() => undefined);
    }
  }

  async function start(): Promise<void> {
    void pruneOthers(userId);
    const record = await readHomeRecord(userId, o.readLimitMs ?? READ_LIMIT_MS);
    if (!record) return;
    const age = now() - record.at;
    if (record.build !== build || age < 0 || age > MAX_AGE_MS) {
      await deleteRecord(userId);
      return;
    }
    if (!alive() || signedInId() !== userId) return;
    show(record);
  }

  /** Drops the stored answers that still show, after the fresh session names another role or other rights. */
  function dropShown(): void {
    const hashes = new Set(shown.keys());
    shown.clear();
    void deleteRecord(userId);
    void queryClient.resetQueries({ predicate: (query) => query.queryKey[0] === 'api' && hashes.has(hashOf(query.queryKey)) });
  }

  function collect(): HomeRecord | null {
    const session = queryClient.getQueryData<SessionLike>(['api', 'session.get', {}]);
    if (!session?.user) return null;
    const keys = homeKeys(session.user.systemRole, today());
    const entries: Entry[] = [];
    for (const key of keys) {
      const query = cache.find({ queryKey: key, exact: true });
      if (!query) continue;
      // Settling: no wait on a read that runs. Fresh: an answer of this page and this person, never a stored one.
      if (query.state.fetchStatus === 'fetching') return null;
      if (query.state.status !== 'success' || query.state.dataUpdatedAt < startedAt || shown.has(hashOf(key))) continue;
      entries.push({ key, data: query.state.data, at: query.state.dataUpdatedAt });
    }
    const names = new Set(entries.map((entry) => entry.key[1]));
    // Home needs the session and both task lists. Without them a record shows nothing.
    if (!names.has('session.get') || entries.filter((entry) => entry.key[1] === 'tasks.list').length < 2) return null;
    return { build, at: now(), fingerprint: fingerprintOf(session), entries };
  }

  function write(): void {
    if (!alive() || signedInId() !== userId) return;
    const record = collect();
    if (!record) return;
    const json = JSON.stringify(record.entries.map((entry) => [entry.key, entry.data]));
    if (json === lastJson) return;
    if (json.length > MAX_BYTES) return;
    lastJson = json;
    lastWrite = now();
    void saveHomeRecord(userId, record);
  }

  function schedule(): void {
    if (timer !== undefined || !alive()) return;
    const wait = lastWrite === 0 ? 0 : Math.max(0, lastWrite + gapMs - now());
    timer = setTimeout(() => {
      timer = undefined;
      whenIdle(write);
    }, wait);
  }

  const unsubscribe = cache.subscribe((event) => {
    if (event.type !== 'updated' || (event.action.type !== 'success' && event.action.type !== 'error')) return;
    const { query } = event;
    const name = query.queryKey[0] === 'api' ? String(query.queryKey[1]) : '';
    if (!HOME_NAMES.has(name)) return;
    const fresh = event.action.type === 'success' && !(event.action as { manual?: boolean }).manual;
    if (fresh) shown.delete(hashOf(query.queryKey));
    if (fresh && name === 'session.get' && shownFingerprint !== undefined) {
      // The first fresh session decides once whether the stored lists still fit this role and these rights.
      const changed = fingerprintOf(query.state.data) !== shownFingerprint;
      shownFingerprint = undefined;
      if (changed) dropShown();
    }
    schedule();
  });

  if (hydrateNow) void start().catch(() => undefined);

  return {
    stop() {
      stopped = true;
      unsubscribe();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** A cheap check of a stored answer, so a damaged record never reaches a screen. */
function shapeOk(name: string, data: unknown): boolean {
  if (name === 'session.get') return typeof data === 'object' && data !== null && typeof (data as SessionLike).user === 'object';
  if (name === 'chats.unreadCount' || name === 'notifications.count') return typeof data === 'object' && data !== null;
  return Array.isArray(data);
}

/** The role of a record: the system role inside its stored session answer. */
function roleOf(record: HomeRecord): string | undefined {
  const session = record.entries.find((entry) => entry.key[1] === 'session.get')?.data as SessionLike | undefined;
  return session?.user?.systemRole;
}
