import type { State } from '../../../src/api/store';
import { tableOf, type TableCollection, type TableSpec } from '../tables';

/**
 * The reads of the loaders (plan 4.6; task C2), as data. One Select runs two ways: as SQL on the database (sqlSource.ts), and in
 * memory over a whole office (memorySource.ts). The loader tests run the handlers on the memory form, so the 18 places of AM 6 are
 * checked in "npm test"; server/it/loaders.it.test.ts proves that the SQL form returns the same rows as the memory form.
 *
 * Text order is the order of code points ("collate C" in SQL, the < operator in memory). The stamps and the ids of Madar are
 * ASCII text of one shape, so this order is also the order that localeCompare gives them in the handlers.
 */

type Rec = Record<string, unknown>;

/**
 * A column that a condition or an order may name. text: doc->>'field'; bool and int: the typed generated column. "field" is the
 * doc field of a text column that the migration builds as doc->>'field', so a lookup by that field may use the column.
 */
type Column = { type: 'text' | 'bool' | 'int'; field?: string; value(rec: Rec, state: State, spec: TableSpec): string | boolean | number | null };

const text = (field: string): Column => ({
  type: 'text',
  field,
  value: (rec) => (rec[field] === undefined || rec[field] === null ? null : String(rec[field])),
});
const server = (column: string): Column => ({
  type: 'text',
  value: (rec, state, spec) => (spec.serverColumns?.[column]?.(rec, state) ?? null) as string | null,
});

/** The generated and server columns of each table (supabase/migrations/20261004000100_core.sql). Only these may be named. */
const COLUMNS: Partial<Record<TableCollection, Record<string, Column>>> = {
  projects: { status: text('status'), client_id: text('clientId'), leader_id: text('leaderId'), code: text('code'), search_text: server('search_text') },
  tasks: {
    project_id: text('projectId'), owner_id: text('ownerId'), status: text('status'), due_date: text('dueDate'), stage_id: text('stageId'),
    search_text: server('search_text'),
  },
  updates: { project_id: text('projectId'), created_at: text('createdAt') },
  comments: { target_type: text('targetType'), target_id: text('targetId'), created_at: text('createdAt'), project_id: server('project_id') },
  files: { project_id: text('projectId'), task_id: text('taskId'), stage_id: text('stageId'), search_text: server('search_text') },
  tracker: {
    project_id: text('projectId'), reply_task_id: text('replyTaskId'),
    open: { type: 'bool', value: (rec) => rec.waiting !== null && rec.waiting !== undefined && (rec.closedAt === null || rec.closedAt === undefined) },
  },
  payments: { project_id: text('projectId') },
  pushDevices: { user_id: text('userId'), endpoint: text('endpoint') },
  notifications: {
    user_id: text('userId'), read: { type: 'bool', value: (rec) => rec.read === true }, created_at: text('createdAt'), correlation_id: text('correlationId'),
    target_type: text('targetType'), target_id: text('targetId'), dedupe_key: text('dedupeKey'),
  },
  messages: { conversation_id: text('conversationId'), created_at: text('createdAt') },
  chatReads: { conversation_id: text('conversationId'), user_id: text('userId') },
  events: {
    seq: { type: 'int', value: (rec) => rec.seq as number }, project_id: text('projectId'), target_type: text('targetType'), target_id: text('targetId'),
    correlation_id: text('correlationId'), verb: text('verb'), undoes: text('undoes'), created_at: text('createdAt'),
  },
};

export function columnOf(c: TableCollection, name: string): Column {
  const column = name === 'id' ? ID : COLUMNS[c]?.[name];
  if (!column) throw new Error(`The table ${tableOf(c).table} has no column ${name} for a loader.`);
  return column;
}
const ID: Column = { type: 'text', value: (rec, _state, spec) => spec.key(rec) };

/** The text column that the migration builds as doc->>'field' for this plain doc field, or undefined when the table has none. */
export function columnOfField(c: TableCollection, field: string): string | undefined {
  return Object.entries(COLUMNS[c] ?? {}).find(([, column]) => column.field === field)?.[0];
}

/** The names of the loader columns of one table, in the order of COLUMNS. The SQLite schema makes one plain column for each. */
export function columnNames(c: TableCollection): string[] {
  return Object.keys(COLUMNS[c] ?? {});
}

