import { emptyState } from '../../../src/api/store';
import type { Query } from '../../core/ports';
import { assertOrder, columnOf, columnOfField, isAscending, matchesNothing, type Cond, type CountSelect, type Row, type Select } from '../loaders/query';
import type { Source } from '../loaders/source';
import { tableOf } from '../tables';
import { keyColumnsOf } from './columns';
import { boundTerms, drivingListOf, pathMatch, whereOf, type InList } from './compile';
import { indexedColumnsOf, TIME_INDEX } from './schema';

/**
 * The Source on SQLite (Supabase exit, wave 1). It gives the rows of sqlSource and memorySource with the wave 0 rules:
 * - no outer sort in SQL: the rows come back sorted by ord (the rowid) in JavaScript, as Load sorts them anyway;
 * - a cut order (the rows that pass a limit) stays in SQL with order by and limit, on an index that gives that order;
 * - a read with atOrAfter names its time index (indexed by) and cuts in JavaScript, so no other index decides its plan;
 * - a long in-list on an indexed column reads key by key with one = statement each, so no statement takes over 100 values;
 * - a pick takes its fields in JavaScript after the parse.
 */

type Rec = Record<string, unknown>;
type DocRow = { ord: number; doc: Rec };
type Bounds = Extract<Cond, { bounds: unknown }>;

const EMPTY = emptyState('');
const textOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const rowsOf = (rows: Rec[]): DocRow[] => rows.map((row) => ({ ord: Number(row.ord), doc: row.doc as Rec }));

/** The task threads of a person (Source.threads): every candidate thread, cut and sorted in JavaScript as memorySource does. */
export const THREADS_LITE = `with mine as (select distinct target_id from comments where target_type = 'task' and json_extract(doc, '$.authorId') in (select value from json_each(?3))),
cand as (select k.id from tasks k
  where (k.owner_id = ?1 or k.project_id in (select value from json_each(?2)) or k.id in (select target_id from mine)
      or (k.project_id is null and json_extract(k.doc, '$.createdBy') in (select value from json_each(?3))))
    and (k.project_id is not null or ?4 or k.owner_id = ?1
      or (json_type(k.doc, '$.helperIds') = 'array' and exists (select 1 from json_each(k.doc, '$.helperIds') h where h.value = ?1))
      or json_extract(k.doc, '$.createdBy') in (select value from json_each(?3)))),
threads as (
  select c.target_id as id, max(c.created_at) as last,
         max(case when json_extract(c.doc, '$.authorId') in (select value from json_each(?3)) then c.created_at end) as mine
  from comments c where c.target_type = 'task' and c.target_id in (select id from cand)
  group by c.target_id)
select id, last, mine from threads`;

function orderOf(s: Select): string {
  if (!s.order) return 't.rowid';
  const way = isAscending(s.order) ? 'asc' : 'desc';
  const terms = [`t.${s.order.col} ${way}`];
  if (s.order.id) terms.push(`t.id ${way}`);
  else if (!s.ties) terms.push(`t.rowid ${way}`);
  return terms.join(', ');
}

/** The cut of memorySource.select (lines 93 to 125) over the candidate rows of one group: the rank of equal runs with ties. */
function cut(rows: DocRow[], s: Select): DocRow[] {
  const spec = tableOf(s.c);
  const order = s.order;
  const valueOf = (row: DocRow) => (order ? columnOf(s.c, order.col).value(row.doc, EMPTY, spec) : null);
  const compare = (a: DocRow, b: DocRow): number => {
    if (!order) return a.ord - b.ord;
    // Newest first puts b before a in the comparison; oldest first puts a before b.
    const [p, q] = isAscending(order) ? [a, b] : [b, a];
    const x = valueOf(p);
    const y = valueOf(q);
    const byCol = typeof x === 'number' && typeof y === 'number' ? x - y : textOrder(String(x ?? ''), String(y ?? ''));
    if (byCol !== 0) return byCol;
    if (order.id) return textOrder(spec.key(p.doc), spec.key(q.doc));
    return s.ties ? 0 : p.ord - q.ord;
  };
  const sorted = [...rows].sort(compare);
  const kept: DocRow[] = [];
  let rank = 0;
  for (const [index, row] of sorted.entries()) {
    if (index === 0 || !s.ties || compare(sorted[index - 1], row) !== 0) rank = index;
    if (rank >= (s.limit as number)) break;
    kept.push(row);
  }
  return kept;
}

function finish(rows: DocRow[], s: Select): Row[] {
  rows.sort((a, b) => a.ord - b.ord);
  if (!s.pick) return rows;
  const pick = s.pick;
  return rows.map((row) => ({ ord: row.ord, doc: Object.fromEntries(pick.filter((key) => key in row.doc).map((key) => [key, row.doc[key]])) }));
}

