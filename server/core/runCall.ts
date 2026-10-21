import { invalidInput } from '../../src/api/client';
import { ApiError } from '../../src/api/errors';
import { executeParsed, resolveAuthority } from '../../src/api/execute';
import type { State } from '../../src/api/store';
import { readOffice } from '../data/officeCache';
import { beforeOf } from '../data/loaders/build';
import { loadFor, sqlSource, type Source } from '../data/loaders/index';
import { save, type SaveOptions, type SaveResult } from '../data/save';
import { runErrorOf } from '../http/errors';
import { resolveActor } from './actor';
import { requestHost } from './after';
import { AFTER_ANSWER_KINDS, CHAT_WAIT_MS, outboxRowsOf, processOutbox, WAITED_KINDS, writeOutbox, type OutboxRow } from './effects';
import { digestOf, replay, sqlKeys, type KeyStore, type StoredResult } from './idempotency';
import { busyOf, logLockHold, takeOfficeLock } from './lock';
import type { Deps, Query } from './ports';
import { serverCallMap, type CallEntry, type ServerEntry, type SharedEntry } from './serverCallMap';
import { checkStory, newStoryId, resolveStory, sqlStories, statementStories, type StoryStore } from './story';
import type { ChangeSignal, OfficeSnapshot, RunRequest, RunResult } from './types';

/**
 * Load, run, save (plan 4.5; task C3). The api function, the mcp function, the job and the db-mode tests all run calls here.
 * The sign-in check happens before it: the request names the principal.
 *
 *   1. Find the call in serverCallMap. A call in SERVER_EXCLUDED is not there: not_found.
 *   2. Parse the input with its wire form. A failure gives invalid_input with the details of src/api/client.ts.
 *   3. A server call (one of the 9) runs its own function on the office snapshot and does its own permission checks.
 *   4. A read: one repeatable-read, read-only transaction on the read pool, with no lock. The loader reads one snapshot, so a
 *      read never sees half a story.
 *   5. A write: the preflight hook first, outside the lock. Then on the write pool: the office lock, the office, the actor,
 *      the idempotency key, the story, the prepare hook, the loader, the State before (beforeOf), the shared execute step (authority,
 *      run, output check), the save step, the outbox rows, the key's answer and the change signals, and the commit. Any error
 *      rolls back, so a failed call writes nothing and sends nothing.
 *   6. After the commit: the effects of this call, once, best effort; the 15-minute job retries the rest. On a host with after
 *      (core/after.ts), the mail kinds (AFTER_ANSWER_KINDS) run after the answer, on one chain for each batch, so the mails of
 *      a batch keep their order. The kinds of WAITED_KINDS (push.chat, mail.chatNotice) wait CHAT_WAIT_MS on a chain of their own first.
 *      Every other kind runs before the answer. With no after, every kind runs before it, with no wait.
 *   7. An ApiError becomes { ok: false, error }. Any other error becomes failed, and the log gets the call name.
 *
 * The office: each call reads office_meta through the office cache (plan 4.7), a read inside its snapshot and a write after the
 * lock, so a write never runs on an office older than the last commit. The cache gives back the same frozen snapshot while the
 * version stays, so the batch reads the office lists once. runCall keeps that snapshot in BatchScope.office for the server calls
 * and drops it after an entry that changed the office, so a later entry of the batch sees the change.
 */

/** One transaction of a call: the queries it needs, on the database or (for unit tests) in memory. */
export interface CallTx {
  /** The query of the transaction, for the prepare hooks and the outbox producers. */
  readonly q: Query;
  lock(key: number): Promise<void>;
  office(): Promise<OfficeSnapshot>;
  source(): Source;
  save(before: State, after: State, o: SaveOptions): Promise<SaveResult>;
  readonly stories: StoryStore;
  readonly keys: KeyStore;
  outbox(rows: OutboxRow[]): Promise<string[]>;
}

export interface CallData {
  tx<T>(mode: 'read' | 'write', work: (t: CallTx) => Promise<T>): Promise<T>;
  /** The steps of a transaction that is already open on q (the sign-in read of a batch, SV-5). Absent: the data cannot join it. */
  on?(q: Query): CallTx;
  /** The office in a read of its own: for a server call, and for the actor check before a preflight. */
  office(): Promise<OfficeSnapshot>;
}

