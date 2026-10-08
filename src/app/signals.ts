import type { Query, QueryClient } from '@tanstack/react-query';
import type { ChangeSignal, Kind } from '../api/remote/wire';
import { PERSONAL_KINDS, READS } from './readMap';

/**
 * The reload after a change (plan 5.3, client map 3.3). A change signal names what a saved change touched; this file reloads only
 * the lists that read it, in its project or for its person.
 *
 * - Own writes: RemoteApi hands over the signals of the answer, and they apply at once, before any timer. The answers of one
 *   batch come in one loop, so they apply in one pass (on a microtask), and a list loads once for them.
 * - Other people's writes come from Realtime. They merge for 1 second (at most 2 seconds from the first) into one pass, and so
 *   into one batch request.
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
 */

/** own: the signals of an answer to this screen's own write. channel: Realtime (the default). join: a Realtime channel joined. */
export type ChangeOrigin = 'own' | 'channel' | 'join';
export type ChangeListener = (signals: ChangeSignal[], origin?: ChangeOrigin) => void;

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

export type ConnectOptions = { mergeMs?: number; maxMergeMs?: number; hiddenReloadMs?: number; joinMs?: number; now?: () => number };

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
  const now = o.now ?? (() => Date.now());
  const seen = new Map<string, Set<string>>();
  const lastSeq = new Map<string, number>();
  let pending: MergedSignal | null = null;
  let firstAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The latest moment of the pass after a join: the last join plus joinMs. A signal in the window never moves the pass later.
  let joinBy: number | null = null;
  // True while a pass for own answers waits for its microtask.
  let ownQueued = false;
  let hiddenAt: number | null = isHidden() ? now() : null;
  let stopped = false;

  function isHidden(): boolean {
    return typeof document !== 'undefined' && document.hidden;
  }

  function run(merged: MergedSignal): void {
    if (stopped) return;
    const person = me();
    void queryClient.invalidateQueries({
      queryKey: ['api'],
      predicate: (query: Query) => affects(query.queryKey, query.state.data, merged, person),
      refetchType: isHidden() ? 'none' : 'active',
    });
  }

  function flush(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    joinBy = null;
    const merged = pending;
    pending = null;
    if (merged) run(merged);
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

  /** The seq of a Realtime channel: a number that skips one (or goes back) is a gap. */
  function checkSeq(merged: MergedSignal, signal: ChangeSignal): void {
    const last = lastSeq.get(signal.channel);
    lastSeq.set(signal.channel, signal.seq);
    if (last === undefined || signal.seq === last + 1) return;
    if (signal.seq <= last && seen.has(signal.id)) {
      // The same signal again: keep the higher number.
      lastSeq.set(signal.channel, last);
      return;
    }
    if (signal.channel === 'office') merged.all = true;
    else if (signal.channel === `person:${me()}`) merged.personAll = true;
  }

  const unsubscribe = source.subscribe((signals, origin = 'channel') => {
    if (stopped) return;
    if (signals.length === 0) {
      lastSeq.clear();
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
    for (const signal of signals) {
      if (origin === 'channel') checkSeq(merged, signal);
      take(merged, signal);
    }
    // An own write shows at once, with whatever else waits. Others wait for the merge window.
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
    pending = null;
    unsubscribe();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
  };
}
