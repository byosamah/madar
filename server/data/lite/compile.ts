import { columnOf, fieldName, type Bound, type Cond, type CountSelect, type Select } from '../loaders/query';

/**
 * The conditions of a loader read in SQLite form (Supabase exit, wave 1). Each kind keeps the rule of the memory form
 * (memorySource.ts, holds), which the loader tests use. Values go as ? values in text order; names come only from COLUMNS and
 * fieldName. Text order is byte order (BINARY), the code point order of collate "C" and of the memory form.
 */

/**
 * Up to this many values go as bound values in one list; a longer list goes as one JSON value, so a statement stays under 100.
 * A read with ties holds its conditions twice: two lists of this size and the limit use 2 x 48 + 1 = 97 values. The project feed
 * lists FEED_VERBS (21 verbs, wave 2): over this size SQLite drives its read by the verb and reads twice the rows (compile.test.ts).
 */
export const LIST_BOUND_MAX = 24;
const HOUR = 3_600_000;

/** A doc field as text, as the memory form gives it (fieldText): 'true', 'false', '3', '1.5', JSON text for an object or a list. */
export function fieldText(path: string): string {
  const value = `json_extract(t.doc, '${path}')`;
  return `(case json_type(t.doc, '${path}') when 'true' then 'true' when 'false' then 'false' when 'integer' then cast(${value} as text) when 'real' then cast(${value} as text) else ${value} end)`;
}

/** expr in the list: = for one value, bound values for a short list, json_each for a long one. An empty list matches nothing. */
export function listSql(expr: string, list: readonly unknown[], values: unknown[], negate = false): string {
  if (list.length === 0) return negate ? '1' : '0';
  if (list.length === 1) {
    values.push(list[0]);
    return `${expr} ${negate ? '<>' : '='} ?`;
  }
  const op = negate ? 'not in' : 'in';
  if (list.length <= LIST_BOUND_MAX) {
    values.push(...list);
    return `${expr} ${op} (${list.map(() => '?').join(', ')})`;
  }
  values.push(JSON.stringify(list));
  return `${expr} ${op} (select value from json_each(?))`;
}

/** The terms of one bound on a row t: created_at after gt, at or after ge, and (created_at, id) after the pair of after. */
export function boundTerms(bound: Bound, values: unknown[]): string {
  values.push(bound.gt);
  let sql = 't.created_at > ?';
  if (bound.ge !== undefined) {
    values.push(bound.ge);
    sql += ' and t.created_at >= ?';
  }
  if (bound.after) {
    values.push(bound.after.at, bound.after.at, bound.after.id);
    sql += ' and (t.created_at > ? or (t.created_at = ? and t.id > ?))';
  }
  return sql;
}

