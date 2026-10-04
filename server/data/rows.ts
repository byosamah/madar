import type { State } from '../../src/api/store';
import type { TableSpec } from './tables';

/**
 * One table row of a State record, and the SQL of the save step and the whole read (plan 4.1, 4.8; task C1).
 * Every statement handles all the rows of one table and one kind of change, so a save makes one round trip for each.
 */

type Rec = Record<string, unknown>;

/** A row as the save step writes it: the key, the doc, and the server columns beside the doc. */
export type Row = { id: string; doc: Rec; columns: Record<string, unknown> };

/** The doc that the database keeps. An event keeps undoneBy as null: the loader fills it from the undo event (plan 4.3). */
export function docOf(spec: TableSpec, rec: Rec): Rec {
  return spec.collection === 'events' ? { ...rec, undoneBy: null } : rec;
}

/**
 * The event of a doc that the database gave back, in place (task D2). A change event names the same fields in before and after
 * (events.ts: applyPatch, the Undo, and the two handlers that write an event themselves), and a field that was absent before the
 * change is before[field] = undefined. JSON drops that key, and the Undo then leaves the field in place. So each field that one
 * side names and the other lacks comes back as undefined on the other side.
 */
export function pairEventFields(event: Rec): Rec {
  const { before, after } = event;
  const isFields = (side: unknown): side is Rec => side !== null && typeof side === 'object' && !Array.isArray(side);
  if (!isFields(before) || !isFields(after)) return event;
  for (const field of Object.keys(after)) if (!(field in before)) before[field] = undefined;
  for (const field of Object.keys(before)) if (!(field in after)) after[field] = undefined;
  return event;
}

/** The row of one record, with its server columns computed from the State after the call. */
export function rowOf(spec: TableSpec, rec: Rec, state: State): Row {
  const columns: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(spec.serverColumns ?? {})) columns[name] = value(rec, state) ?? null;
  return { id: spec.key(rec), doc: docOf(spec, rec), columns };
}

/** The JSON parameter of an upsert: one object for each row, in the order of the rows. */
export function rowsParam(rows: Row[]): string {
  return JSON.stringify(rows.map((row) => ({ id: row.id, doc: row.doc, ...row.columns })));
}

const SAFE_NAME = /^[a-z][a-z_]*$/;
function name(text: string): string {
  if (!SAFE_NAME.test(text)) throw new Error(`Not a table or column name: ${text}`);
  return text;
}

/**
 * Writes the rows of one table: $1 the rows (rowsParam), $2 the office version for "chg" (office tables only).
 * The rows go in the given order, so a new row gets its "ord" in that order. An existing row keeps its "ord" (on conflict).
 * Events are inserted only: an event that exists already fails the statement (plan 4.3).
 */
export function upsertSql(spec: TableSpec): string {
  const table = name(spec.table);
  const columns = Object.keys(spec.serverColumns ?? {}).map(name);
  const into = ['id', 'doc', ...columns, ...(spec.office ? ['chg'] : [])];
  const values = ["r->>'id'", "r->'doc'", ...columns.map((column) => `r->>'${column}'`), ...(spec.office ? ['$2::bigint'] : [])];
  const insert = `insert into ${table} (${into.join(', ')}) select ${values.join(', ')} from jsonb_array_elements($1::jsonb) with ordinality as x(r, n) order by n`;
  if (spec.collection === 'events') return insert;
  const set = ['doc = excluded.doc', ...columns.map((column) => `${column} = excluded.${column}`), ...(spec.office ? ['chg = excluded.chg'] : [])];
  return `${insert} on conflict (id) do update set ${set.join(', ')}`;
}

/** Deletes rows by key: $1 the keys. */
export function deleteSql(spec: TableSpec): string {
  return `delete from ${name(spec.table)} where id = any($1::text[])`;
}

/** The office rows that a save deleted, so the office cache drops them (plan 4.7): $1 the table, $2 the keys, $3 the version. */
export const OFFICE_DELETES_SQL = 'insert into office_deletes (tbl, id, chg) select $1, unnest($2::text[]), $3::bigint';

/** Every doc of one table, in insertion order (TM R8). */
export function selectDocsSql(spec: TableSpec): string {
  return `select doc from ${name(spec.table)} order by ord`;
}

/** The changed counters: $1 an object of prefix and number. */
export const COUNTERS_UPSERT_SQL =
  'insert into counters (prefix, n) select key, value::integer from jsonb_each_text($1::jsonb) on conflict (prefix) do update set n = excluded.n';
export const COUNTERS_SELECT_SQL = 'select prefix, n from counters';