/** The data of a call on the database of deps: pgDb, the office cache, the SQL loaders and the diff writer. */
export function sqlData(deps: Deps): CallData {
  const on = (q: Query): CallTx => ({
    q,
    lock: (key) => takeOfficeLock(q, key),
    office: () => readOffice(deps, q),
    source: () => sqlSource(q),
    save: (before, after, o) => save(q, before, after, o),
    stories: sqlStories(q),
    keys: sqlKeys(q),
    outbox: (rows) => writeOutbox(q, rows),
  });
  return {
    tx: (mode, work) => deps.db.tx(mode, (q) => work(on(q))),
    on,
    office: () => readOffice(deps),
  };
}

export type RunCallOptions = {
  calls?: ReadonlyMap<string, CallEntry>;
  data?: (deps: Deps) => CallData;
  /** What runs the effects after the commit. Tests pass a recorder. */
  afterCommit?: (deps: Deps, ids: string[]) => Promise<unknown>;
  /** The wait before the rows of WAITED_KINDS run after the answer. Tests pass a gate. */
  wait?: (ms: number) => Promise<void>;
};

export type RunCall = (deps: Deps, req: RunRequest) => Promise<RunResult>;

/**
 * True for a call that may run inside the open sign-in transaction of its batch (SV-5): a shared read with no preflight hook. A
 * preflight does network work, which must never hold the one read connection. A server call opens its own transactions, and a
 * second transaction inside the first is refused.
 */
export function joinsFirstRead(name: string, calls: ReadonlyMap<string, CallEntry> = serverCallMap): boolean {
  const entry = calls.get(name);
  return entry !== undefined && entry.kind === 'shared' && entry.readOnly && entry.hooks?.preflight === undefined;
}

/** The signals that the actor's own screen receives: the office signal, and the actor's own person signal. */
function ownSignals(signals: ChangeSignal[], actorId: string): ChangeSignal[] {
  return signals.filter((signal) => signal.channel === 'office' || signal.channel === `person:${actorId}`);
}

/** True when the call wrote at least one event under its story, as the fake API counts "changed" (src/api/client.ts). */
function wroteEvents(before: State, after: State, storyId: string): boolean {
  return Object.values(after.events).some((event) => !before.events[event.id] && event.correlationId === storyId);
}

function parseInput(entry: CallEntry, input: unknown): unknown {
  const parsed = entry.input.safeParse(input);
  if (!parsed.success) throw invalidInput(parsed.error);
  return parsed.data;
}