/** A JSON field of "doc" that has no column: a scan inside the database, never an index. Only names of plain fields. */
const FIELD = /^[a-zA-Z]+$/;
export function fieldName(name: string): string {
  if (!FIELD.test(name)) throw new Error(`Not a doc field: ${name}`);
  return name;
}

/**
 * One condition. Every condition of a Select must hold.
 *   in            the column has one of the values
 *   notIn         the column is null or has none of the values
 *   eq            the column equals the value (null: the column is null)
 *   contains      the column holds the text, for search_text. Postgres sends an escaped LIKE (a trigram index serves it);
 *                 memory and SQLite keep the plain substring test, so the three forms give the same rows
 *   atOrAfter     the stamp of the column is at or after this time (compared as times, as events.list does)
 *   atBefore      the stamp of the column is before this time (compared as times). With atOrAfter it bounds a period (reports.office)
 *   field / in    a doc field without a column has one of the values (doc->>'field')
 *   field / key / in  a key of an object field of doc has one of the values (doc->'field'->>'key'), for example after.status
 *   field / null  a doc field holds JSON null (or is absent)
 *   field / notIn a doc field without a column is null or absent, or has none of the values
 *   has           a doc list field holds the value (doc->'field' ? value)
 *   notUndone     an event that no undo event names (events only)
 *   before        (created_at, id) comes before this pair in text order
 *   after         (created_at, id) comes after this pair in text order (the mirror of before; open at one message)
 *   bounds        per key of a column: created_at after "gt"; when "ge" is set, at or after "ge"; when "after" is set,
 *                 (created_at, id) after that pair in text order (the rows after one row, plan 4.13 A9)
 *   or            any of the conditions holds
 */
export type Cond =
  | { col: string; in: readonly string[] }
  | { col: string; notIn: readonly string[] }
  | { col: string; eq: string | boolean | null }
  | { col: string; contains: string }
  | { col: string; atOrAfter: string }
  | { col: string; atBefore: string }
  | { field: string; in: readonly string[] }
  | { field: string; key: string; in: readonly string[] }
  | { field: string; null: true }
  | { field: string; notIn: readonly string[] }
  | { has: string; value: string }
  | { notUndone: true }
  | { before: { at: string; id: string } }
  | { after: { at: string; id: string } }
  | { bounds: { col: string; by: Readonly<Record<string, Bound>> } }
  | { or: readonly Cond[] };

/** The bound of one key of a "bounds" condition. */
export type Bound = { gt: string; ge?: string; after?: { at: string; id: string } };

/**
 * One read of one table.
 *   order   newest first by a column (desc), or oldest first (asc), then by insertion order. Without it the rows come in
 *           insertion order. An ascending read takes no ties.
 *   limit   the first rows in that order; with "ties", every row that shares the value of the last one too.
 *   per     the limit counts inside each value of this column (the newest posts of each project).
 *   pick    only these doc fields, for a read that never saves (AM 9). A field that is absent stays absent.
 */
export type Select = {
  c: TableCollection;
  where: readonly Cond[];
  order?: { col: string; desc: true; id?: true } | { col: string; asc: true; id?: true };
  limit?: number;
  ties?: boolean;
  per?: string;
  pick?: readonly string[];
};

/** True for an oldest-first order. */
export function isAscending(order: NonNullable<Select['order']>): boolean {
  return 'asc' in order;
}

/** An ascending read takes no ties: the cut of "with ties" is defined for the newest rows only. All three sources call it. */
export function assertOrder(s: Select): void {
  if (s.order && isAscending(s.order) && s.ties) throw new Error('An ascending read takes no ties.');
}

/** A count of one table (plan 4.13, A9): the rows that every condition matches, counted for each value of the column "per". */
export type CountSelect = { c: TableCollection; where: readonly Cond[]; per: string };

/** A row as a source returns it: its insertion order and its doc. */
export type Row = { ord: number; doc: Rec };

/** True when a Select can match no row, because a list condition is empty. */
export function matchesNothing(s: Select | CountSelect): boolean {
  return s.where.some((cond) => 'in' in cond && cond.in.length === 0);
}
