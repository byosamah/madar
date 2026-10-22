import { hashKey, type Query, type QueryClient } from '@tanstack/react-query';
import type { FreshReads } from '../api/remote/follow';
import { MAX_BATCH, isOverviewCall, type ChangeSignal, type Kind } from '../api/remote/wire';
import { PERSONAL_KINDS, READS } from './readMap';
import { WRITE_KINDS } from './writeKinds';

/**
 * The reload after a change (plan 5.3, client map 3.3). A change signal names what a saved change touched; this file reloads only
 * the lists that read it, in its project or for its person.
 *
 * - Own writes: RemoteApi hands over the signals of the answer, and they apply at once, before any timer. The answers of one
 *   batch come in one loop, so they apply in one pass (on a microtask), and a list loads once for them.
 * - Other people's writes come from Realtime. They merge for 1 second (at most 2 seconds from the first) into one pass, and so
 *   into one batch request. A signal that names messages, while the Inbox or a chat is on screen, waits only 150 ms (the office
 *   signal and the person signal of one message come a few milliseconds apart), so a chat message shows 0.85 s sooner (LV-3).
 * - All signals of one save share one id: the office signal and one signal on each person channel. The first one with an id
 *   applies whole. A later one with the same id adds only the people it names, so a person signal that comes after the office
 *   signal still reloads that person's own lists, and nothing applies twice. A save that changes an office task sends that part
 *   to the people of the task with a second id, so it applies as one more change (review 2026-10-06).
 * - Gaps: the seq of each Realtime channel counts up by one. A gap on the office channel reloads every list; a gap on the person
 *   channel reloads the person lists. The seq of an own answer never counts, because answers and Realtime do not share an order.
 * - A hidden tab only marks the lists. They reload when the tab shows again, and every list reloads after 60 seconds hidden.
 * - An empty list of signals means "something changed, reload all": a change of the prototype store (at once), or a Realtime
 *   channel that joined (origin 'join', signals may be lost). It also starts the seq of each channel again, at once. The joins of
 *   one dropped socket come a few milliseconds apart, one for each channel, so a join waits 100 ms for the other and for any
 *   signal, and they reload in one pass after the last join (performance audit FET-4).
 * - Reads after an own write (real build, performance audit FET-3): the runtime loads the reads on screen that a write will
 *   change (readsAfterWrite) in the request of the write, right after it. RemoteApi names the ones that answered there. The own
 *   pass does not reload such a read while its last load is that one. Every other read that the signals name reloads as before,
 *   and a pass that also holds other changes reloads them all. The Realtime frame of the own write often comes before the own answer
 *   (LV-2, 2026-10-21): the pass keeps the id of that frame until the own answer names it, so it is no other change. A gap of the
 *   seq, an empty list (join) and any id that no own answer names still make the pass mixed.
 */

/** own: the signals of an answer to this screen's own write. channel: Realtime (the default). join: a Realtime channel joined. */
export type ChangeOrigin = 'own' | 'channel' | 'join';
/** fresh: for an own answer, the reads that ran after its write in its request (performance audit FET-3). */
export type ChangeListener = (signals: ChangeSignal[], origin?: ChangeOrigin, fresh?: FreshReads) => void;

/** Where change signals come from: Realtime in the real build, the store in the prototype. */
export type ChangeSource = { subscribe(listener: ChangeListener): () => void; status(): 'open' | 'closed' };

/** The signals of one pass, merged. */
export type MergedSignal = {
  /** Reload every list (a gap on the office channel, a channel that joined again, a long hidden tab, the prototype store). */
  all: boolean;
  /** Reload every person list (a gap on the person channel). */
  personAll: boolean;
  kinds: Set<Kind>;
  projects: Set<string>;
  /** The change touched a record of no project (people, clients, teams, settings, a direct chat). */
  office: boolean;
  /** The people that the signals name, and the personal kinds that came with them. */
  people: Set<string>;
  personKinds: Set<Kind>;
};

export function emptyMerge(): MergedSignal {
  return { all: false, personAll: false, kinds: new Set(), projects: new Set(), office: false, people: new Set(), personKinds: new Set() };
}

/** Adds one signal to a merge, whole. */
export function mergeSignals(merged: MergedSignal, signal: ChangeSignal): MergedSignal {
  for (const kind of signal.kinds) merged.kinds.add(kind);
  for (const project of signal.projects) merged.projects.add(project);
  merged.office ||= signal.office;
  addPeople(merged, signal.people, signal.kinds);
  return merged;
}

