import type { User } from '../../../src/api/contract/entities';
import { emptyState, type State } from '../../../src/api/store';
import { OFFICE_COLLECTIONS, type OfficeSnapshot } from '../../core/types';
import { tableOf, type TableCollection } from '../tables';
import type { CountSelect, Row, Select } from './query';
import type { Source } from './source';

/**
 * The work of one loader (plan 4.6; task C2): the office from the cache, plus the scoped rows it reads, as one State.
 *
 * - The office lists come from the snapshot as a deep copy, so the call never holds a cached object (plan 4.7).
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
};

const OFFICE = new Set<string>(OFFICE_COLLECTIONS);

export class Load {
  readonly write: boolean;
  readonly office: OfficeSnapshot['lists'];
  /** The person whose rights apply, as execute.ts resolves it. Undefined when the actor is not in the office. */
  readonly authority: User | undefined;
  readonly #src: Source;
  readonly #actorId: string;
  readonly #rows = new Map<TableCollection, Map<string, Row>>();
  readonly #counts: Record<string, number> = {};

  constructor(lx: LoadCtx) {
    this.#src = lx.src;
    this.#actorId = lx.actorId;
    this.write = lx.write;
    this.office = lx.office.lists;
    const actor = this.office.users[lx.actorId];
    const owner = actor?.kind === 'agent' && actor.ownerId ? this.office.users[actor.ownerId] : undefined;
    this.authority = owner && owner.kind === 'human' && owner.active ? owner : actor;
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

  /** Every feedback row: only the feedback calls read them (plan 4.6). */
  async allFeedback(): Promise<void> {
    await this.select({ c: 'feedback', where: [] });
  }

  /**
   * The number of rows for each value, under the key that views.ts reads (commentCountKey, fileCountKey). Only a read keeps counts;
   * a write reads the rows instead.
   */
  async counts(c: TableCollection, col: string, values: readonly string[], keyOf: (value: string) => string): Promise<void> {
    if (this.write) throw new Error('A write reads rows, never counts.');
    const want = [...new Set(values)];
    const found = await this.#src.count(c, col, want);
    for (const value of want) this.#counts[keyOf(value)] = found.get(value) ?? 0;
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
      lists[c] = Object.fromEntries([...map.values()].sort((a, b) => a.ord - b.ord).map((row) => [spec.key(row.doc), structuredClone(row.doc)]));
    }
    const events = Object.values(state.events);
    if (events.length > 0) {
      const links = await this.#src.undoLinks(events.map((event) => event.id));
      for (const event of events) event.undoneBy = links.get(event.id) ?? null;
    }
    state.counters = this.write ? await this.#src.counters() : {};
    if (Object.keys(this.#counts).length > 0) state.counts = { ...this.#counts };
    return state;
  }
}
