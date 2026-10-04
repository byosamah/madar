import { createApi, type Api, type CallMap, type CallMeta } from '../../src/api/client';
import { ApiError } from '../../src/api/errors';
import { memoryPersister } from '../../src/api/persist';
import { Store, type State } from '../../src/api/store';
import { now as clockNow } from '../../src/lib/dates';
import type { CallEntry } from '../core/serverCallMap';
import type { ChangeSignal, Principal, RunRequest, RunResult, StoryRef } from '../core/types';
import { TABLES } from '../data/tables';
import type { FixedClock } from './fakes/clock';
import { callProblems } from './invariants';

/**
 * The mirror store of db mode (TM 3.3; task D1). testApi() returns it when MADAR_DB=1 (src/test/factories.ts), so the API tests
 * run on the real load, run and save steps with no edit. It stays synchronous: t.store.state is the in-memory office of the test,
 * as today, and all database work waits for the first call. The server call map and the shadow run load with that first call
 * too (loadServer), because server/test/db.ts loads this file before the test file, and a test file's vi.mock does not reach a
 * module that is already loaded.
 *
 * For each call, one at a time:
 *   1. Check the name against the call map of the test, as createApi does. A call that the server does not have (the prototype
 *      controls, files.get) runs in memory on the mirror, and its change goes down with the next call.
 *   2. Write down: every difference between the mirror and the last image of the database (the test's direct edits) goes to the
 *      database as the setup role, with no rule check.
 *   3. Story IDs: a made-up ID (cor_late) is a placeholder of the batch scope that this test keeps for all its calls, so its first
 *      write mints a real story and later calls join it. A server story ID (sty_...) goes as itself. Inputs get the real IDs.
 *   4. Run the real runCall as the current person of the mirror. This is the one place where a test chooses the person without a
 *      sign-in; the HTTP route never has it.
 *   5. Read back the whole office, events too, and merge it into the mirror in place, so held objects see the new values, removed
 *      records go and new ones come in, in the order of the database. Real story IDs map back to the test's names.
 *   6. The free checks (invariants.ts) and the shadow run (shadow.ts). A problem fails the call with an Error that names it.
 *   7. Return the output, or throw the ApiError of the server with its code.
 */

/** What the mirror needs from a database: server/test/db.ts gives the local stack, the unit test the memory data of runCall. */
export interface MirrorBackend {
  /**
   * The mirror that wrote last. A mirror whose mark is not here reads the database again before its write-down: another mirror of
   * the same test wrote in between, or the test transaction rolled back (the backend clears the mark then).
   */
  owner: unknown;
  /** Opens the transaction of the test, once. */
  begin(): Promise<void>;
  /** Writes every difference from before to after (both in the server form), as the setup role. True when it wrote something. */
  writeDown(before: State, after: State): Promise<boolean>;
  run(req: RunRequest, calls: ReadonlyMap<string, CallEntry>): Promise<RunResult>;
  /** The whole office as the database holds it, events too, with undoneBy filled. */
  readBack(): Promise<State>;
  /** One checksum over every table, server tables included. */
  checksum(): Promise<string>;
  /** Every signal sent through deps.signal. */
  readonly signals: readonly ChangeSignal[];
  /** The clock of deps: the harness sets it to the test clock before each call. */
  readonly clock: FixedClock;
}

export type DbTestApi<M extends CallMap> = { store: Store; api: Api<M>; as(userId: string): void };

const SERVER_STORY = /^sty_[a-z2-7]{22}$/;

/** The parts of a State that the database holds: the collections and the counters. */
export function officeOf(state: State): Record<string, unknown> {
  const lists = state as unknown as Record<string, unknown>;
  return { ...Object.fromEntries(TABLES.map((spec) => [spec.collection, lists[spec.collection] ?? (spec.collection === 'settings' ? undefined : {})])), counters: state.counters };
}

/** A deep copy with every string that is a key of the map replaced by its value. */
export function renamed<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return structuredClone(value);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return map.get(v) ?? v;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([key, inner]) => [key, walk(inner)]));
    return v;
  };
  return walk(value) as T;
}

/** Makes target equal to source, keeping the target object. */
function assignInPlace(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  Object.assign(target, source);
  return target;
}

/**
 * Merges the database office into the mirror in place: each record object stays, a collection keeps its object and takes the
 * order of the database. A collection that the mirror lacks stays absent while the database has none of it, so a test that
 * compares the whole office sees no new empty list.
 */
export function mergeInto(mirror: State, fresh: State): void {
  const lists = mirror as unknown as Record<string, Record<string, Record<string, unknown>> | undefined>;
  const freshLists = fresh as unknown as Record<string, Record<string, Record<string, unknown>> | undefined>;
  for (const spec of TABLES) {
    const c = spec.collection;
    if (c === 'settings') {
      assignInPlace(mirror.settings as unknown as Record<string, unknown>, fresh.settings as unknown as Record<string, unknown>);
      continue;
    }
    const source = freshLists[c] ?? {};
    let map = lists[c];
    if (!map) {
      if (Object.keys(source).length === 0) continue;
      map = lists[c] = {};
    }
    const old = { ...map };
    for (const key of Object.keys(map)) delete map[key];
    for (const [key, rec] of Object.entries(source)) map[key] = old[key] ? assignInPlace(old[key], rec) : rec;
  }
  assignInPlace(mirror.counters, fresh.counters);
}