export function liteSource(q: Query): Source {
  async function rowsWhere(s: Select, where: readonly Cond[], tail = ''): Promise<DocRow[]> {
    const table = tableOf(s.c).table;
    const index = s.where.some((one) => 'atOrAfter' in one) ? TIME_INDEX[table] : undefined;
    const values: unknown[] = [];
    const sql = whereOf({ ...s, where }, values);
    return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${table} t${index ? ` indexed by ${index}` : ''} where ${sql}${tail}`, values));
  }

  /** Every candidate row, key by key on the driving list when there is one. */
  async function every(s: Select): Promise<DocRow[]> {
    const drive = drivingListOf(s, indexedColumnsOf(tableOf(s.c).table));
    if (!drive) return rowsWhere(s, s.where);
    const out: DocRow[] = [];
    for (const key of new Set(drive.in)) out.push(...(await rowsWhere(s, [{ col: drive.col, in: [key] }, ...s.where.filter((one) => one !== drive)])));
    return out;
  }

  /** The first rows in the cut order, in SQL. With ties: every row at or after the order value of the last row of the limit. */
  async function limited(s: Select, where: readonly Cond[]): Promise<DocRow[]> {
    const order = orderOf(s);
    if (!s.ties || !s.order) {
      const table = tableOf(s.c).table;
      const values: unknown[] = [];
      const sql = whereOf({ ...s, where }, values);
      values.push(s.limit);
      return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${table} t where ${sql} order by ${order} limit ?`, values));
    }
    if (s.order.id || columnOf(s.c, s.order.col).type !== 'text') throw new Error('A read with ties needs a text order column and no id term.');
    const table = tableOf(s.c).table;
    const outer: unknown[] = [];
    const sql = whereOf({ ...s, where }, outer);
    const inner: unknown[] = [];
    whereOf({ ...s, where }, inner);
    const col = `t.${s.order.col}`;
    const edge = `coalesce((select ${col} from ${table} t where ${sql} order by ${order} limit 1 offset ?), '')`;
    return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${table} t where ${sql} and ${col} >= ${edge}`, [...outer, ...inner, (s.limit as number) - 1]));
  }

  return {
    async select(s) {
      assertOrder(s);
      if (matchesNothing(s)) return [];
      if (s.limit === undefined) return finish(await every(s), s);
      const timed = s.where.some((one) => 'atOrAfter' in one);
      if (s.per) {
        const perList = s.where.find((one): one is InList => 'col' in one && one.col === s.per && 'in' in one);
        if (!perList) throw new Error(`A read with per needs an in-list on ${s.per}: every loader read has one.`);
        const rest = s.where.filter((one) => one !== perList);
        const out: DocRow[] = [];
        for (const key of new Set(perList.in)) {
          const where = [{ col: s.per, in: [key] }, ...rest];
          out.push(...(timed ? cut(await rowsWhere(s, where), s) : await limited(s, where)));
        }
        return finish(out, s);
      }
      return finish(timed ? cut(await every(s), s) : await limited(s, s.where), s);
    },

    async count(c, column, values) {
      const spec = tableOf(c);
      if (!keyColumnsOf(spec).includes(column)) throw new Error(`The SQLite table ${spec.table} has no key column ${column}.`);
      const out = new Map<string, number>();
      for (const value of new Set(values)) {
        const [row] = await q<{ n: number }>(`select count(*) as n from ${spec.table} where ${column} = ?`, [value]);
        if (Number(row.n) > 0) out.set(value, Number(row.n));
      }
      return out;
    },

    async countWhere(s: CountSelect) {
      if (matchesNothing(s)) return new Map();
      const table = tableOf(s.c).table;
      columnOf(s.c, s.per);
      const out = new Map<string, number>();
      const bounds = s.where.find((one): one is Bounds => 'bounds' in one && one.bounds.col === s.per);
      if (bounds) {
        for (const [key, bound] of Object.entries(bounds.bounds.by)) {
          const values: unknown[] = [key];
          const terms = boundTerms(bound, values);
          const rest = whereOf({ ...s, where: s.where.filter((one) => one !== bounds) }, values);
          const [row] = await q<{ n: number }>(`select count(*) as n from ${table} t where t.${s.per} = ? and ${terms} and ${rest}`, values);
          if (Number(row.n) > 0) out.set(key, Number(row.n));
        }
        return out;
      }
      const values: unknown[] = [];
      const rows = await q<{ v: string | null; n: number }>(`select t.${s.per} as v, count(*) as n from ${table} t where ${whereOf(s, values)} group by t.${s.per}`, values);
      for (const row of rows) if (row.v !== null) out.set(String(row.v), Number(row.n));
      return out;
    },

    async undoLinks(eventIds) {
      const out = new Map<string, string>();
      for (const id of new Set(eventIds)) {
        for (const row of await q<{ id: string; undoes: string }>('select id, undoes from events where undoes = ?', [id])) out.set(row.undoes, row.id);
      }
      return out;
    },

    async referencing(c, path, id, except) {
      const spec = tableOf(c);
      const column = /^[a-zA-Z]+$/.test(path) ? columnOfField(c, path) : undefined;
      const values: unknown[] = [];
      let match: string;
      if (column && keyColumnsOf(spec).includes(column)) {
        values.push(id);
        match = `t.${column} = ?`;
      } else {
        match = pathMatch(path, id, values);
      }
      values.push(except);
      // order by rowid limit 1: the first match in insertion order. The rowid order is the table order, so it adds no sort.
      return rowsOf(await q<Rec>(`select t.rowid as ord, t.doc as doc from ${spec.table} t where ${match} and t.id is not ? order by t.rowid limit 1`, values));
    },

    async threads(o) {
      const found = await q<{ id: string; last: string; mine: string | null }>(THREADS_LITE, [o.owner, JSON.stringify(o.led), JSON.stringify(o.me), o.admin ? 1 : 0]);
      found.sort((a, b) => textOrder(b.last, a.last) || textOrder(b.id, a.id));
      const edge = found[o.limit - 1]?.last;
      return edge === undefined ? found : found.filter((thread) => thread.last >= edge);
    },

    async counters() {
      const rows = await q<{ prefix: string; n: number }>('select prefix, n from counters');
      return Object.fromEntries(rows.map((row) => [row.prefix, Number(row.n)]));
    },
  };
}
