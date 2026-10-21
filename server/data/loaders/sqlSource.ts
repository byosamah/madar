import { jsonPathOf } from '../../../src/api/references';
import type { Query } from '../../core/ports';
import { COUNTERS_SELECT_SQL } from '../rows';
import { tableOf, type TableCollection } from '../tables';
import { assertOrder, columnOf, columnOfField, fieldName, isAscending, matchesNothing, type Bound, type Cond, type CountSelect, type Row, type Select } from './query';
import type { Source } from './source';

/**
 * A Source on the database (task C2). Each read is one statement inside the call's transaction. Values always go as parameters;
 * table, column and field names come only from the lists in tables.ts and query.ts.
 */

const C = 'collate "C"';
const HOUR = 3_600_000;

/**
 * A text bound for a stamp next to this time. The index on created_at (collate "C") then serves the read at that end (performance
 * audit DB-1). The bound is the UTC text 'YYYY-MM-DDTHH:MM:SS' of the time moved by hours. A lower bound moves back 36 hours, an upper
 * bound forward 36 hours. Every stored stamp is ISO text with an offset between -12:00 and +14:00. A stamp at or after the time has
 * a text at or after the UTC text of (the time minus 12 hours). Minus 36 hours is safe as well. A stamp before the time has
 * a text before the UTC text of (the time plus 14 hours). Plus 36 hours is safe as well. The bounds never leave out a row
 * that the time test keeps. Null for a time that does not parse: the time test alone decides.
 */
function textBoundOf(time: string, hours: number): string | null {
  const moved = new Date(Date.parse(time) + hours * HOUR);
  return Number.isNaN(moved.getTime()) ? null : moved.toISOString().slice(0, 19);
}

/** The rows of a "bounds" condition, one for each key, as jsonb_to_recordset reads them. */
function boundRows(by: Readonly<Record<string, Bound>>): string {
  return JSON.stringify(Object.entries(by).map(([k, bound]) => ({ k, gt: bound.gt, ge: bound.ge ?? null, aat: bound.after?.at ?? null, aid: bound.after?.id ?? null })));
}

/** The terms of one bound "b" on a row "t": created_at after gt, at or after ge, and (created_at, id) after the pair of "after". */
const BOUND_TERMS = `t.created_at ${C} > b.gt ${C} and (b.ge is null or t.created_at ${C} >= b.ge ${C}) `
  + `and (b.aat is null or t.created_at ${C} > b.aat ${C} or (t.created_at = b.aat and t.id ${C} > b.aid ${C}))`;

/**
 * The table and the where clause of a Select or a count: $1 and up are its values. "conds" holds each condition alone. "joined"
 * is a bounds condition whose rows "b" the statement joins (countSql), so its terms name b directly.
 */
