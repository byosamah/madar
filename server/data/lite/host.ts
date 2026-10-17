import type { DatabaseSync } from 'node:sqlite';

/**
 * The SQL host of the SQLite path (Supabase exit, wave 1): one database that runs one statement at a time, synchronously. Two
 * hosts exist: nodeHost (node:sqlite: test:lite, the restore check) and doHost (the office object: server/office/doHost.ts).
 * Both refuse what the office object refuses, so a test on node never passes code that fails in the office object.
 */

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;
export type ExecResult = { rows: SqlRow[]; rowsRead: number; rowsWritten: number };

/**
 * A value that a host takes. A boolean is not a SqlValue: the office object binds true as the text 'true', and node:sqlite
 * refuses it (proof.md, "Wave 1: the transaction facts of the office object"). So each host binds it as 1 or 0 (hostValues).
 */
export type SqlInput = SqlValue | boolean;

export interface SqlHost {
  /** One statement. The values go to ? and ?NNN in order. A boolean binds as 1 or 0. */
  exec(text: string, values: readonly SqlInput[]): ExecResult;
  /**
   * One transaction around work. Every await inside work must be on exec: no network, no timer, no crypto.subtle (the rule of
   * the office object). A throw rolls back. A second transaction while one is open is refused.
   */
  transaction<T>(work: () => Promise<T>): Promise<T>;
  /** The size of the database in bytes. */
  size(): number;
  /** True when rowsRead and rowsWritten are real (the office object). node:sqlite gives 0 for both. */
  readonly counts: boolean;
}

/** The most bound values that the office object takes in one statement (proof.md, wave 0). */
export const MAX_VALUES = 100;

const REFUSED_START = /^\s*(begin|commit|rollback|end|savepoint|release|attach|detach|vacuum|analyze|reindex|pragma)\b/i;

/** Throws for a statement that the office object refuses, or that breaks a rule of the SQLite path. */
export function refuseLiteStatement(text: string, values: readonly SqlInput[]): void {
  const start = REFUSED_START.exec(text);
  if (start) {
    throw new Error(`The SQLite host refuses "${start[1].toLowerCase()}": the office object allows only its own transactions, and no ANALYZE or PRAGMA.`);
  }
  if (/\bsqlite_version\s*\(/i.test(text)) throw new Error('The SQLite host refuses sqlite_version(): the office object does not allow it.');
  if (/\$\d/.test(text)) {
    throw new Error(`The SQLite host refuses a Postgres placeholder ($1). Give the caller a SQLite form with sqlFor (server/data/dialect.ts): ${text.slice(0, 80)}`);
  }
  if (/::[a-z]/i.test(text)) {
    throw new Error(`The SQLite host refuses a Postgres cast (::). Give the caller a SQLite form with sqlFor (server/data/dialect.ts): ${text.slice(0, 80)}`);
  }
  if (values.length > MAX_VALUES) {
    throw new Error(`The SQLite host refuses ${values.length} bound values in one statement: the office object takes at most ${MAX_VALUES}.`);
  }
}

/** The values as both hosts bind them: a boolean as 1 or 0, every other value as it is. */
export function hostValues(values: readonly SqlInput[]): SqlValue[] {
  return values.map((value) => (typeof value === 'boolean' ? (value ? 1 : 0) : value));
}

/** The message of a second transaction, the same on both hosts. */
export const NESTED_TRANSACTION = 'The SQLite host has a transaction open already: one transaction at a time.';

/** The host on node:sqlite. The log gets the text of each statement that runs (tests read it). */
export function nodeHost(db: DatabaseSync, o: { log?: string[] } = {}): SqlHost {
  let open = false;
  return {
    counts: false,
    exec(text, values) {
      refuseLiteStatement(text, values);
      o.log?.push(text);
      const statement = db.prepare(text);
      const bound = hostValues(values);
      if (statement.columns().length === 0) {
        statement.run(...bound);
        return { rows: [], rowsRead: 0, rowsWritten: 0 };
      }
      return { rows: statement.all(...bound).map((row) => ({ ...row }) as SqlRow), rowsRead: 0, rowsWritten: 0 };
    },
    async transaction(work) {
      if (open) throw new Error(NESTED_TRANSACTION);
      open = true;
      db.exec('begin');
      try {
        const out = await work();
        db.exec('commit');
        return out;
      } catch (error) {
        db.exec('rollback');
        throw error;
      } finally {
        open = false;
      }
    },
    size() {
      const row = db.prepare('select page_count * page_size as n from pragma_page_count(), pragma_page_size()').get() as { n: number };
      return Number(row.n);
    },
  };
}
