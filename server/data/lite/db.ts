import type { Db, Query } from '../../core/ports';
import { markLite } from '../dialect';
import type { SqlHost, SqlRow, SqlValue } from './host';

/**
 * The Db port on a SQLite host (Supabase exit, wave 1). runCall and its stores keep the async Query, and each statement runs
 * at once on the host, so an await inside a transaction lets no other request in (Task 1 of the exit plan). It keeps two guards
 * of pgDb: no nested transaction, and a read transaction writes nothing. It has no pool: no warm, no close, no savepoint.
 */

/** The rows that the Db counted: the rows pins and the day meters (wave 0). node:sqlite counts 0. */
export type RowMeter = { rowsRead: number; rowsWritten: number; statements: number };

export type LiteDb = Db & { readonly dialect: 'sqlite'; readonly host: SqlHost; readonly meter: RowMeter };

/** The columns that hold JSON text. A read gives them back as values, as pg gives a jsonb column. */
export const JSON_COLUMNS: ReadonlySet<string> = new Set(['doc', 'payload', 'result', 'mail', 'versions']);

const WRITE = /^\s*(insert|update|delete|replace)\b/i;
const SCHEMA = /^\s*(create|drop|alter)\b/i;

type Tx = { mode: 'read' | 'write'; wrote: boolean; after: (() => void)[] };
const TX_OF = new WeakMap<Query, Tx>();
const DB_OF = new WeakMap<Query, LiteDb>();

/** A value as SQLite takes it: a boolean as 1 or 0, a Date as ISO text, a list or an object as JSON text. */
export function bindOf(value: unknown): SqlValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return value;
  return JSON.stringify(value);
}

/** One row as the callers get it: a plain object, with each JSON column parsed. */
export function rowOut(row: SqlRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = JSON_COLUMNS.has(key) && typeof value === 'string' ? JSON.parse(value) : value;
  return out;
}

/** Runs fn after the commit of the transaction of q. A rollback drops it (the office snapshot; in wave 3 the socket signals). */
export function onCommit(q: Query, fn: () => void): void {
  const tx = TX_OF.get(q);
  if (!tx) throw new Error('onCommit needs the query of an open SQLite transaction.');
  tx.after.push(fn);
}

/** True when the transaction of q wrote a row already: the office read then keeps nothing in memory. */
export function wroteIn(q: Query): boolean {
  return TX_OF.get(q)?.wrote === true;
}

/** The Db that made a query. */
export function liteDbOf(q: Query): LiteDb {
  const db = DB_OF.get(q);
  if (!db) throw new Error('This query does not belong to a SQLite Db.');
  return db;
}

export function liteDb(host: SqlHost): LiteDb {
  const meter: RowMeter = { rowsRead: 0, rowsWritten: 0, statements: 0 };
  let open: Tx | undefined;

  function run<R>(tx: Tx, text: string, values: readonly unknown[]): R[] {
    if (SCHEMA.test(text)) throw new Error('The SQLite Db refuses a schema statement: the schema step (server/data/lite/schema.ts) owns the tables.');
    const write = WRITE.test(text);
    if (write && tx.mode === 'read') throw new Error(`A read transaction refuses a write: ${text.slice(0, 60)}`);
    const result = host.exec(text, values.map(bindOf));
    meter.rowsRead += result.rowsRead;
    meter.rowsWritten += result.rowsWritten;
    meter.statements += 1;
    if (tx.mode === 'read' && result.rowsWritten > 0) throw new Error(`A read transaction wrote ${result.rowsWritten} rows: ${text.slice(0, 60)}`);
    if (write) tx.wrote = true;
    return result.rows.map(rowOut) as R[];
  }

  const db: LiteDb = {
    dialect: 'sqlite',
    host,
    meter,
    async tx<T>(mode: 'read' | 'write', work: (q: Query) => Promise<T>): Promise<T> {
      if (open) throw new Error('db.tx: a SQLite transaction is open already. One call holds one transaction.');
      const tx: Tx = { mode, wrote: false, after: [] };
      const q = markLite((async <R,>(text: string, values: unknown[] = []): Promise<R[]> => {
        if (open !== tx) throw new Error('This query belongs to a transaction that ended.');
        return run<R>(tx, text, values);
      }) as Query);
      TX_OF.set(q, tx);
      DB_OF.set(q, db);
      open = tx;
      try {
        const out = await host.transaction(() => work(q));
        open = undefined;
        for (const fn of tx.after) fn();
        return out;
      } finally {
        open = undefined;
      }
    },
    savepoint: () => Promise.reject(new Error('The SQLite Db has no savepoint: no production code asks for one.')),
    statement<R = Record<string, unknown>>(mode: 'read' | 'write', text: string, values?: unknown[]): Promise<R[]> {
      if (open) return Promise.reject(new Error('db.statement runs with no open transaction. Use the query of the transaction.'));
      return db.tx(mode, (q) => q<R>(text, values));
    },
  };
  return db;
}