function whereSql(s: Select | CountSelect, values: unknown[], joined?: Cond, single = false): { col: (name: string) => string; conds: string[]; where: string } {
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
    if ('after' in one) {
      const at = param(one.after.at, 'text');
      return `(t.created_at ${C} > ${at} or (t.created_at = ${at} and t.id ${C} > ${param(one.after.id, 'text')}))`;
    }
    if ('bounds' in one) {
      if (one === joined) return `(${BOUND_TERMS})`;
      return `exists (select 1 from jsonb_to_recordset(${param(boundRows(one.bounds.by), 'jsonb')}) as b(k text, gt text, ge text, aat text, aid text) `
        + `where b.k = ${col(one.bounds.col)} and ${BOUND_TERMS})`;
    }
    if ('key' in one) return `t.doc->'${fieldName(one.field)}'->>'${fieldName(one.key)}' = any(${param(one.in, 'text[]')})`;
    if ('field' in one) {
      const field = fieldName(one.field);
      if ('null' in one) return `(t.doc->'${field}' is null or t.doc->'${field}' = 'null'::jsonb)`;
      if ('notIn' in one) return `(t.doc->>'${field}' is null or not (t.doc->>'${field}' = any(${param(one.notIn, 'text[]')})))`;
      return `t.doc->>'${field}' = any(${param(one.in, 'text[]')})`;
    }
    const column = col(one.col);
    const type = columnOf(s.c, one.col).type;
    // One key reads as an equality when "single" is set: an ordered read of one key (the newest notices of a person) then walks an index
    // in order, which an any() test over an array does not allow (performance audit DB-9, perf2).
    if ('in' in one) {
      if (single && one.in.length === 1) return `${column} = ${param(one.in[0], type === 'int' ? 'int' : 'text')}`;
      return `${column} = any(${param(one.in, type === 'int' ? 'int[]' : 'text[]')})`;
    }
    if ('notIn' in one) return `(${column} is null or not (${column} = any(${param(one.notIn, 'text[]')})))`;
    if ('eq' in one) return one.eq === null ? `${column} is null` : `${column} = ${param(one.eq, type === 'bool' ? 'boolean' : type === 'int' ? 'int' : 'text')}`;
    if ('contains' in one) return `${column} like ${param(likeOf(one.contains), 'text')}`;
    // An upper bound gets the mirror of the lower one (36 hours later), so the index bounds the period at both ends (reports.office).
    if ('atBefore' in one) {
      const time = `(${column})::timestamptz < ${param(one.atBefore, 'timestamptz')}`;
      const bound = textBoundOf(one.atBefore, 36);
      return bound === null ? time : `(${time} and ${column} ${C} < ${param(bound, 'text')})`;
    }
    const time = `(${column})::timestamptz >= ${param(one.atOrAfter, 'timestamptz')}`;
    const bound = textBoundOf(one.atOrAfter, -36);
    return bound === null ? time : `(${time} and ${column} ${C} >= ${param(bound, 'text')})`;
  }

  const conds = s.where.map(cond);
  return { col, conds, where: conds.length > 0 ? ` where ${conds.join(' and ')}` : '' };
}

/**
 * The LIKE pattern of a contains condition: the text with \\, % and _ escaped by \\, between two %. Postgres uses the backslash as the
 * escape character of LIKE, so a typed % or _ is a letter and never a wildcard. A trigram index serves this pattern (strpos cannot).
 */
export function likeOf(text: string): string {
  return `%${text.replace(/[\\%_]/g, (letter) => `\\${letter}`)}%`;
}

/** jsonb_build_object takes at most 100 arguments, so a pick of more fields reads them with jsonb_each. */
const PICK_BUILD_MAX = 50;

/**
 * The doc of a read that takes only some fields (performance audit DB-4): jsonb_build_object of the picked keys, minus the keys
 * that the doc does not hold, so an absent field stays absent and a JSON null stays null. jsonb keeps its keys in its own order,
 * so the doc is the one that jsonb_each and jsonb_object_agg give, at a fraction of the cost. The names stay in one array
 * parameter and never go into the SQL text.
 */
function pickSql(pick: readonly string[], param: (value: unknown, type: string) => string): string {
  if (pick.length === 0) return `'{}'::jsonb`;
  const keys = param(pick, 'text[]');
  if (pick.length > PICK_BUILD_MAX) return `(select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) from jsonb_each(t.doc) e where e.key = any(${keys}))`;
  const key = (i: number) => `(${keys})[${i + 1}]`;
  const pairs = pick.map((_, i) => `${key(i)}, t.doc->(${key(i)})`).join(', ');
  const absent = pick.map((_, i) => `case when t.doc ? ${key(i)} then null else ${key(i)} end`).join(', ');
  return `(jsonb_build_object(${pairs}) - array_remove(array[${absent}], null))`;
}

/** The in-list condition of a Select on its "per" column, at the top level: the keys whose newest rows it reads. */
function perListOf(s: Select): { col: string; in: readonly string[] } | undefined {
  if (s.limit === undefined || !s.per) return undefined;
  return s.where.find((one): one is { col: string; in: readonly string[] } => 'col' in one && one.col === s.per && 'in' in one);
}

