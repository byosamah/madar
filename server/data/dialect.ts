import type { Db, Query } from '../core/ports';

/**
 * The dialect of the database behind a query or a Db (Supabase exit, wave 1). The Postgres path and the SQLite path run the same
 * code. A module that sends its own SQL keeps its Postgres constant as it is (the fakes match it by exact text) and adds its
 * SQLite twin beside it; sqlFor gives the text for the database of the call.
 */

/** The queries that a SQLite Db made. Every other query is Postgres. */
const LITE = new WeakSet<Query>();

export function markLite(q: Query): Query {
  LITE.add(q);
  return q;
}

export function isLite(target: Query | Pick<Db, 'dialect'>): boolean {
  return typeof target === 'function' ? LITE.has(target) : target.dialect === 'sqlite';
}

/** The text of one statement for the database of target: the Postgres text, or its SQLite twin. */
export function sqlFor(target: Query | Pick<Db, 'dialect'>, pg: string, lite: string): string {
  return isLite(target) ? lite : pg;
}

/**
 * A query that runs each statement in a transaction of its own (Db.statement) and keeps the dialect of the Db, so sqlFor and the
 * stores pick the right text on it (Supabase exit, wave 2). A route that sends single statements uses it.
 */
export function statementQuery(db: Db, mode: 'read' | 'write'): Query {
  const q = (<R,>(text: string, values?: unknown[]) => db.statement<R>(mode, text, values)) as Query;
  return isLite(db) ? markLite(q) : q;
}
