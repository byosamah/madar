import type { Actor } from '../../../src/api/permissions';
import { withRights } from '../../../src/api/rights';
import { emptyState, type State } from '../../../src/api/store';
import { OFFICE_COLLECTIONS, type OfficeSnapshot } from '../../core/types';
import { pairEventFields } from '../rows';
import { tableOf, type TableCollection } from '../tables';
import type { CountSelect, Row, Select } from './query';
import type { Read, ReadAnswer, Source, ThreadRow, ThreadsArgs } from './source';

/**
 * The work of one loader (plan 4.6; task C2): the office from the cache, plus the scoped rows it reads, as one State.
 *
 * - The office lists come from the snapshot as a deep copy, so the call never holds a cached object (plan 4.7).
 * - The rows of the other collections are the objects that the Source gave: a Source gives rows that the caller owns (sqlSource
 *   gets new objects from pg, memorySource gives copies), so they get no second copy (performance audit SRV-M1).
 * - Rows of the other collections keep their insertion order ("ord"), whatever read brought them, so Object.values() gives the
 *   order of the prototype (TM R8). A row that two reads bring is kept once.
 * - Every loaded event gets its undoneBy from the undo event that names it (plan 4.3).
 * - A write gets the counters (it runs under the office lock). A read gets no counters and may get counts instead of rows
 *   (plan 4.13, A4); a write never gets those counts, because its own new comment or file would not be in a count. The one
 *   exception is the unread count (A9): chats.markRead writes only a read mark, and its handler sets the count it changes to 0.
 */

type Rec = Record<string, unknown>;

export type LoadCtx = {
  src: Source;
  office: OfficeSnapshot;
  /** Who acts. The loader finds the person whose rights apply (an agent's active person) from the office. */
  actorId: string;
  write: boolean;
  /** The time of the call, as the handler gets it (ctx.now). A loader that picks a period by today reads it (reports.office). */
  now?: Date;
};

const OFFICE = new Set<string>(OFFICE_COLLECTIONS);

/**
 * One read of Load.batch. select gives its rows (Load.select). byKey reads the rows of these keys that the load does not hold yet,
 * with only some fields when "pick" is set (Load.byKey, pickedByKey). count is Load.countWhere. threads is Source.threads.
 */
export type Step =
  | { select: Select }
  | { byKey: { c: TableCollection; keys: Iterable<string | null | undefined>; pick?: readonly string[] } }
  | { count: { s: CountSelect; values: readonly string[]; keyOf: (value: string) => string; inWrite?: true } }
  | { threads: ThreadsArgs };
/** The answer of one Step: rows for a select, threads for a threads read, nothing for the others (and for a step left out). */
export type StepResult<S> = S extends { select: Select } ? Rec[] : S extends { threads: ThreadsArgs } ? ThreadRow[] : undefined;

export class Load {
  readonly write: boolean;
  readonly office: OfficeSnapshot['lists'];
  /**
   * The person whose rights apply, as execute.ts resolves it, with the office rights of the office settings (rights.ts).
   * Undefined when the actor is not in the office.
   */
  readonly authority: Actor | undefined;
  /** The time of the call (LoadCtx.now), or undefined when the caller gives none. */
  readonly now: Date | undefined;
  readonly #src: Source;
  readonly #actorId: string;
  readonly #rows = new Map<TableCollection, Map<string, Row>>();
  readonly #counts: Record<string, number> = {};

  constructor(lx: LoadCtx) {
    this.#src = lx.src;
    this.#actorId = lx.actorId;
    this.write = lx.write;
    this.now = lx.now;
    this.office = lx.office.lists;
    const actor = this.office.users[lx.actorId];
    const owner = actor?.kind === 'agent' && actor.ownerId ? this.office.users[actor.ownerId] : undefined;
    const who = owner && owner.kind === 'human' && owner.active ? owner : actor;
    this.authority = who ? withRights(this.office, who) : undefined;
  }

  get src(): Source {
    return this.#src;
  }