/** The SQL of one Select: $1 and up are its values. */
export function selectSql(s: Select): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const param = (value: unknown, type: string) => {
    values.push(value);
    return `$${values.length}::${type}`;
  };
  assertOrder(s);
  const table = tableOf(s.c).table;
  // The newest rows of each key of an in-list (performance audit DB-2): one read on the index of each key, never a window over
  // every row of the keys. rank() <= N keeps the same rows as FETCH FIRST N ROWS WITH TIES in the same order, and row_number()
  // <= N the same rows as LIMIT N, because that order ends with t.ord and is total. DISTINCT reads a repeated key once.
  const perList = perListOf(s);
  const keys = perList ? param(perList.in, columnOf(s.c, perList.col).type === 'int' ? 'int[]' : 'text[]') : '';
  // The plain LIMIT form (performance audit DB-9, perf2): an ordered read with no "per" and no ties, whose order ends with the id. The
  // id is unique, so the order is total with no t.ord, and an index on the order columns can give the first rows with no sort. One key
  // of a list reads as an equality for the same reason.
  const plain = s.limit !== undefined && !perList && !s.per && !s.ties && s.order?.id === true;
  const { col, conds, where } = whereSql(perList ? { ...s, where: s.where.filter((one) => one !== perList) } : s, values, undefined, plain);
  const doc = s.pick ? pickSql(s.pick, param) : 't.doc';
  if (s.limit === undefined) return { text: `select t.ord, ${doc} as doc from ${table} t${where} order by t.ord`, values };

  const order = s.order;
  const columnType = order ? columnOf(s.c, order.col).type : 'text';
  const way = order && isAscending(order) ? 'asc' : 'desc';
  const ordering = order
    ? [`${col(order.col)}${columnType === 'text' ? ` ${C}` : ''} ${way}`, ...(order.id ? [`t.id ${C} ${way}`] : []), ...(s.ties || plain ? [] : [`t.ord ${way}`])].join(', ')
    : 't.ord';
  const limit = param(s.limit, 'int');
  if (plain) {
    // The outer order by ord keeps the order of the rows that the window form gave.
    return { text: `select x.ord, x.doc from (select t.ord, ${doc} as doc from ${table} t${where} order by ${ordering} limit ${limit}) x order by x.ord`, values };
  }
  if (perList) {
    const inner = [`${col(perList.col)} = p.k`, ...conds].join(' and ');
    const cut = s.ties ? `fetch first (${limit}) rows with ties` : `limit ${limit}`;
    return {
      text: `select x.ord, x.doc from (select distinct k from unnest(${keys}) as k) p cross join lateral `
        + `(select t.ord, ${doc} as doc from ${table} t where ${inner} order by ${ordering} ${cut}) x order by x.ord`,
      values,
    };
  }
  const partition = s.per ? `partition by ${col(s.per)} ` : '';
  const rank = `${s.ties ? 'rank' : 'row_number'}() over (${partition}order by ${ordering})`;
  return {
    text: `select ord, doc from (select t.ord, ${doc} as doc, ${rank} as r from ${table} t${where}) x where r <= ${limit} order by ord`,
    values,
  };
}

/**
 * The SQL of one count: one grouped count over the rows that the conditions match. With a bounds condition on the column "per"
 * (the unread counts), each key counts its own rows in a LATERAL subquery on the index of that column (performance audit DB-6,
 * DB-5 of perf2). Its keys come from an object, so each one is unique, and the count of each key stays the same.
 */
