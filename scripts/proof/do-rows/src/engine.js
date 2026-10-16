// The loader reads on SQLite. This follows server/data/loaders/sqlSource.ts and build.ts: the same Select shape, the same
// conditions, limits and order. Lists go as one JSON value (json_each), because the object takes at most 100 bound values
// in one statement. A "per" read with a limit runs one statement for each key, on the index of that key (SQLite has no LATERAL).

import { isOffice, OFFICE_TABLES } from './schema.js';

/** Runs statements and adds up their counters. */
export class Meter {
  constructor(sql) {
    this.sql = sql;
    this.read = 0;
    this.written = 0;
    this.statements = 0;
    this.log = [];
    this.trace = false;
  }
  exec(text, ...args) {
    const cursor = this.sql.exec(text, ...args);
    const rows = cursor.toArray();
    this.read += cursor.rowsRead;
    this.written += cursor.rowsWritten;
    this.statements += 1;
    if (this.trace) {
      const entry = { text: text.slice(0, 160), rows: rows.length, read: cursor.rowsRead, written: cursor.rowsWritten };
      if (this.plans && cursor.rowsRead >= this.plans) entry.plan = this.sql.exec(`explain query plan ${text}`, ...args).toArray().map((p) => p.detail);
      this.log.push(entry);
    }
    return rows;
  }
  take() {
    const out = { rowsRead: this.read, rowsWritten: this.written, statements: this.statements, ...(this.trace ? { log: this.log } : {}) };
    this.read = 0;
    this.written = 0;
    this.statements = 0;
    this.log = [];
    return out;
  }
}

const TABLE = {
  users: 'users', teams: 'teams', settings: 'settings', clients: 'clients', stageTemplates: 'stage_templates', taskTemplates: 'task_templates',
  projectTemplates: 'project_templates', projects: 'projects', members: 'members', stages: 'stages', deadlines: 'deadlines', conversations: 'conversations',
  tasks: 'tasks', updates: 'updates', comments: 'comments', files: 'files', tracker: 'tracker', payments: 'payments', notifications: 'notifications',
  messages: 'messages', chatReads: 'chat_reads', events: 'events', feedback: 'feedback', pushDevices: 'push_devices',
};
export const OFFICE_COLLECTIONS = ['users', 'teams', 'settings', 'clients', 'stageTemplates', 'taskTemplates', 'projectTemplates', 'projects', 'members', 'stages', 'deadlines', 'conversations'];
const COLLECTION_OF = Object.fromEntries(Object.entries(TABLE).map(([c, t]) => [t, c]));
const keyOf = (c, doc) => (c === 'members' ? `${doc.projectId}:${doc.userId}` : c === 'chatReads' ? `${doc.conversationId}:${doc.userId}` : c === 'settings' ? 'office' : doc.id);
const field = (name) => {
  if (!/^[a-zA-Z]+$/.test(name)) throw new Error(`Not a doc field: ${name}`);
  return name;
};
/** A doc field as text, so true and false compare as 'true' and 'false' (doc->>'field' in Postgres). */
const textOf = (path) => `(case json_type(t.doc, '${path}') when 'true' then 'true' when 'false' then 'false' else json_extract(t.doc, '${path}') end)`;
const list = (values) => JSON.stringify([...values]);
const inList = (expr, values, args) => {
  args.push(list(values));
  return `${expr} in (select value from json_each(?))`;
};

