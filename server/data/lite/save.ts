import type { State } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { rowOf, type Row } from '../rows';
import { diffState, writeDiff, type Diff, type SaveOptions, type SaveResult, type TableChange } from '../save';
import { rowsOf, type TableSpec } from '../tables';
import { keyColumnsOf, keyValuesOf } from './columns';
import { writeOfficeSnapshot } from './office';

/**
 * The save step on SQLite (Supabase exit, wave 1). writeDiff of save.ts stays the one source of the numbers and the signals: it
 * runs on numbersQuery, which answers its three number statements in SQLite and leaves its Postgres table writes to this file
 * (as memoryData does). Then this file writes the rows of the Diff: deletes, inserts, and updates that set doc and only the key
 * columns that changed (wave 0: an indexed column in SET costs one row written, also with the same value).
 */

/** The statements of writeDiff that this file writes itself in SQLite form, so numbersQuery answers them with no row. */
const TABLE_WRITES = [/^delete from [a-z_]+ where id = any/, /^insert into office_deletes /, /^insert into counters /, /^insert into [a-z_]+ \(id, doc/, /^set constraints all immediate$/];

function numbersQuery(q: Query): Query {
  return (async <R,>(text: string, values: unknown[] = []): Promise<R[]> => {
    if (text.startsWith('update office_meta')) {
      return q<R>('update office_meta set version = version + ?, office_seq = office_seq + ? where id = 1 returning version, office_seq', [values[0], values[1]]);
    }
    if (text.startsWith('insert into person_seq')) {
      const out: R[] = [];
      for (const userId of values[0] as string[]) {
        out.push(...(await q<R>('insert into person_seq (user_id, seq) values (?, 1) on conflict (user_id) do update set seq = person_seq.seq + 1 returning user_id, seq', [userId])));
      }
      return out;
    }
    if (text.startsWith("select 'task' as type")) {
      const [taskIds, updateIds] = values as [string[], string[]];
      const out: R[] = [];
      for (const id of taskIds) out.push(...(await q<R>("select 'task' as type, id, project_id from tasks where id = ?", [id])));
      for (const id of updateIds) out.push(...(await q<R>("select 'update' as type, id, project_id from updates where id = ?", [id])));
      return out;
    }
    if (TABLE_WRITES.some((form) => form.test(text))) return [];
    throw new Error(`The SQLite save has no form for this statement of writeDiff: ${text.slice(0, 60)}`);
  }) as Query;
}

/** One row with its key columns. onConflict 'update' replaces the doc and every key column of a row that is there already. */
export async function insertRow(q: Query, spec: TableSpec, row: Row, state: State, onConflict: 'fail' | 'update'): Promise<void> {
  const columns = keyColumnsOf(spec);
  const values = keyValuesOf(spec, row, state);
  const names = ['id', 'doc', ...columns];
  const set = ['doc = excluded.doc', ...columns.map((name) => `${name} = excluded.${name}`)].join(', ');
  const tail = onConflict === 'update' ? ` on conflict (id) do update set ${set}` : '';
  await q(`insert into ${spec.table} (${names.join(', ')}) values (${names.map(() => '?').join(', ')})${tail}`, [row.id, JSON.stringify(row.doc), ...columns.map((name) => values[name])]);
}

async function writeTable(q: Query, change: TableChange, before: State, after: State): Promise<void> {
  const { spec } = change;
  for (const id of change.deleted) await q(`delete from ${spec.table} where id = ?`, [id]);
  const old = new Map(rowsOf(before, spec).filter((row) => row.doc !== undefined).map((row) => [row.id, row.doc]));
  const inserted = new Set(change.inserted);
  for (const row of change.upserts) {
    const was = old.get(row.id);
    if (inserted.has(row.id) || was === undefined) {
      // A row the call did not load may still be in the table: an upsert keeps its rowid. An event only grows: a second insert fails.
      await insertRow(q, spec, row, after, spec.collection === 'events' ? 'fail' : 'update');
      continue;
    }
    const now = keyValuesOf(spec, row, after);
    const then = keyValuesOf(spec, rowOf(spec, was, before), before);
    const changed = keyColumnsOf(spec).filter((name) => then[name] !== now[name]);
    const set = ['doc = ?', ...changed.map((name) => `${name} = ?`)].join(', ');
    await q(`update ${spec.table} set ${set} where id = ?`, [JSON.stringify(row.doc), ...changed.map((name) => now[name]), row.id]);
  }
}

export async function liteWriteDiff(q: Query, diff: Diff, before: State, after: State, o: SaveOptions = {}): Promise<SaveResult> {
  const result = await writeDiff(numbersQuery(q), diff, o);
  if (!result.changed) return result;
  for (const change of diff.tables) await writeTable(q, change, before, after);
  for (const [prefix, n] of Object.entries(diff.counters)) {
    await q('insert into counters (prefix, n) values (?, ?) on conflict (prefix) do update set n = excluded.n', [prefix, n]);
  }
  if (diff.officeRows) await writeOfficeSnapshot(q, after, result.officeVersion as number);
  return result;
}

export async function liteSave(q: Query, before: State, after: State, o: SaveOptions = {}): Promise<SaveResult> {
  return liteWriteDiff(q, diffState(before, after), before, after, o);
}