function addPeople(merged: MergedSignal, people: readonly string[], kinds: readonly Kind[]): void {
  if (people.length === 0) return;
  for (const person of people) merged.people.add(person);
  for (const kind of kinds) if (PERSONAL_KINDS.has(kind)) merged.personKinds.add(kind);
}

/** True when this cached read must load again after the merged change. */
export function affects(queryKey: readonly unknown[], data: unknown, merged: MergedSignal, me: string): boolean {
  const [, name, input] = queryKey;
  const rule = typeof name === 'string' ? READS[name] : undefined;
  // A signed link, file data or a screenshot never reloads: a screen asks for it again when it needs it.
  if (rule?.scope === 'none') return false;
  if (merged.all || !rule) return true;
  if (merged.personAll && rule.scope === 'person') return true;
  // A personal change (a read mark, a notice, own preferences) counts only for the person it names.
  if (merged.people.has(me) && rule.kinds.some((kind) => merged.personKinds.has(kind))) return true;
  if (!rule.kinds.some((kind) => !PERSONAL_KINDS.has(kind) && merged.kinds.has(kind))) return false;
  if (rule.scope !== 'project') return true;
  const project = rule.projectOf?.(input, data);
  return project === undefined || merged.office || merged.projects.has(project);
}

/** The fetch meta key that holds the tag of a load in the follow step of a write (FET-3). */
export const FOLLOW_META = 'madarAfterWrite';

/** The fetch meta of TanStack (the package exports no name for it). */
type FetchMeta = NonNullable<Query['state']['fetchMeta']>;

/** The fetch meta of a load in the follow step with this tag. TanStack types the meta for paged reads only; Madar has none. */
export function followMeta(tag: object): FetchMeta {
  return { [FOLLOW_META]: tag } as FetchMeta;
}

/** The tag of the follow step of the last load of a read, if that load was one. */
function followTagOf(query: Query): unknown {
  return (query.state.fetchMeta as Record<string, unknown> | null)?.[FOLLOW_META];
}

/** At most this many reads go after a write: the write takes one place of a request. */
const FOLLOW_MAX = MAX_BATCH - 1;

const textField = (value: unknown, key: string): string | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' && found !== '' ? found : undefined;
};

/** The record that a write changes, by the id in its input. */
function recordOf(input: unknown): string | undefined {
  for (const key of ['id', 'taskId', 'targetId', 'commentId', 'conversationId', 'fileId']) {
    const id = textField(input, key);
    if (id) return id;
  }
  return undefined;
}

/** True when a list answer holds a row of the record: the row itself, or a part of the row (row.task, row.project). */
function holdsRecord(data: unknown, record: string): boolean {
  if (!Array.isArray(data)) return false;
  return data.some((row) => typeof row === 'object' && row !== null
    && ((row as { id?: unknown }).id === record || Object.values(row).some((part) => textField(part, 'id') === record)));
}

/** 0: the read names the record in its input. 1: its answer holds a row of the record. 2: any other read. */
function rankOf(query: Query, record: string | undefined): number {
  if (!record) return 2;
  const input = query.queryKey[2];
  if (typeof input === 'object' && input !== null && Object.values(input).includes(record)) return 0;
  return holdsRecord(query.state.data, record) ? 1 : 2;
}

/**
 * The reads on screen that a write will change (real build, performance audit FET-3): the active reads with an answer that
 * affects() gives for the kinds of WRITE_KINDS, in the project of the input, else in every project, and the personal lists of
 * me for a personal kind. The reads that show the record of the write come first, then the others in cache order. At most
 * FOLLOW_MAX reads and one overview read, so that all fit with the write in one request. The rest load on the signals.
 */