/** The where clause of a Select: SQL text and its values. */
function whereOf(s, args, skip, o = {}) {
  function cond(one) {
    if ('or' in one) return `(${one.or.map(cond).join(' or ')})`;
    if ('notUndone' in one) return 'not exists (select 1 from events u where u.undoes = t.id)';
    if ('has' in one) {
      args.push(one.value);
      return `exists (select 1 from json_each(t.doc, '$.${field(one.has)}') h where h.value = ?)`;
    }
    if ('before' in one) {
      args.push(one.before.at, one.before.at, one.before.id);
      return '(t.created_at < ? or (t.created_at = ? and t.id < ?))';
    }
    if ('key' in one) return inList(textOf(`$.${field(one.field)}.${field(one.key)}`), one.in, args);
    if ('field' in one) {
      // With author columns, the author fields of messages and comments read their column (and its covering index).
      const column = o.authorCols && (s.c === 'messages' || s.c === 'comments') ? { authorId: 'author_id', actingForId: 'acting_for_id' }[one.field] : undefined;
      if (column && 'notIn' in one) {
        args.push(list(one.notIn));
        return `(t.${column} is null or t.${column} not in (select value from json_each(?)))`;
      }
      if (column && 'in' in one) return inList(`t.${column}`, one.in, args);
      const path = `$.${field(one.field)}`;
      if ('null' in one) return `(json_type(t.doc, '${path}') is null or json_type(t.doc, '${path}') = 'null')`;
      if ('notIn' in one) {
        args.push(list(one.notIn));
        return `(${textOf(path)} is null or ${textOf(path)} not in (select value from json_each(?)))`;
      }
      return inList(textOf(path), one.in, args);
    }
    const col = `t.${one.col}`;
    if ('in' in one) return inList(col, one.in, args);
    if ('notIn' in one) {
      args.push(list(one.notIn));
      return `(${col} is null or ${col} not in (select value from json_each(?)))`;
    }
    if ('eq' in one) {
      if (one.eq === null) return `${col} is null`;
      args.push(typeof one.eq === 'boolean' ? (one.eq ? 1 : 0) : one.eq);
      return `${col} = ?`;
    }
    if ('contains' in one) {
      args.push(one.contains);
      return `instr(${col}, ?) > 0`;
    }
    if ('atOrAfter' in one) {
      const bound = new Date(Date.parse(one.atOrAfter) - 36 * 3_600_000).toISOString().slice(0, 19);
      args.push(one.atOrAfter, bound);
      return `(unixepoch(${col}) >= unixepoch(?) and ${col} >= ?)`;
    }
    throw new Error(`Unknown condition ${JSON.stringify(one)}`);
  }
  const conds = s.where.filter((one) => one !== skip).map(cond);
  return conds.length > 0 ? conds.join(' and ') : '1';
}

const matchesNothing = (s) => s.where.some((one) => 'in' in one && one.in.length === 0);

