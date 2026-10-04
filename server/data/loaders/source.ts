import type { TableCollection } from '../tables';
import type { CountSelect, Row, Select } from './query';

/**
 * Where a loader reads (task C2). sqlSource reads the database inside the call's transaction; memorySource reads a whole office in
 * memory, for the tests that prove a scoped load gives the same answer as the whole office (AM 6).
 */
export interface Source {
  /** The rows of one Select, in insertion order. */
  select(s: Select): Promise<Row[]>;
  /** How many rows each value of a column has, for the values given (State.counts, plan 4.13 A4). Values with no row are left out. */
  count(c: TableCollection, col: string, values: readonly string[]): Promise<Map<string, number>>;
  /**
   * How many rows match a count, for each value of its column "per" (plan 4.13, A9): the unread messages of each chat and the
   * unread comments of each task thread, without the rows. Values with no row are left out.
   */
  countWhere(s: CountSelect): Promise<Map<string, number>>;
  /** For each event id given that an undo event names, the id of that undo event (plan 4.3). */
  undoLinks(eventIds: readonly string[]): Promise<Map<string, string>>;
  /** The first row, in insertion order, whose doc holds the id at the path of REFERENCE_FIELDS, apart from the row with key "except". */
  referencing(c: TableCollection, path: string, id: string, except: string | null): Promise<Row[]>;
  /**
   * The task threads of the Inbox (chats.ts, taskThreads): the tasks that have a comment and that the person leads (owner),
   * leads the project of (led), or commented on (as a person of "me"). The newest "limit" by the stamp of their last comment,
   * with ties, each with that stamp and the stamp of the newest comment by "me". Newest first, then by task id from the end.
   */
  threads(o: { owner: string; led: readonly string[]; me: readonly string[]; limit: number }): Promise<{ id: string; last: string; mine: string | null }[]>;
  /** Every counter (plan, change 4). Only a write reads them, inside the lock. */
  counters(): Promise<Record<string, number>>;
}