  /** A record of any collection by key: from the office, or from what this load read so far. */
  get<T = Rec>(c: TableCollection, key: string | null | undefined): T | undefined {
    if (key === null || key === undefined) return undefined;
    if (OFFICE.has(c)) return (this.office as unknown as Record<string, Record<string, T>>)[c]?.[key];
    return this.#rows.get(c)?.get(key)?.doc as T | undefined;
  }

  /** The records this load read of one collection, in insertion order. */
  list<T = Rec>(c: TableCollection): T[] {
    return [...(this.#rows.get(c)?.values() ?? [])].sort((a, b) => a.ord - b.ord).map((row) => row.doc as T);
  }

  #add(c: TableCollection, rows: Row[]): Rec[] {
    const spec = tableOf(c);
    let map = this.#rows.get(c);
    if (!map) {
      map = new Map();
      this.#rows.set(c, map);
    }
    return rows.map((row) => {
      const key = spec.key(row.doc);
      const known = map.get(key);
      if (known) return known.doc;
      map.set(key, row);
      return row.doc;
    });
  }

  /** Keeps rows that a source read outside a Select (the reference rows of the story loader). */
  addRows(c: TableCollection, rows: Row[]): void {
    if (OFFICE.has(c)) return;
    this.#add(c, rows);
  }

  /** Reads and keeps the rows of one Select. */
  async select(s: Select): Promise<Rec[]> {
    if (OFFICE.has(s.c)) throw new Error(`The office list ${s.c} comes from the office cache, not from a loader read.`);
    return this.#add(s.c, await this.#src.select(s));
  }

  /** Reads the rows of these keys that this load does not hold yet. Office lists are always held. */
  async byKey(c: TableCollection, keys: Iterable<string | null | undefined>): Promise<void> {
    if (OFFICE.has(c)) return;
    const missing = [...new Set([...keys].filter((key): key is string => typeof key === 'string' && key !== ''))].filter((key) => !this.get(c, key));
    if (missing.length > 0) await this.select({ c, where: [{ col: 'id', in: missing }] });
  }

  /**
   * Several reads that do not depend on each other, in one round trip (performance audit SV-10, perf2). Each step gives what its
   * single call gives, and the load keeps the rows in the order of the steps, so the State is the one that the reads one by one
   * give. The keys that byKey misses are chosen before any step runs, so a step must not need the rows of an earlier step of the
   * same batch. A step that is undefined, a byKey with no missing key and a count with no value send nothing. The answers come
   * back in the places of the steps.
   */
  async batch<const S extends readonly (Step | undefined)[]>(steps: S): Promise<{ -readonly [K in keyof S]: StepResult<S[K]> }> {
    const plans: { at: number; read: Read; apply: (answer: ReadAnswer) => unknown }[] = [];
    steps.forEach((step, at) => {
      if (!step) return;
      if ('select' in step) {
        const { select } = step;
        if (OFFICE.has(select.c)) throw new Error(`The office list ${select.c} comes from the office cache, not from a loader read.`);
        plans.push({ at, read: { select }, apply: (answer) => this.#add(select.c, answer as Row[]) });
      } else if ('byKey' in step) {
        const { c, keys, pick } = step.byKey;
        if (OFFICE.has(c)) return;
        const missing = [...new Set([...keys].filter((key): key is string => typeof key === 'string' && key !== ''))].filter((key) => !this.get(c, key));
        if (missing.length === 0) return;
        const select: Select = { c, where: [{ col: 'id', in: missing }], ...(pick ? { pick } : {}) };
        plans.push({ at, read: { select }, apply: (answer) => void this.#add(c, answer as Row[]) });
      } else if ('count' in step) {
        const { s, values, keyOf, inWrite } = step.count;
        if (this.write && !inWrite) throw new Error('A write reads rows, never counts, except chats.markRead.');
        const want = [...new Set(values)];
        if (want.length === 0) return;
        plans.push({
          at, read: { count: s },
          apply: (answer) => {
            for (const value of want) this.#counts[keyOf(value)] = (answer as Map<string, number>).get(value) ?? 0;
          },
        });
      } else {
        plans.push({ at, read: { threads: step.threads }, apply: (answer) => answer });
      }
    });
    const src = this.#src;
    const reads = plans.map((plan) => plan.read);
    let answers: ReadAnswer[];
    if (reads.length > 1 && src.batch) answers = await src.batch(reads);
    else {
      answers = [];
      for (const read of reads) answers.push('select' in read ? await src.select(read.select) : 'count' in read ? await src.countWhere(read.count) : await src.threads(read.threads));
    }
    const out: unknown[] = steps.map(() => undefined);
    plans.forEach((plan, n) => {
      out[plan.at] = plan.apply(answers[n]);
    });
    return out as never;
  }

  /** Every feedback row: only the feedback calls read them (plan 4.6). */
  async allFeedback(): Promise<void> {
    await this.select({ c: 'feedback', where: [] });
  }

  /**
   * The number of rows for each value, under the key that views.ts reads (commentCountKey, fileCountKey). Only a read keeps counts;
   * a write reads the rows instead.
   */
  async counts(c: TableCollection, col: string, values: readonly string[], keyOf: (value: string) => string): Promise<ReadonlyMap<string, number>> {
    if (this.write) throw new Error('A write reads rows, never counts.');
    const want = [...new Set(values)];
    const found = await this.#src.count(c, col, want);
    for (const value of want) this.#counts[keyOf(value)] = found.get(value) ?? 0;
    return found;
  }

  /**
   * The number of rows that a count matches for each value given, under the key that the handlers read (unreadCountKey, plan
   * 4.13 A9). A value with no row gets 0. A write may hold such a count only when its handler keeps it true: the caller says so
   * with inWrite, and only chats.markRead does (it sets the count of the chat it marks to 0).
   */
  async countWhere(s: CountSelect, values: readonly string[], keyOf: (value: string) => string, o: { inWrite?: true } = {}): Promise<void> {
    if (this.write && !o.inWrite) throw new Error('A write reads rows, never counts, except chats.markRead.');
    const want = [...new Set(values)];
    if (want.length === 0) return;
    const found = await this.#src.countWhere(s);
    for (const value of want) this.#counts[keyOf(value)] = found.get(value) ?? 0;
  }

  /** The State that the handler runs on. */
  async state(): Promise<State> {
    const state = { ...emptyState(''), feedback: {} } as State;
    state.session = { currentUserId: this.#actorId, simulateErrors: false };
    const lists = state as unknown as Record<string, unknown>;
    for (const c of OFFICE_COLLECTIONS) lists[c] = structuredClone(this.office[c]);
    for (const [c, map] of this.#rows) {
      const spec = tableOf(c);
      lists[c] = Object.fromEntries([...map.values()].sort((a, b) => a.ord - b.ord).map((row) => [spec.key(row.doc), row.doc]));
    }
    const events = Object.values(state.events);
    if (events.length > 0) {
      const links = await this.#src.undoLinks(events.map((event) => event.id));
      for (const event of events) {
        pairEventFields(event as unknown as Rec);
        event.undoneBy = links.get(event.id) ?? null;
      }
    }
    state.counters = this.write ? await this.#src.counters() : {};
    if (Object.keys(this.#counts).length > 0) state.counts = { ...this.#counts };
    return state;
  }
}

/**
 * The State before the handler of a write runs, for the diff save (performance audit SRV-8, DB-7). Load.state() made the office
 * lists of "state" as copies of the snapshot lists, and a loader never reads an office table as rows, so the office part of
 * "before" is the frozen snapshot itself, with no copy. Every other collection is a deep copy. Only the save step reads
 * "before", and a write into the frozen part throws.
 */
export function beforeOf(state: State, office: OfficeSnapshot): State {
  const lists = office.lists as unknown as Record<string, unknown>;
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [key, OFFICE.has(key) ? lists[key] : structuredClone(value)])) as unknown as State;
}
