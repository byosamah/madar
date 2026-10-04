import type { State } from '../../src/api/store';
import type { Query } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { diffState } from '../data/save';

/**
 * The free checks that the db-mode harness runs after each call (TM 3.5, checks 2 to 5; task D1). Check 1, the shadow run, is in
 * shadow.ts. Each check gives a sentence that names the call, so a failed test says what broke.
 *
 *   2. A failed call writes nothing: the checksum of every table in the schema, server tables included, stays the same.
 *   3. A read call writes nothing and sends no change signal.
 *   4. The events only grow: no event changes or goes away. The one change allowed is undoneBy of an event that a new undo event
 *      of the same call names (plan 4.3).
 *   5. A saved change sends signals, all with one id, at most one on each channel, for the projects that the change touched in
 *      the whole office. A write that saved no change sends none.
 */

/** What the harness knows about one call. before and after: the whole office read back from the database. */
export type CallCheck = {
  name: string;
  readOnly: boolean;
  ok: boolean;
  beforeSum: string;
  afterSum: string;
  before: State;
  after: State;
  /** The signals the call sent through deps.signal. */
  signals: ChangeSignal[];
};

const SAFE_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * One statement that gives one checksum over the rows of every table named. Each table goes with its schema, so the checksum is
 * the same whatever the search_path of the connection is.
 */
export function checksumSql(schema: string, tables: readonly string[]): string {
  if (!SAFE_NAME.test(schema)) throw new Error(`Not a schema name: ${schema}`);
  const parts = tables.map((table) => {
    if (!SAFE_NAME.test(table)) throw new Error(`Not a table name: ${table}`);
    return `select '${table}' as n, md5(coalesce(string_agg(t::text, ',' order by t::text), '')) as h from ${schema}.${table} t`;
  });
  return `select md5(string_agg(n || ':' || h, '|' order by n)) as sum from (${parts.join(' union all ')}) x`;
}

/** The tables of one schema, by name. */
export const SCHEMA_TABLES_SQL = "select tablename from pg_tables where schemaname = $1 order by tablename";

/** The checksum of every table of a schema. */
export async function checksumOf(q: Query, schema: string): Promise<string> {
  const tables = (await q<{ tablename: string }>(SCHEMA_TABLES_SQL, [schema])).map((row) => row.tablename);
  const [row] = await q<{ sum: string }>(checksumSql(schema, tables));
  return row.sum;
}

function sameEvent(a: unknown, b: unknown): boolean {
  const strip = (event: unknown) => JSON.stringify({ ...(event as Record<string, unknown>), undoneBy: null });
  return strip(a) === strip(b);
}

export function callProblems(c: CallCheck): string[] {
  const problems: string[] = [];
  const wrote = c.afterSum !== c.beforeSum;
  if (!c.ok) {
    if (wrote) problems.push(`${c.name} failed, and it still changed the database.`);
    if (c.signals.length > 0) problems.push(`${c.name} failed, and it still sent ${c.signals.length} change signal(s).`);
    return problems;
  }
  if (c.readOnly) {
    if (wrote) problems.push(`${c.name} is a read, and it changed the database.`);
    if (c.signals.length > 0) problems.push(`${c.name} is a read, and it sent ${c.signals.length} change signal(s).`);
    return problems;
  }

  for (const [id, old] of Object.entries(c.before.events)) {
    const now = c.after.events[id];
    if (!now) {
      problems.push(`${c.name} removed the event ${id}. The History only grows.`);
      continue;
    }
    if (!sameEvent(old, now)) {
      problems.push(`${c.name} changed the event ${id}. The History only grows.`);
      continue;
    }
    if (old.undoneBy !== now.undoneBy) {
      const undo = now.undoneBy ? c.after.events[now.undoneBy] : undefined;
      if (old.undoneBy !== null || !undo || undo.undoes !== id || c.before.events[undo.id]) {
        problems.push(`${c.name} changed undoneBy of the event ${id}, and no new undo event of this call names it.`);
      }
    }
  }
  if (problems.length > 0) return problems;

  const diff = diffState(c.before, c.after);
  if (diff.kinds.size === 0) {
    if (c.signals.length > 0) problems.push(`${c.name} saved no change and still sent ${c.signals.length} change signal(s).`);
    return problems;
  }
  if (c.signals.length === 0) return [`${c.name} saved a change and sent no change signal.`];
  if (new Set(c.signals.map((s) => s.id)).size > 1) problems.push(`${c.name} sent signals with more than one id.`);
  const channels = c.signals.map((s) => s.channel);
  for (const channel of new Set(channels)) {
    if (channels.filter((one) => one === channel).length > 1) problems.push(`${c.name} sent more than one signal on the channel ${channel}.`);
  }
  const expected = [...diff.projects].sort().join(', ');
  for (const s of c.signals) {
    const sent = [...s.projects].sort().join(', ');
    if (sent !== expected) {
      problems.push(`${c.name} sent a signal for the projects ${sent || '(none)'}, but the change touched ${expected || '(none)'}.`);
      break;
    }
  }
  return problems;
}