type ServerParts = { serverCallMap: ReadonlyMap<string, CallEntry>; shadowProblems: typeof import('./shadow').shadowProblems; readsPrepared: typeof import('./shadow').readsPrepared };
let serverParts: Promise<ServerParts> | undefined;

/** The call map of the server and the shadow run, which load every handler: loaded at the first call, once for each test file. */
function loadServer(): Promise<ServerParts> {
  serverParts ??= Promise.all([import('../core/serverCallMap'), import('./shadow')]).then(([map, shadow]) => ({
    serverCallMap: map.serverCallMap, shadowProblems: shadow.shadowProblems, readsPrepared: shadow.readsPrepared,
  }));
  return serverParts;
}

/** The call map of the server, with the test's own definition where a test passes one under a shared name. */
function callMapOf(calls: CallMap, serverCallMap: ReadonlyMap<string, CallEntry>): ReadonlyMap<string, CallEntry> {
  const map = new Map<string, CallEntry>();
  for (const [name, def] of Object.entries(calls)) {
    const entry = serverCallMap.get(name);
    if (!entry) continue;
    if (entry.kind === 'shared' && entry.def !== def) {
      map.set(name, { ...entry, def, input: def.wire?.input ?? def.input, readOnly: def.readOnly === true });
    } else {
      map.set(name, entry);
    }
  }
  return map;
}

export function createDbApi<M extends CallMap>(calls: M, state: State, backend: MirrorBackend): DbTestApi<M> {
  const store = new Store(state, memoryPersister());
  const memoryApi = createApi(calls, { store, latencyMs: 0 });
  let callMap: ReadonlyMap<string, CallEntry> | undefined;
  /** The made-up story IDs of this test and their real stories: the batch scope's placeholder map, kept for every call. */
  const refs = new Map<string, string>();
  const back = () => new Map([...refs].map(([madeUp, real]) => [real, madeUp]));
  const mark = {};
  let image: State | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  function principalOf(userId: string): Principal {
    return store.state.users[userId]?.kind === 'agent' ? { userId, agent: { clientId: 'db-mode' } } : { userId };
  }

  async function invoke(name: string, input: unknown, meta: CallMeta): Promise<{ output: unknown; storyId: string; changed: boolean }> {
    if (!calls[name]) throw new ApiError('not_found', `There is no call named ${name}.`);
    const server = await loadServer();
    const map = (callMap ??= callMapOf(calls, server.serverCallMap));
    const entry = map.get(name);
    if (!entry) return memoryApi.run(name, input as never, meta);

    await backend.begin();
    if (backend.owner !== mark || !image) {
      image = await backend.readBack();
      backend.owner = mark;
    }
    const wanted = renamed(store.state, refs);
    if (await backend.writeDown(image, wanted)) image = await backend.readBack();

    const cid = meta.correlationId;
    const story: StoryRef | undefined = cid === undefined ? undefined : SERVER_STORY.test(cid) ? { id: cid } : { ref: cid };
    const serverInput = renamed(input, refs);
    const actorId = store.state.session.currentUserId;
    const now = clockNow();
    backend.clock.set(now);
    const beforeSum = await backend.checksum();
    const sentBefore = backend.signals.length;
    const result = await backend.run(
      { principal: principalOf(actorId), name, input: serverInput, ...(story ? { story } : {}), ...(meta.key ? { key: meta.key } : {}), batch: { storyRefs: refs, overviewCalls: 0 } },
      map,
    );
    const after = await backend.readBack();
    const afterSum = await backend.checksum();
    const before = image;
    image = after;
    mergeInto(store.state, renamed(after, back()));

    const problems = callProblems({
      name, readOnly: entry.readOnly, ok: result.ok, beforeSum, afterSum, before, after, signals: backend.signals.slice(sentBefore),
    });
    if (problems.length === 0 && entry.kind === 'shared') {
      problems.push(...(await server.shadowProblems({ name, input: serverInput, actorId, now, office: before, result, after, readsPrepared: server.readsPrepared(entry) })));
    }
    if (problems.length > 0) throw new Error(`db mode: ${problems.join('\ndb mode: ')}`);
    if (!result.ok) throw new ApiError(result.error.code, result.error.message, result.error.details ?? {});
    const names = back();
    return { output: renamed(result.output, names), storyId: result.storyId ? (names.get(result.storyId) ?? result.storyId) : '', changed: result.changed };
  }

  /** One call at a time: the calls of a test share one connection and one image of the database. */
  function serial(name: string, input: unknown, meta: CallMeta) {
    const turn = queue.then(() => invoke(name, input, meta));
    queue = turn.catch(() => undefined);
    return turn;
  }

  const api: Api<M> = {
    call: ((name: string, input: unknown, meta: CallMeta = {}) => serial(name, input, meta).then((r) => r.output)) as Api<M>['call'],
    run: ((name: string, input: unknown, meta: CallMeta = {}) => serial(name, input, meta)) as Api<M>['run'],
  };
  return {
    store,
    api,
    as(userId: string): void {
      store.state.session.currentUserId = userId;
    },
  };
}