export function readsAfterWrite(queryClient: QueryClient, name: string, input: unknown, me: string): Query[] {
  const kinds = WRITE_KINDS[name];
  if (!kinds || kinds.length === 0) return [];
  const merged = emptyMerge();
  for (const kind of kinds) merged.kinds.add(kind);
  const projectId = textField(input, 'projectId');
  if (projectId) merged.projects.add(projectId);
  else merged.office = true;
  if (me) addPeople(merged, [me], kinds);
  const record = recordOf(input);
  const ranked = queryClient.getQueryCache().findAll({ queryKey: ['api'], type: 'active' })
    .filter((query) => {
      const readName = query.queryKey[1];
      return typeof readName === 'string' && READS[readName] !== undefined && query.state.data !== undefined
        && affects(query.queryKey, query.state.data, merged, me);
    })
    .map((query, at) => ({ query, at, rank: rankOf(query, record) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at);
  const chosen: Query[] = [];
  let overview = false;
  for (const { query } of ranked) {
    if (chosen.length >= FOLLOW_MAX) break;
    if (isOverviewCall(query.queryKey[1] as string, query.queryKey[2])) {
      if (overview) continue;
      overview = true;
    }
    chosen.push(query);
  }
  return chosen;
}

export type ConnectOptions = { mergeMs?: number; maxMergeMs?: number; hiddenReloadMs?: number; joinMs?: number; chatMs?: number; now?: () => number };

/** A join pass that comes this soon after the pass of a tab that shows again is part of that pass (DF-4). */
const VISIBLE_MERGE_MS = 1000;

/** How many signal ids the screen remembers, so a signal that comes again applies once. */
const KEEP_IDS = 500;

/**
 * Connects the change signals of a source to the query cache. me gives the id of the person on this screen ('' when not known
 * yet). Returns the stop.
 */
export function connectChanges(queryClient: QueryClient, source: ChangeSource, me: () => string, o: ConnectOptions = {}): () => void {
  const mergeMs = o.mergeMs ?? 1000;
  const maxMergeMs = o.maxMergeMs ?? 2000;
  const hiddenReloadMs = o.hiddenReloadMs ?? 60_000;
  const joinMs = o.joinMs ?? 100;
  const chatMs = o.chatMs ?? 150;
  const now = o.now ?? (() => Date.now());
  const seen = new Map<string, Set<string>>();
  const lastSeq = new Map<string, number>();
  let pending: MergedSignal | null = null;
  let firstAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The latest moment of the pass after a join: the last join plus joinMs. A signal in the window never moves the pass later.
  let joinBy: number | null = null;
  // The same for a message of another person while the Inbox or a chat is open (LV-3): the pass waits for the twin office and person
  // signals only, not for the whole merge window.
  let chatBy: number | null = null;
  // True while a pass for own answers waits for its microtask.
  let ownQueued = false;
  // The pending pass (FET-3): the fresh reads of each own answer in it (null: none), and whether it holds any other change.
  // A change that no own answer names is "mixed": an empty list (join), a gap of the seq, or a signal of Realtime. The signal of
  // Realtime that comes before the own answer of its own write is no other change (LV-2): `echoes` keeps its id and its channels
  // until the own answer names them, so the pass is mixed while `echoes` holds an id.
  let owns: (FreshReads | null)[] = [];
  let mixedHard = false;
  const echoes = new Map<string, Set<string>>();
  let hiddenAt: number | null = isHidden() ? now() : null;
  // The moment the last pass of a tab that shows again after a long rest started (DF-4). A join in the next second joins this pass.
  let visiblePassAt: number | null = null;
  let stopped = false;

  function isHidden(): boolean {
    return typeof document !== 'undefined' && document.hidden;
  }

  function run(merged: MergedSignal, fresh?: (query: Query) => boolean): void {
    if (stopped) return;
    const person = me();
    void queryClient.invalidateQueries({
      queryKey: ['api'],
      predicate: (query: Query) => affects(query.queryKey, query.state.data, merged, person) && !fresh?.(query),
      refetchType: isHidden() ? 'none' : 'active',
    });
  }

  /**
   * The reads that the pending pass does not reload (FET-3): only for a pass of own answers alone, a read that each of them names
   * as fresh, while its last load is the load of that follow step. Any other pass reloads every read that its signals name.
   */
  function freshOf(): ((query: Query) => boolean) | undefined {
    if (mixedHard || echoes.size > 0 || owns.length === 0 || owns.some((fresh) => fresh === null)) return undefined;
    const lists = (owns as FreshReads[]).map((fresh) => ({
      tag: fresh.tag,
      hashes: new Set(fresh.reads.map((read) => hashKey(['api', read.name, read.input]))),
    }));
    return (query) => lists.every((list) => list.hashes.has(query.queryHash) && followTagOf(query) === list.tag);
  }

  /** True while a screen shows the chat list or a chat: only then a message of another person is worth a short window (LV-3). */
  function chatOnScreen(): boolean {
    const cache = queryClient.getQueryCache();
    return cache.findAll({ queryKey: ['api', 'chats.list'], type: 'active' }).length > 0
      || cache.findAll({ queryKey: ['api', 'chats.messages'], type: 'active' }).length > 0;
  }

  function flush(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    joinBy = null;
    chatBy = null;
    const merged = pending;
    pending = null;
    const fresh = freshOf();
    owns = [];
    mixedHard = false;
    echoes.clear();
    if (merged) run(merged, fresh);
  }

  function queue(): MergedSignal {
    if (!pending) {
      pending = emptyMerge();
      firstAt = now();
    }
    return pending;
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer);
    let wait = Math.min(mergeMs, firstAt + maxMergeMs - now());
    if (joinBy !== null) wait = Math.min(wait, joinBy - now());
    if (chatBy !== null) wait = Math.min(wait, chatBy - now());
    timer = setTimeout(flush, Math.max(0, wait));
  }

  /** Remembers a signal and adds to the merge only what is new: the whole signal, or the people a known id did not name yet. */
  function take(merged: MergedSignal, signal: ChangeSignal): boolean {
    const named = seen.get(signal.id);
    if (!named) {
      seen.set(signal.id, new Set(signal.people));
      if (seen.size > KEEP_IDS) seen.delete(seen.keys().next().value as string);
      mergeSignals(merged, signal);
      return true;
    }
    const added = signal.people.filter((person) => !named.has(person));
    if (added.length === 0) return false;
    for (const person of added) named.add(person);
    addPeople(merged, added, signal.kinds);
    return true;
  }

  /** The seq of a Realtime channel: a number that skips one (or goes back) is a gap. True for a gap. */
  function checkSeq(merged: MergedSignal, signal: ChangeSignal): boolean {
    const last = lastSeq.get(signal.channel);
    lastSeq.set(signal.channel, signal.seq);
    if (last === undefined || signal.seq === last + 1) return false;
    if (signal.seq <= last && seen.has(signal.id)) {
      // The same signal again: keep the higher number.
      lastSeq.set(signal.channel, last);
      return false;
    }
    if (signal.channel === 'office') merged.all = true;
    else if (signal.channel === `person:${me()}`) merged.personAll = true;
    return true;
  }

  /** A signal of Realtime that adds something to the pass: the pass holds a change until an own answer names it (LV-2). */
  function keepEcho(signal: ChangeSignal): void {
    const channels = echoes.get(signal.id) ?? new Set<string>();
    channels.add(signal.channel);
    echoes.set(signal.id, channels);
  }

  /** An own answer names this signal: the echo of Realtime that came before it is part of the own write. */
  function dropEcho(signal: ChangeSignal): void {
    const channels = echoes.get(signal.id);
    if (!channels) return;
    channels.delete(signal.channel);
    if (channels.size === 0) echoes.delete(signal.id);
  }

  const unsubscribe = source.subscribe((signals, origin = 'channel', fresh) => {
    if (stopped) return;
    if (signals.length === 0) {
      lastSeq.clear();
      // The reload of a tab that shows again is on its way. A phone joins its channels some milliseconds after it, and a second pass of
      // everything would cancel the running reads, which the server has already run (DF-4).
      if (origin === 'join' && visiblePassAt !== null && now() - visiblePassAt < VISIBLE_MERGE_MS) return;
      mixedHard = true;
      queue().all = true;
      if (origin === 'join') {
        joinBy = now() + joinMs;
        schedule();
        return;
      }
      flush();
      return;
    }
    const merged = queue();
    if (origin === 'own') owns.push(fresh ?? null);
    else if (origin !== 'channel') mixedHard = true;
    for (const signal of signals) {
      if (origin === 'channel' && checkSeq(merged, signal)) mixedHard = true;
      const added = take(merged, signal);
      // A signal that adds nothing (it came before, with the own answer) changes nothing in the pass.
      if (origin === 'own') dropEcho(signal);
      else if (added) keepEcho(signal);
    }
    // An own write shows at once, with whatever else waits. Others wait for the merge window. A message of another person waits only
    // for its twin signals while a chat is on screen (LV-3). While an own write is on the wire, the frame may be its echo (a direct chat
    // signal names no person), so the full window holds: the own answer comes first and takes it (LV-2).
    if (origin === 'channel' && chatBy === null && chatMs < mergeMs && signals.some((signal) => signal.kinds.includes('messages')) && chatOnScreen() && queryClient.isMutating() === 0) {
      chatBy = now() + chatMs;
    }
    if (origin !== 'own') schedule();
    else if (!ownQueued) {
      ownQueued = true;
      queueMicrotask(() => {
        ownQueued = false;
        flush();
      });
    }
  });

  const onVisibility = () => {
    if (stopped) return;
    if (isHidden()) {
      hiddenAt ??= now();
      return;
    }
    const away = hiddenAt === null ? 0 : now() - hiddenAt;
    hiddenAt = null;
    if (away > hiddenReloadMs) {
      // Signals may have been lost while the tab slept: reload every list on the screen.
      visiblePassAt = now();
      run({ ...emptyMerge(), all: true });
      return;
    }
    void queryClient.refetchQueries({ queryKey: ['api'], type: 'active', predicate: (query: Query) => query.state.isInvalidated });
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    joinBy = null;
    chatBy = null;
    pending = null;
    owns = [];
    unsubscribe();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
