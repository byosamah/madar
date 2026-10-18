import { valuesAt } from '../../../src/api/references';
import type { State } from '../../../src/api/store';
import { tableOf, type TableCollection } from '../tables';
import { columnOf, matchesNothing, type Cond, type Row, type Select } from './query';
import type { Source } from './source';

/**
 * A Source over a whole office in memory (task C2). It answers each read as the SQL of sqlSource.ts does, and it never hands out
 * an object of the office: every doc is a copy. The loader tests use it to run a call on a scoped load and on the whole office.
 */

type Rec = Record<string, unknown>;

/** The text of a doc field as doc->>'field' gives it. */
function fieldText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Text order by code point, as "collate C" orders ASCII text. */
const before = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function memorySource(state: State): Source {
  const rowsOf = new Map<TableCollection, (Row & { key: string })[]>();
  function all(c: TableCollection): (Row & { key: string })[] {
    let rows = rowsOf.get(c);
    if (!rows) {
      const spec = tableOf(c);
      const docs = c === 'settings' ? [state.settings as Rec] : Object.values((state[c] ?? {}) as Record<string, Rec>);
      rows = docs.map((doc, index) => ({ ord: index + 1, doc, key: spec.key(doc) }));
      rowsOf.set(c, rows);
    }
    return rows;
  }
  let undone: Map<string, string> | undefined;
  function undoneMap(): Map<string, string> {
    undone ??= new Map(Object.values(state.events).flatMap((event) => (event.undoes ? [[event.undoes, event.id] as const] : [])));
    return undone;
  }

  function holds(c: TableCollection, doc: Rec, key: string, cond: Cond): boolean {
    const spec = tableOf(c);
    const col = (name: string) => columnOf(c, name).value(doc, state, spec);
    if ('or' in cond) return cond.or.some((one) => holds(c, doc, key, one));
    if ('notUndone' in cond) return !undoneMap().has(key);
    if ('has' in cond) {
      const list = doc[cond.has];
      return Array.isArray(list) && list.includes(cond.value);
    }
    if ('before' in cond) {
      const at = String(doc.createdAt);
      return at < cond.before.at || (at === cond.before.at && key < cond.before.id);
    }
    if ('bounds' in cond) {
      const bound = cond.bounds.by[String(col(cond.bounds.col))];
      if (!bound) return false;
      const at = String(doc.createdAt);
      const after = bound.after;
      return at > bound.gt && (bound.ge === undefined || at >= bound.ge) && (after === undefined || at > after.at || (at === after.at && key > after.id));
    }
    if ('key' in cond) {
      // doc->'field'->>'key': only an object field has keys, and a JSON null or an absent key gives no text.
      const outer = doc[cond.field];
      const value = outer !== null && typeof outer === 'object' && !Array.isArray(outer) ? fieldText((outer as Rec)[cond.key]) : null;
      return value !== null && cond.in.includes(value);
    }
    if ('field' in cond) {
      const value = fieldText(doc[cond.field]);
      if ('null' in cond) return value === null;
      if ('notIn' in cond) return value === null || !cond.notIn.includes(value);
      return value !== null && cond.in.includes(value);
    }
    const value = col(cond.col);
    if ('in' in cond) return value !== null && cond.in.includes(String(value));
    if ('notIn' in cond) return value === null || !cond.notIn.includes(String(value));
    if ('eq' in cond) return value === cond.eq;
    if ('contains' in cond) return typeof value === 'string' && value.includes(cond.contains);
    if ('atBefore' in cond) return typeof value === 'string' && Date.parse(value) < Date.parse(cond.atBefore);
    return typeof value === 'string' && Date.parse(value) >= Date.parse(cond.atOrAfter);
  }

  function pickOf(doc: Rec, fields: readonly string[] | undefined): Rec {
    if (!fields) return structuredClone(doc);
    return structuredClone(Object.fromEntries(fields.filter((field) => field in doc).map((field) => [field, doc[field]])));
  }

  return {
    async select(s: Select): Promise<Row[]> {
      if (matchesNothing(s)) return [];
      const spec = tableOf(s.c);
      let rows = all(s.c).filter((row) => s.where.every((cond) => holds(s.c, row.doc, row.key, cond)));
      if (s.limit !== undefined) {
        const order = s.order;
        const sortValue = (row: Row) => (order ? columnOf(s.c, order.col).value(row.doc, state, spec) : null);
        const compare = (a: Row & { key: string }, b: Row & { key: string }) => {
          if (order) {
            const x = sortValue(a);
            const y = sortValue(b);
            const byCol = typeof x === 'number' && typeof y === 'number' ? y - x : before(String(y ?? ''), String(x ?? ''));
            if (byCol !== 0) return byCol;
            if (order.id) return before(b.key, a.key);
            return s.ties ? 0 : b.ord - a.ord;
          }
          return a.ord - b.ord;
        };
        const groups = new Map<string, (Row & { key: string })[]>();
        for (const row of rows) {
          const group = s.per ? String(columnOf(s.c, s.per).value(row.doc, state, spec)) : '';
          const list = groups.get(group);
          if (list) list.push(row);
          else groups.set(group, [row]);
        }
        rows = [...groups.values()].flatMap((group) => {
          const sorted = [...group].sort(compare);
          // The rank of a row is one more than the rows that come strictly before it, as rank() in SQL.
          const kept: (Row & { key: string })[] = [];
          let rank = 0;
          for (const [index, row] of sorted.entries()) {
            if (index === 0 || !s.ties || compare(sorted[index - 1], row) !== 0) rank = index;
            if (rank >= s.limit!) break;
            kept.push(row);
          }
          return kept;
        });
        rows.sort((a, b) => a.ord - b.ord);
      }
      return rows.map((row) => ({ ord: row.ord, doc: pickOf(row.doc, s.pick) }));
    },

    async count(c, col, values) {
      const spec = tableOf(c);
      const counts = new Map<string, number>();
      for (const row of all(c)) {
        const value = columnOf(c, col).value(row.doc, state, spec);
        if (value === null || !values.includes(String(value))) continue;
        counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      }
      return counts;
    },

    async countWhere(s) {
      const counts = new Map<string, number>();
      if (matchesNothing(s)) return counts;
      const spec = tableOf(s.c);
      for (const row of all(s.c)) {
        if (!s.where.every((cond) => holds(s.c, row.doc, row.key, cond))) continue;
        const value = columnOf(s.c, s.per).value(row.doc, state, spec);
        if (value === null) continue;
        counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
      }
      return counts;
    },

    async undoLinks(eventIds) {
      const links = new Map<string, string>();
      for (const id of eventIds) {
        const undo = undoneMap().get(id);
        if (undo) links.set(id, undo);
      }
      return links;
    },

    async referencing(c, path, id, except) {
      const found = all(c).find((row) => row.key !== except && valuesAt(row.doc, path).includes(id));
      return found ? [{ ord: found.ord, doc: structuredClone(found.doc) }] : [];
    },

    async threads(o) {
      const byTask = new Map<string, Rec[]>();
      for (const row of all('comments')) {
        if (row.doc.targetType !== 'task') continue;
        const id = String(row.doc.targetId);
        const list = byTask.get(id);
        if (list) list.push(row.doc);
        else byTask.set(id, [row.doc]);
      }
      const found: { id: string; last: string; mine: string | null }[] = [];
      for (const [id, comments] of byTask) {
        const task = state.tasks[id];
        if (!task) continue;
        const mine = comments.filter((comment) => o.me.includes(String(comment.authorId))).map((comment) => String(comment.createdAt));
        if (task.projectId === null) {
          const made = o.me.includes(task.createdBy);
          const sees = o.admin || task.ownerId === o.owner || (task.helperIds ?? []).includes(o.owner) || made;
          if (!sees || (task.ownerId !== o.owner && !made && mine.length === 0)) continue;
        } else {
          if (!state.projects[task.projectId]) continue;
          if (task.ownerId !== o.owner && !o.led.includes(task.projectId) && mine.length === 0) continue;
        }
        const last = comments.map((comment) => String(comment.createdAt)).reduce((a, b) => (b > a ? b : a));
        found.push({ id, last, mine: mine.length > 0 ? mine.reduce((a, b) => (b > a ? b : a)) : null });
      }
      found.sort((a, b) => before(b.last, a.last) || before(b.id, a.id));
      const cut = found[o.limit - 1]?.last;
      return cut === undefined ? found : found.filter((thread) => thread.last >= cut);
    },

    async counters() {
      return { ...state.counters };
    },
  };
}