export function whereOf(s: Select | CountSelect, values: unknown[], skip: readonly Cond[] = []): string {
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
    if ('has' in one) {
      const path = `$.${fieldName(one.has)}`;
      values.push(one.value);
      return `(json_type(t.doc, '${path}') = 'array' and exists (select 1 from json_each(t.doc, '${path}') h where h.value = ?))`;
    }
    if ('before' in one) {
      values.push(one.before.at, one.before.at, one.before.id);
      return '(t.created_at < ? or (t.created_at = ? and t.id < ?))';
    }
    if ('after' in one) {
      values.push(one.after.at, one.after.at, one.after.id);
      return '(t.created_at > ? or (t.created_at = ? and t.id > ?))';
    }
    if ('bounds' in one) {
      const column = col(one.bounds.col);
      const terms = Object.entries(one.bounds.by).map(([key, bound]) => {
        values.push(key);
        return `(${column} = ? and ${boundTerms(bound, values)})`;
      });
      return terms.length === 0 ? '0' : `(${terms.join(' or ')})`;
    }
    if ('key' in one) return listSql(fieldText(`$.${fieldName(one.field)}.${fieldName(one.key)}`), one.in, values);
    if ('field' in one) {
      const path = `$.${fieldName(one.field)}`;
      if ('null' in one) return `(json_type(t.doc, '${path}') is null or json_type(t.doc, '${path}') = 'null')`;
      const text = fieldText(path);
      if ('notIn' in one) return `(${text} is null or ${listSql(text, one.notIn, values, true)})`;
      return listSql(text, one.in, values);
    }
    const column = col(one.col);
    const type = columnOf(s.c, one.col).type;
    const typed = (list: readonly string[]) => (type === 'int' ? list.map(Number) : list);
    if ('in' in one) return listSql(column, typed(one.in), values);
    if ('notIn' in one) return `(${column} is null or ${listSql(column, typed(one.notIn), values, true)})`;
    if ('eq' in one) {
      if (one.eq === null) return `${column} is null`;
      values.push(typeof one.eq === 'boolean' ? (one.eq ? 1 : 0) : type === 'int' ? Number(one.eq) : one.eq);
      return `${column} = ?`;
    }
    if ('contains' in one) {
      values.push(one.contains);
      return `instr(${column}, ?) > 0`;
    }
    // atBefore: the time test, plus the text bound of sqlSource.ts (the UTC text of the time plus 36 hours).
    // The text bound lets the created_at index limit the read at its upper end. It loses no row.
    if ('atBefore' in one) {
      values.push(one.atBefore);
      const before = `julianday(${column}) < julianday(?)`;
      const after = new Date(Date.parse(one.atBefore) + 36 * HOUR);
      if (Number.isNaN(after.getTime())) return before;
      values.push(after.toISOString().slice(0, 19));
      return `(${before} and ${column} < ?)`;
    }
    // atOrAfter: the time test (julianday keeps the milliseconds and reads every offset, Task 1), plus the text bound of
    // sqlSource.ts (the UTC text of the time minus 36 hours), so the created_at index serves the read and no row is lost.
    values.push(one.atOrAfter);
    const time = `julianday(${column}) >= julianday(?)`;
    const back = new Date(Date.parse(one.atOrAfter) - 36 * HOUR);
    if (Number.isNaN(back.getTime())) return time;
    values.push(back.toISOString().slice(0, 19));
    return `(${time} and ${column} >= ?)`;
  }
  const conds = s.where.filter((one) => !skip.includes(one)).map(cond);
  return conds.length > 0 ? conds.join(' and ') : '1';
}

export type InList = { col: string; in: readonly string[] };

/**
 * The list that a read takes key by key: the first top-level in-list with more than one value on id or on a column of a read
 * index. One = statement for each key reads about one row a key; a list of bound values reads two, json_each three (wave 0).
 */
export function drivingListOf(s: Select | CountSelect, indexed: ReadonlySet<string>): InList | undefined {
  return s.where.find((one): one is InList => 'col' in one && 'in' in one && one.in.length > 1 && (one.col === 'id' || indexed.has(one.col)));
}

/**
 * The test that a doc holds id at a reference path (REFERENCE_FIELDS, src/api/references.ts), with the rules of valuesAt: a list
 * step reads only a JSON list, a * step reads the values of an object or a list, and a missing or null step gives no value.
 * Every JSON function reads t.doc with a full path (the fullkey of json_each): a json_each value can be plain text that is not
 * JSON (a string in a list), and json_extract of that text fails with "malformed JSON".
 */
export function pathMatch(path: string, id: string, values: unknown[]): string {
  const joins: string[] = [];
  const guards: string[] = [];
  let base = '';
  let tail = '';
  const where = () => (base === '' ? `'$${tail}'` : tail === '' ? base : `${base} || '${tail}'`);
  path.split('.').forEach((part, i) => {
    const list = part.endsWith('[]');
    const name = list ? part.slice(0, -2) : part;
    if (name === '*') {
      guards.push(`json_type(t.doc, ${where()}) in ('object', 'array')`);
      joins.push(`json_each(t.doc, ${where()}) s${i}`);
      base = `s${i}.fullkey`;
      tail = '';
    } else {
      tail += `.${fieldName(name)}`;
    }
    if (list) {
      guards.push(`json_type(t.doc, ${where()}) = 'array'`);
      joins.push(`json_each(t.doc, ${where()}) l${i}`);
      base = `l${i}.fullkey`;
      tail = '';
    }
  });
  values.push(id);
  const test = `json_extract(t.doc, ${where()}) = ?`;
  return joins.length === 0 ? test : `exists (select 1 from ${joins.join(', ')} where ${[...guards, test].join(' and ')})`;
}
