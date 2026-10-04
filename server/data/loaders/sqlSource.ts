import { jsonPathOf } from '../../../src/api/references';
import type { Query } from '../../core/ports';
import { COUNTERS_SELECT_SQL } from '../rows';
import { tableOf, type TableCollection } from '../tables';
import { columnOf, fieldName, matchesNothing, type Cond, type Row, type Select } from './query';
import type { Source } from './source';

/**
 * A Source on the database (task C2). Each read is one statement inside the call's transaction. Values always go as parameters;
 * table, column and field names come only from the lists in tables.ts and query.ts. Each answer counts toward the egress meter
 * (plan, change 10): "bytes" gets the size of the rows that the database sent.
 */

const C = 'collate "C"';
const bytesOf = (rows: unknown[]) => new TextEncoder().encode(JSON.stringify(rows)).length;

/** The SQL of one Select: $1 and up are its values. */
export function selectSql(s: Select): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const param = (value: unknown, type: string) => {
    values.push(value);
    return `$${values.length}::${type}`;
  };
  const col = (name: string) => {
    columnOf(s.c, name);
    return `t.${name}`;
  };

  function cond(one: Cond): string {
    if ('or' in one) return `(${one.or.map(cond).join(' or ')})`;
    if ('notUndone' in one) {
      if (s.c !== 'events') throw new Error('notUndone is for events only.');
      return 'not exists (select 1 from events u where u.undoes = t.id)';
    }
    if ('has' in one) return `t.doc->'${fieldName(one.has)}' ? ${param(one.value, 'text')}`;
    if ('before' in one) {
      const at = param(one.before.at, 'text');
      return `(t.created_at ${C} < ${at} or (t.created_at = ${at} and t.id ${C} < ${param(one.before.id, 'text')}))`;
    }
    if ('bounds' in one) {
      const rows = Object.entries(one.bounds.by).map(([k, bound]) => ({ k, gt: bound.gt, ge: bound.ge ?? null }));
      return `exists (select 1 from jsonb_to_recordset(${param(JSON.stringify(rows), 'jsonb')}) as b(k text, gt text, ge text) `
        + `where b.k = ${col(one.bounds.col)} and t.created_at ${C} > b.gt ${C} and (b.ge is null or t.created_at ${C} >= b.ge ${C}))`;
    }
    if ('field' in one) {
      const field = fieldName(one.field);
      if ('null' in one) return `(t.doc->'${field}' is null or t.doc->'${field}' = 'null'::jsonb)`;
      return `t.doc->>'${field}' = any(${param(one.in, 'text[]')})`;
    }
    const column = col(one.col);
    const type = columnOf(s.c, one.col).type;
    if ('in' in one) return `${column} = any(${param(one.in, type === 'int' ? 'int[]' : 'text[]')})`;
    if ('notIn' in one) return `(${column} is null or not (${column} = any(${param(one.notIn, 'text[]')})))`;
    if ('eq' in one) return one.eq === null ? `${column} is null` : `${column} = ${param(one.eq, type === 'bool' ? 'boolean' : type === 'int' ? 'int' : 'text')}`;
    if ('contains' in one) return `strpos(${column}, ${param(one.contains, 'text')}) > 0`;
    return `(${column})::timestamptz >= ${param(one.atOrAfter, 'timestamptz')}`;
  }

  const table = tableOf(s.c).table;
  const doc = s.pick
    ? `(select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(t.doc) e where e.key = any(${param(s.pick, 'text[]')}))`
    : 't.doc';
  const where = s.where.length > 0 ? ` where ${s.where.map(cond).join(' and ')}` : '';
  if (s.limit === undefined) return { text: `select t.ord, ${doc} as doc from ${table} t${where} order by t.ord`, values };

  const order = s.order;
  const columnType = order ? columnOf(s.c, order.col).type : 'text';
  const ordering = order
    ? [`${col(order.col)}${columnType === 'text' ? ` ${C}` : ''} desc`, ...(order.id ? [`t.id ${C} desc`] : []), ...(s.ties ? [] : ['t.ord desc'])].join(', ')
    : 't.ord';
  const partition = s.per ? `partition by ${col(s.per)} ` : '';
  const rank = `${s.ties ? 'rank' : 'row_number'}() over (${partition}order by ${ordering})`;
  const limit = param(s.limit, 'int');
  return {
    text: `select ord, doc from (select t.ord, ${doc} as doc, ${rank} as r from ${table} t${where}) x where r <= ${limit} order by ord`,
    values,
  };
}

export function sqlSource(q: Query, o: { bytes?: (n: number) => void } = {}): Source {
  const read = async <R,>(text: string, values: unknown[]): Promise<R[]> => {
    const rows = await q<R>(text, values);
    o.bytes?.(bytesOf(rows));
    return rows;
  };

  return {
    async select(s) {
      if (matchesNothing(s)) return [];
      const { text, values } = selectSql(s);
      const rows = await read<{ ord: string | number; doc: Record<string, unknown> }>(text, values);
      return rows.map((row): Row => ({ ord: Number(row.ord), doc: row.doc }));
    },

    async count(c, column, values) {
      if (values.length === 0) return new Map();
      columnOf(c, column);
      const rows = await read<{ v: string; n: number }>(
        `select ${column} as v, count(*)::integer as n from ${tableOf(c).table} where ${column} = any($1::text[]) group by ${column}`, [values],
      );
      return new Map(rows.map((row) => [row.v, Number(row.n)]));
    },

    async undoLinks(eventIds) {
      if (eventIds.length === 0) return new Map();
      const rows = await read<{ id: string; undoes: string }>('select id, undoes from events where undoes = any($1::text[])', [eventIds]);
      return new Map(rows.map((row) => [row.undoes, row.id]));
    },

    async referencing(c, path, id, except) {
      const rows = await read<{ ord: string | number; doc: Record<string, unknown> }>(
        `select t.ord, t.doc from ${tableOf(c).table} t where jsonb_path_exists(t.doc, $1::jsonpath, jsonb_build_object('id', $2::text)) `
          + 'and t.id is distinct from $3::text order by t.ord limit 1',
        [`${jsonPathOf(path)} ? (@ == $id)`, id, except],
      );
      return rows.map((row) => ({ ord: Number(row.ord), doc: row.doc }));
    },

    async threads(o) {
      return read<{ id: string; last: string; mine: string | null }>(
        `with mine as (select distinct target_id from comments where target_type = 'task' and doc->>'authorId' = any($3::text[])),
         threads as (
           select c.target_id as id, max(c.created_at ${C}) as last,
                  max(c.created_at ${C}) filter (where c.doc->>'authorId' = any($3::text[])) as mine
           from comments c join tasks k on k.id = c.target_id
           where c.target_type = 'task' and (k.owner_id = $1::text or k.project_id = any($2::text[]) or c.target_id in (select target_id from mine))
           group by c.target_id
         ),
         ranked as (select id, last, mine, rank() over (order by last ${C} desc) as r from threads)
         select id, last, mine from ranked where r <= $4::int order by last ${C} desc, id ${C} desc`,
        [o.owner, o.led, o.me, o.limit],
      );
    },

    async counters() {
      const rows = await read<{ prefix: string; n: number | string }>(COUNTERS_SELECT_SQL, []);
      return Object.fromEntries(rows.map((row) => [row.prefix, Number(row.n)]));
    },
  };
}
