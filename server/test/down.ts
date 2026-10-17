import type { State } from '../../src/api/store';
import { docOf, rowOf, type Row } from '../data/rows';
import { TABLES, rowsOf, type TableSpec } from '../data/tables';

/**
 * The write-down changes of the test harness: the differences from the test's state before to after, in the database form of each
 * record. db mode (server/test/db.ts) writes them to Postgres, lite mode (server/test/liteHarness.ts) to node:sqlite.
 */

type Rec = Record<string, unknown>;

/** JSON with sorted keys and without undefined, so two records with the same fields in another order are the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const rec = value as Rec;
    return `{${Object.keys(rec).filter((key) => rec[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(rec[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export type DownChange = { spec: TableSpec; deleted: string[]; upserts: Row[]; touchesOld: boolean };

/** The differences from before to after, by table, in the database form of each record (docOf). */
export function downChanges(before: State, after: State): { tables: DownChange[]; counters: Record<string, number>; removedCounters: string[] } {
  const tables: DownChange[] = [];
  for (const spec of TABLES) {
    const was = new Map((before[spec.collection] || spec.collection === 'settings' ? rowsOf(before, spec) : []).map((row) => [row.id, row.doc]));
    const now = (after[spec.collection] || spec.collection === 'settings' ? rowsOf(after, spec) : []).filter((row) => row.doc !== undefined);
    const keep = new Set(now.map((row) => row.id));
    const deleted = [...was.keys()].filter((id) => !keep.has(id));
    const upserts = now
      .filter((row) => !was.has(row.id) || canonical(docOf(spec, was.get(row.id) as Rec)) !== canonical(docOf(spec, row.doc)))
      .map((row) => rowOf(spec, row.doc, after));
    if (deleted.length > 0 || upserts.length > 0) {
      const touchesOld = spec.collection === 'events' && (deleted.length > 0 || upserts.some((row) => was.has(row.id)));
      tables.push({ spec, deleted, upserts, touchesOld });
    }
  }
  const counters = Object.fromEntries(Object.entries(after.counters ?? {}).filter(([prefix, n]) => before.counters?.[prefix] !== n));
  const removedCounters = Object.keys(before.counters ?? {}).filter((prefix) => !(prefix in (after.counters ?? {})));
  return { tables, counters, removedCounters };
}