export function sqliteSource(m, form, opt = {}) {
  const ord = form === 'norowid' ? 't.ord' : 't.rowid';
  const selectRows = (table, where, args, tail = '') => m.exec(`select ${ord} as ord, t.doc as doc from ${table} t where ${where} ${tail}`, ...args);
  const rowsOf = (rows) => rows.map((row) => ({ ord: Number(row.ord), doc: JSON.parse(row.doc) }));

  function orderOf(s) {
    const o = s.order;
    if (!o) return opt.jsSort && s.limit === undefined ? '' : 'order by ord';
    return `order by t.${o.col} desc${o.id ? ', t.id desc' : ''}${s.ties ? '' : `, ${ord} desc`}`;
  }

  function limited(table, s, where, args) {
    const order = orderOf(s);
    if (!s.ties || !s.order) return selectRows(table, where, args, `${order} limit ${Number(s.limit)}`);
    // With ties: every row whose order value is at or after the value of the last row of the limit.
    const col = `t.${s.order.col}`;
    return selectRows(table, `${where} and ${col} >= coalesce((select ${col} from ${table} t where ${where} ${order} limit 1 offset ${Number(s.limit) - 1}), '')`, [...args, ...args], order);
  }

  return {
    select(s) {
      if (matchesNothing(s)) return [];
      const table = TABLE[s.c];
      if (s.limit === undefined) {
        const args = [];
        return rowsOf(selectRows(table, whereOf(s, args, undefined, opt), args, opt.jsSort ? '' : 'order by ord')).sort((a, b) => a.ord - b.ord);
      }
      const perList = s.per ? s.where.find((one) => 'col' in one && one.col === s.per && 'in' in one) : undefined;
      if (perList) {
        const out = [];
        for (const key of new Set(perList.in)) {
          const args = [key];
          const where = `t.${s.per} = ? and ${whereOf(s, args, perList, opt)}`;
          out.push(...limited(table, s, where, args));
        }
        return rowsOf(out).sort((a, b) => a.ord - b.ord);
      }
      const args = [];
      return rowsOf(limited(table, s, whereOf(s, args, undefined, opt), args)).sort((a, b) => a.ord - b.ord);
    },
    count(c, column, values) {
      if (values.length === 0) return new Map();
      const rows = m.exec(`select ${column} as v, count(*) as n from ${TABLE[c]} where ${column} in (select value from json_each(?)) group by ${column}`, list(values));
      return new Map(rows.map((row) => [row.v, row.n]));
    },
    /** A count with a bounds condition on its "per" column: one count for each key, on the index of that key. */
    countWhere(s) {
      if (matchesNothing(s)) return new Map();
      const bounds = s.where.find((one) => 'bounds' in one);
      const out = new Map();
      for (const [k, b] of Object.entries(bounds.bounds.by)) {
        const args = [k, b.gt];
        let extra = '';
        if (b.ge) {
          extra += ' and t.created_at >= ?';
          args.push(b.ge);
        }
        if (b.after) {
          extra += ' and (t.created_at > ? or (t.created_at = ? and t.id > ?))';
          args.push(b.after.at, b.after.at, b.after.id);
        }
        const where = `t.${s.per} = ? and t.created_at > ?${extra} and ${whereOf(s, args, bounds, opt)}`;
        const [row] = m.exec(`select count(*) as n from ${TABLE[s.c]} t where ${where}`, ...args);
        if (row.n > 0) out.set(k, row.n);
      }
      return out;
    },
    undoLinks(eventIds) {
      if (eventIds.length === 0) return new Map();
      const rows = m.exec('select id, undoes from events where undoes in (select value from json_each(?))', list(eventIds));
      return new Map(rows.map((row) => [row.undoes, row.id]));
    },
    threads(o) {
      const author = opt.authorCols ? 'author_id' : "json_extract(doc, '$.authorId')";
      const cAuthor = opt.authorCols ? 'c.author_id' : "json_extract(c.doc, '$.authorId')";
      return m.exec(
        `with mine as (select distinct target_id from comments where target_type = 'task' and ${author} in (select value from json_each(?3))),
         cand as (select k.id from tasks k
           where (k.owner_id = ?1 or k.project_id in (select value from json_each(?2)) or k.id in (select target_id from mine)
               or (k.project_id is null and json_extract(k.doc, '$.createdBy') in (select value from json_each(?3))))
             and (k.project_id is not null or ?5 or k.owner_id = ?1 or exists (select 1 from json_each(k.doc, '$.helperIds') h where h.value = ?1)
               or json_extract(k.doc, '$.createdBy') in (select value from json_each(?3)))),
         threads as (
           select c.target_id as id, max(c.created_at) as last,
                  max(case when ${cAuthor} in (select value from json_each(?3)) then c.created_at end) as mine
           from comments c where c.target_type = 'task' and c.target_id in (select id from cand)
           group by c.target_id),
         ranked as (select id, last, mine, rank() over (order by last desc) as r from threads)
         select id, last, mine from ranked where r <= ?4 order by last desc, id desc`,
        o.owner, list(o.led), list(o.me), o.limit, o.admin ? 1 : 0,
      );
    },
    counters() {
      return Object.fromEntries(m.exec('select prefix, n from counters').map((row) => [row.prefix, row.n]));
    },
  };
}

/** The office lists from the tables (a cold start without the snapshot): every row of the 12 office tables. */
export function officeFromTables(m, form) {
  const ord = form === 'norowid' ? 'ord' : 'rowid';
  const lists = {};
  for (const c of OFFICE_COLLECTIONS) {
    const rows = m.exec(`select doc from ${TABLE[c]} order by ${ord}`).map((row) => JSON.parse(row.doc));
    lists[c] = c === 'settings' ? rows[0] : Object.fromEntries(rows.map((doc) => [keyOf(c, doc), doc]));
  }
  return lists;
}