export function createRunCall(o: RunCallOptions = {}): RunCall {
  const calls = o.calls ?? serverCallMap;
  const dataOf = o.data ?? sqlData;
  const afterCommit = o.afterCommit ?? processOutbox;
  const wait = o.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function runServerCall(deps: Deps, req: RunRequest, entry: ServerEntry, parsed: unknown, data: CallData): Promise<RunResult> {
    const office = req.batch.office ?? (await data.office());
    resolveActor(office, req.principal);
    const now = deps.clock.now();
    // Plan 4.9 holds for every write: a server write with a story { id } gets the same check as a shared write. A { ref } and the
    // idempotency key stay with the server call, which runs resolveStory and the key replay in its own transaction.
    if (!entry.readOnly && req.story && 'id' in req.story) await checkStory(statementStories(deps.db), req.story.id, req.principal.userId, now);
    const result = await entry.call(parsed, {
      deps, principal: req.principal, office, batch: req.batch, now, data, ...(req.story ? { story: req.story } : {}), ...(req.key ? { key: req.key } : {}),
    });
    const output = entry.output.safeParse(result.output);
    if (!output.success) throw new ApiError('failed', `The call ${entry.name} returned data in the wrong shape.`, { issues: output.error.issues.length });
    // A server write may change what the office cache holds (an invitation, an agent link): the next entry reads the office again.
    if (!entry.readOnly) req.batch.office = undefined;
    else req.batch.office ??= office;
    return {
      ok: true, output: output.data, changed: result.changed ?? false,
      ...(result.storyId !== undefined ? { storyId: result.storyId } : {}),
      ...(result.signals !== undefined ? { signals: ownSignals(result.signals, req.principal.userId) } : {}),
    };
  }

  function baseOf(deps: Deps, actorId: string, authorityId: string, correlationId: string, now: Date) {
    return { actorId, authorityId, correlationId, now, persistent: true, wireOutput: true, limits: { maxFileBytes: deps.config.limits.maxFileBytes } };
  }

  async function runRead(deps: Deps, req: RunRequest, entry: SharedEntry, parsed: unknown, data: CallData): Promise<RunResult> {
    const actorId = req.principal.userId;
    const now = deps.clock.now();
    let prepared: unknown;
    if (entry.hooks?.preflight) {
      resolveActor(req.batch.office ?? (await data.office()), req.principal);
      prepared = await entry.hooks.preflight(parsed, { actorId, now, deps });
    }
    // known: the office that the open transaction read already (SV-5), so the call does not read office_meta a second time.
    const body = async (t: CallTx, known?: OfficeSnapshot) => {
      const office = known ?? (await t.office());
      resolveActor(office, req.principal);
      const state = await loadFor(entry.name, parsed, { src: t.source(), office, actorId, write: false, now });
      const { authority } = resolveAuthority(state, actorId, entry.def);
      // A read writes no event, so its story is never stored.
      const output = executeParsed(entry.def, entry.name, parsed, state, baseOf(deps, actorId, authority.id, newStoryId(), now), prepared);
      return { output, office };
    };
    let result: { output: unknown; office: OfficeSnapshot };
    if (req.open) {
      const known = req.batch.office;
      if (!data.on || !known || entry.hooks?.preflight) throw new Error(`The call ${entry.name} cannot run inside the open sign-in transaction.`);
      result = await body(data.on(req.open.q), known);
    } else {
      result = await data.tx('read', (t) => body(t));
    }
    const { output, office } = result;
    req.batch.office = office;
    return { ok: true, output, changed: false };
  }

  async function runWrite(deps: Deps, req: RunRequest, entry: SharedEntry, parsed: unknown, data: CallData): Promise<RunResult> {
    const actorId = req.principal.userId;
    const hooks = entry.hooks;
    let preflight: unknown;
    if (hooks?.preflight) {
      // The preflight does network work, so it runs only for an actor that may act, and never under the lock.
      resolveActor(req.batch.office ?? (await data.office()), req.principal);
      preflight = await hooks.preflight(parsed, { actorId, now: deps.clock.now(), deps });
    }
    const digest = req.key !== undefined ? await digestOf(entry.name, parsed) : undefined;

    let lockedAt = 0;
    type Effect = { id: string; kind: string };
    type Done = { result: StoredResult; replayed: boolean; signals: ChangeSignal[]; effects: Effect[]; ref?: string; officeChanged: boolean };
    const work = async (t: CallTx): Promise<Done> => {
      await t.lock(deps.config.lockKey);
      lockedAt = performance.now();
      // The time of the call is taken under the lock, so the stamps of records and events follow the commit order.
      const now = deps.clock.now();
      const office = await t.office();
      resolveActor(office, req.principal);
      if (req.key !== undefined && digest !== undefined) {
        const stored = replay(await t.keys.get(actorId, req.key), digest);
        // A replayed placeholder maps to the stored story, so the next entry of the batch joins it and mints no second story.
        const ref = req.story && 'ref' in req.story && !req.batch.storyRefs.has(req.story.ref) ? { ref: req.story.ref } : {};
        if (stored) return { result: stored, replayed: true, signals: [], effects: [], officeChanged: false, ...ref };
      }
      const story = await resolveStory(t.stories, req.story, req.batch.storyRefs, actorId, now);
      const prepared = hooks?.prepare ? await hooks.prepare(parsed, { actorId, now, deps, q: t.q }, preflight) : preflight;
      const state = await loadFor(entry.name, parsed, { src: t.source(), office, actorId, write: true, now });
      const before = beforeOf(state, office);
      const { authority } = resolveAuthority(state, actorId, entry.def);
      const output = executeParsed(entry.def, entry.name, parsed, state, baseOf(deps, actorId, authority.id, story.storyId, now), prepared);
      const saved = await t.save(before, state, { story: { storyId: story.storyId, actorId } });
      const rows = await outboxRowsOf(entry.name, output, saved, t.q, now);
      // The ids come back in the order of the rows (writeOutbox), so each id keeps the kind of its row.
      const effects = (await t.outbox(rows)).map((id, i) => ({ id, kind: rows[i].kind }));
      const result: StoredResult = { output, storyId: story.storyId, changed: wroteEvents(before, state, story.storyId) };
      if (req.key !== undefined && digest !== undefined) await t.keys.put({ actorId, key: req.key, name: entry.name, digest, result, at: now });
      if (saved.signals.length > 0) await deps.signal.send(t.q, saved.signals);
      return { result, replayed: false, signals: saved.signals, effects, ...(story.ref ? { ref: story.ref } : {}), officeChanged: saved.officeVersion !== undefined };
    };
    let done: Done;
    try {
      done = await data.tx('write', work);
    } finally {
      // Every hold is logged, also the hold of a call that failed after it took the lock.
      if (lockedAt > 0) logLockHold(deps, entry.name, Math.round(performance.now() - lockedAt));
    }

    if (done.ref !== undefined && done.result.storyId !== undefined) req.batch.storyRefs.set(done.ref, done.result.storyId);
    if (done.officeChanged) req.batch.office = undefined;
    if (done.effects.length > 0) {
      const warn = (error: unknown) =>
        deps.log.warn('The effects after the commit did not run. The job tries them again.', { name: entry.name, error: error instanceof Error ? error.message : String(error) });
      const { after } = requestHost();
      const afterEffects = after ? done.effects.filter((e) => AFTER_ANSWER_KINDS.has(e.kind)) : [];
      const later = afterEffects.filter((e) => !WAITED_KINDS.has(e.kind)).map((e) => e.id);
      const waited = afterEffects.filter((e) => WAITED_KINDS.has(e.kind)).map((e) => e.id);
      const now = done.effects.filter((e) => !later.includes(e.id) && !waited.includes(e.id)).map((e) => e.id);
      if (now.length > 0) {
        try {
          await afterCommit(deps, now);
        } catch (error) {
          warn(error);
        }
      }
      if (after && later.length > 0) {
        const chain = (req.batch.mail ?? Promise.resolve()).then(() => afterCommit(deps, later)).then(() => undefined, warn);
        req.batch.mail = chain;
        after(chain);
      }
      // The chat push and the chat mention mail wait CHAT_WAIT_MS on a chain of their own, so a person who reads the chat in this time
      // gets neither (chat design item 20). The sleep costs no CPU. If the host stops the work, the job runs the rows later.
      if (after && waited.length > 0) after(wait(CHAT_WAIT_MS).then(() => afterCommit(deps, waited)).then(() => undefined, warn));
    }
    const own = ownSignals(done.signals, actorId);
    return {
      ok: true, output: done.result.output, changed: done.result.changed,
      ...(done.result.storyId !== undefined ? { storyId: done.result.storyId } : {}),
      ...(own.length > 0 ? { signals: own } : {}),
    };
  }

  return async function run(deps: Deps, req: RunRequest): Promise<RunResult> {
    try {
      const entry = calls.get(req.name);
      if (!entry) throw new ApiError('not_found', `There is no call named ${req.name}.`);
      const parsed = parseInput(entry, req.input);
      const data = dataOf(deps);
      if (req.open && !joinsFirstRead(req.name, calls)) throw new Error(`The call ${req.name} cannot run inside the open sign-in transaction.`);
      if (entry.kind === 'server') return await runServerCall(deps, req, entry, parsed, data);
      if (entry.readOnly) return await runRead(deps, req, entry, parsed, data);
      return await runWrite(deps, req, entry, parsed, data);
    } catch (error) {
      const busy = busyOf(error);
      if (busy) return { ok: false, error: runErrorOf(busy) };
      if (!(error instanceof ApiError)) {
        deps.log.error('A call failed.', { name: req.name, error: error instanceof Error ? error.message : String(error) });
      }
      return { ok: false, error: runErrorOf(error) };
    }
  };
}

/** Load, run, save (plan 4.5) on the database of deps. */
export const runCall: RunCall = createRunCall();