export function countSql(s: CountSelect): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const joined = s.where.find((one): one is Extract<Cond, { bounds: unknown }> => 'bounds' in one && one.bounds.col === s.per);
  if (joined) {
    columnOf(s.c, s.per);
    values.push(boundRows(joined.bounds.by));
    const { conds } = whereSql(s, values, joined);
    // One count for each key in a LATERAL subquery: the key reads its own rows on the index of the column, whatever the size of the
    // table. A join let Postgres choose a hash join and a scan of every message at 15,000 messages (performance audit DB-5, perf2).
    // A key with no row gives no row, as the grouped join did.
    return {
      text: `select b.k as v, x.n from jsonb_to_recordset($1::jsonb) as b(k text, gt text, ge text, aat text, aid text) `
        + `cross join lateral (select count(*)::integer as n from ${tableOf(s.c).table} t where t.${s.per} = b.k and ${conds.join(' and ')}) x where x.n > 0`,
      values,
    };
  }
  const { col, where } = whereSql(s, values);
  const per = col(s.per);
  return { text: `select ${per} as v, count(*)::integer as n from ${tableOf(s.c).table} t${where} group by ${per}`, values };
}

export function sqlSource(q: Query): Source {
  const read = async <R,>(text: string, values: unknown[]): Promise<R[]> => q<R>(text, values);

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

    async countWhere(s) {
      if (matchesNothing(s)) return new Map();
      const { text, values } = countSql(s);
      const rows = await read<{ v: string | null; n: number }>(text, values);
      return new Map(rows.flatMap((row) => (row.v === null ? [] : [[row.v, Number(row.n)] as const])));
    },

    async undoLinks(eventIds) {
      if (eventIds.length === 0) return new Map();
      const rows = await read<{ id: string; undoes: string }>('select id, undoes from events where undoes = any($1::text[])', [eventIds]);
      return new Map(rows.map((row) => [row.undoes, row.id]));
    },

    async referencing(c, path, id, except) {
      // A plain field with a text column of its own (doc->>'field'): one equality on that column, often on its index, never a
      // jsonpath scan of every row (performance audit DB-M3). A zod id field holds one string or null, so both give the same row.
      const column = /^[a-zA-Z]+$/.test(path) ? columnOfField(c, path) : undefined;
      const rows = column
        ? await read<{ ord: string | number; doc: Record<string, unknown> }>(
          `select t.ord, t.doc from ${tableOf(c).table} t where t.${column} = $1::text and t.id is distinct from $2::text order by t.ord limit 1`,
          [id, except],
        )
        : await read<{ ord: string | number; doc: Record<string, unknown> }>(
          `select t.ord, t.doc from ${tableOf(c).table} t where jsonb_path_exists(t.doc, $1::jsonpath, jsonb_build_object('id', $2::text)) `
            + 'and t.id is distinct from $3::text order by t.ord limit 1',
          [`${jsonPathOf(path)} ? (@ == $id)`, id, except],
        );
      return rows.map((row) => ({ ord: Number(row.ord), doc: row.doc }));
    },

    async threads(o) {
      return read<{ id: string; last: string; mine: string | null }>(
        `with mine as (select distinct target_id from comments where target_type = 'task' and doc->>'authorId' = any($3::text[])),
         cand as (select k.id from tasks k
           where (k.owner_id = $1::text or k.project_id = any($2::text[]) or k.id in (select target_id from mine)
               or (k.project_id is null and k.doc->>'createdBy' = any($3::text[])))
             and (k.project_id is not null or $5::boolean or k.owner_id = $1::text or k.doc->'helperIds' ? $1::text
               or k.doc->>'createdBy' = any($3::text[]))
         ),
         threads as (
           select c.target_id as id, max(c.created_at ${C}) as last,
                  max(c.created_at ${C}) filter (where c.doc->>'authorId' = any($3::text[])) as mine
           from comments c where c.target_type = 'task' and c.target_id in (select id from cand)
           group by c.target_id
         ),
         ranked as (select id, last, mine, rank() over (order by last ${C} desc) as r from threads)
         select id, last, mine from ranked where r <= $4::int order by last ${C} desc, id ${C} desc`,
        [o.owner, o.led, o.me, o.limit, o.admin],
      );
    },

    async counters() {
      const rows = await read<{ prefix: string; n: number | string }>(COUNTERS_SELECT_SQL, []);
      return Object.fromEntries(rows.map((row) => [row.prefix, Number(row.n)]));
    },
  };
}
