import type { State } from '../../../src/api/store';
import { columnNames, columnOf } from '../loaders/query';
import type { Row } from '../rows';
import type { TableSpec } from '../tables';
import type { SqlValue } from './host';

/**
 * The key columns of the SQLite tables (Supabase exit, wave 1). They are plain columns that the save writes (wave 0: an update
 * of a table with generated columns rewrote every index). Their values come from the same column rules that the memory form
 * filters with (COLUMNS of query.ts), so SQL and memory agree. An office list has none: it loads whole, from the snapshot.
 */

export function keyColumnsOf(spec: TableSpec): readonly string[] {
  return spec.office ? [] : columnNames(spec.collection);
}

/** integer for a bool or int column (a bool is 1 or 0), text for the others. */
export function sqlTypeOf(spec: TableSpec, name: string): 'integer' | 'text' {
  return columnOf(spec.collection, name).type === 'text' ? 'text' : 'integer';
}

/** The values of the key columns of one row. A server column comes from the row, because the save fills it (comments.project_id). */
export function keyValuesOf(spec: TableSpec, row: Row, state: State): Record<string, SqlValue> {
  const out: Record<string, SqlValue> = {};
  for (const name of keyColumnsOf(spec)) {
    if (spec.serverColumns && name in spec.serverColumns) {
      const value = row.columns[name];
      out[name] = value === undefined || value === null ? null : String(value);
      continue;
    }
    const value = columnOf(spec.collection, name).value(row.doc, state, spec);
    out[name] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  }
  return out;
}