/** The office lists from the snapshot rows. */
export function officeFromSnapshot(m) {
  const parts = m.exec('select body from office_snapshot order by part');
  return JSON.parse(parts.map((row) => row.body).join(''));
}

const SNAPSHOT_PART = 1_500_000;
/** Writes the snapshot of the office lists, in parts under the 2 MB row limit. Returns the parts and the bytes. */
export function writeSnapshot(m, lists, version) {
  const body = JSON.stringify(lists);
  const parts = [];
  for (let i = 0; i < body.length; i += SNAPSHOT_PART) parts.push(body.slice(i, i + SNAPSHOT_PART));
  m.exec('delete from office_snapshot where part >= ?', parts.length);
  parts.forEach((part, i) => m.exec('insert into office_snapshot (part, version, body) values (?, ?, ?) on conflict (part) do update set version = excluded.version, body = excluded.body', i, version, part));
  return { parts: parts.length, bytes: new TextEncoder().encode(body).length };
}

/** A port of server/data/loaders/build.ts (the Load class), with the same dedupe of rows that two reads bring. */
export class Load {
  constructor(src, office, actorId, write) {
    this.src = src;
    this.office = office;
    this.write = write;
    const actor = office.users[actorId];
    const owner = actor?.kind === 'agent' && actor.ownerId ? office.users[actor.ownerId] : undefined;
    this.authority = owner && owner.kind === 'human' && owner.active ? owner : actor;
    this.rows = new Map();
    this.countsOf = {};
  }
  get(c, key) {
    if (key === null || key === undefined) return undefined;
    if (OFFICE_COLLECTIONS.includes(c)) return this.office[c]?.[key];
    return this.rows.get(c)?.get(key)?.doc;
  }
  list(c) {
    return [...(this.rows.get(c)?.values() ?? [])].sort((a, b) => a.ord - b.ord).map((row) => row.doc);
  }
  add(c, rows) {
    let map = this.rows.get(c);
    if (!map) this.rows.set(c, (map = new Map()));
    return rows.map((row) => {
      const key = keyOf(c, row.doc);
      const known = map.get(key);
      if (known) return known.doc;
      map.set(key, row);
      return row.doc;
    });
  }
  select(s) {
    if (OFFICE_COLLECTIONS.includes(s.c)) throw new Error(`office list ${s.c}`);
    return this.add(s.c, this.src.select(s));
  }
  byKey(c, keys) {
    if (OFFICE_COLLECTIONS.includes(c)) return;
    const missing = [...new Set([...keys].filter((k) => typeof k === 'string' && k !== ''))].filter((k) => !this.get(c, k));
    if (missing.length > 0) this.select({ c, where: [{ col: 'id', in: missing }] });
  }
  counts(c, col, values, keyOf2) {
    const want = [...new Set(values)];
    const found = this.src.count(c, col, want);
    for (const v of want) this.countsOf[keyOf2(v)] = found.get(v) ?? 0;
  }
  countWhere(s, values, keyOf2) {
    const want = [...new Set(values)];
    if (want.length === 0) return;
    const found = this.src.countWhere(s);
    for (const v of want) this.countsOf[keyOf2(v)] = found.get(v) ?? 0;
  }
  /** What Load.state() reads beside the rows: the undo links of the loaded events, and the counters of a write. */
  finish() {
    const events = this.list('events');
    if (events.length > 0) this.src.undoLinks(events.map((e) => e.id));
    if (this.write) this.src.counters();
    const loaded = {};
    for (const [c, map] of this.rows) loaded[c] = map.size;
    return loaded;
  }
}

export { TABLE, COLLECTION_OF, keyOf, isOffice, OFFICE_TABLES };
