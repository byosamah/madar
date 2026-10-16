// The rows probe (wave 0, probe 1 of the Supabase exit). It runs only under "wrangler dev" on this Mac: a SQLite Durable Object
// that holds one year of office data, and routes that report the rows read and written of each Madar read and write.

import { DurableObject } from 'cloudflare:workers';
import { proof } from './proof.js';
import { matrix } from './matrix.js';
import { columnsOf, ddl, dropAll, ENTITY, ENTITY_TABLES, indexDdl, SERVER } from './schema.js';
import { Load, Meter, officeFromSnapshot, officeFromTables, sqliteSource, writeSnapshot } from './engine.js';
import * as calls from './calls.js';
import { runWrites } from './writes.js';
import {
  chatReadsAll, commentAt, COUNTS, eventAt, feedbackAt, fileAt, layout, messageAt, notificationAt, officeRows, paymentAt, pushAt, serverRows,
  taskRows, trackerAt, updateAt, useProfile,
} from './gen.js';

/** The big tables, made by record number. COUNTS follows the profile of the request. */
const byIndex = () => ({
  events: [COUNTS.events, eventAt], comments: [COUNTS.comments, commentAt], notifications: [COUNTS.notifications, notificationAt],
  messages: [COUNTS.messages, messageAt], files: [COUNTS.files, fileAt], tracker: [COUNTS.tracker, trackerAt], payments: [COUNTS.payments, paymentAt],
  updates: [COUNTS.updates, updateAt], feedback: [COUNTS.feedback, feedbackAt], push_devices: [COUNTS.push_devices, pushAt],
});

/** The rows of one table, from..to, as { id, doc, cols }. */
function rowsOf(table, from, to) {
  const L = layout();
  const BY_INDEX = byIndex();
  if (BY_INDEX[table]) {
    const [count, make] = BY_INDEX[table];
    const out = [];
    for (let i = from; i < Math.min(to, count); i++) out.push(make(L, i));
    return out;
  }
  if (table === 'tasks') return taskRows(L).slice(from, to);
  if (table === 'chat_reads') return chatReadsAll(L).slice(from, to);
  const office = officeRows(L);
  if (office[table]) return office[table].slice(from, to);
  throw new Error(`no table ${table}`);
}

export const TABLE_SIZES = () => {
  const L = layout();
  const office = officeRows(L);
  return {
    ...Object.fromEntries(Object.entries(office).map(([t, rows]) => [t, rows.length])),
    tasks: L.tasks.length, chat_reads: chatReadsAll(L).length,
    ...Object.fromEntries(Object.entries(byIndex()).map(([t, [n]]) => [t, n])),
  };
};

const ORD_BASE = Object.fromEntries(ENTITY_TABLES.map((t, i) => [t, i * 1_000_000]));

export class Office extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.warm = undefined;
  }

  meter() {
    return new Meter(this.ctx.storage.sql);
  }

  load(table, from, to, form) {
    const m = this.meter();
    const rows = rowsOf(table, from, to);
    this.ctx.storage.transactionSync(() => {
      if (ENTITY[table]) {
        const names = columnsOf(table, form);
        const text = `insert into ${table} (${names.join(', ')}) values (${names.map(() => '?').join(', ')})`;
        rows.forEach((row, i) => {
          const values = names.map((n) => (n === 'id' ? row.id : n === 'doc' ? JSON.stringify(row.doc) : n === 'ord' ? ORD_BASE[table] + from + i : n === 'chg' ? 1 : row.cols[n] ?? null));
          m.exec(text, ...values);
        });
      }
    });
    return { table, from, to, rows: rows.length, ...m.take() };
  }

  loadServer() {
    const m = this.meter();
    const out = {};
    this.ctx.storage.transactionSync(() => {
      for (const [table, rows] of Object.entries(serverRows())) {
        for (const row of rows) {
          const names = Object.keys(row);
          m.exec(`insert into ${table} (${names.join(', ')}) values (${names.map(() => '?').join(', ')})`, ...names.map((n) => row[n]));
        }
        out[table] = { rows: rows.length, ...m.take() };
      }
    });
    return out;
  }

  stats() {
    const sql = this.ctx.storage.sql;
    const tables = sql.exec("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' order by name").toArray();
    const counts = {};
    let total = 0;
    for (const { name } of tables) {
      const n = sql.exec(`select count(*) as n from "${name}"`).one().n;
      counts[name] = n;
      total += n;
    }
    const indexes = sql.exec("select count(*) as n from sqlite_master where type = 'index'").one().n;
    return { total, counts, indexes, databaseSize: sql.databaseSize };
  }

  /** The office lists in memory, read once from the tables. */
  office(form) {
    if (!this.warm) this.warm = officeFromTables(this.meter(), form);
    return this.warm;
  }

  /** Runs one loader as the given person and returns its rows read. */
  call(form, name, actorId, input, fn) {
    const m = this.meter();
    const L = new Load(sqliteSource(m, form, this.opt ?? {}), this.office(form), actorId, false);
    fn(L, input);
    const loaded = L.finish();
    const counted = m.take();
    return { name, actorId, input, rowsRead: counted.rowsRead, statements: counted.statements, loaded };
  }

  reads(form) {
    const office = this.office(form);
    const projects = Object.values(office.projects);
    const active = projects.filter((p) => p.status === 'active');
    const L0 = layout();
    // The biggest active project, its busiest task, its chat, and the busiest direct chat.
    const tasksOfProject = (id) => L0.tasks.filter((t) => t.projectId === id).length;
    const big = active.reduce((a, b) => (tasksOfProject(b.id) > tasksOfProject(a.id) ? b : a));
    const m = this.meter();
    const [busy] = m.exec("select target_id as id, count(*) as n from events where target_type = 'task' group by target_id order by n desc limit 1");
    const [chat] = m.exec('select conversation_id as id, count(*) as n from messages group by conversation_id order by n desc limit 1');
    const [thread] = m.exec("select target_id as id, count(*) as n from comments where target_type = 'task' group by target_id order by n desc limit 1");
    m.take();
    const people = { admin: 'usr_001', management: 'usr_002', leader: 'usr_005', member: 'usr_012', nonReader: 'usr_014' };
    const out = { picks: { project: big.id, projectTasks: tasksOfProject(big.id), busyTask: busy, busyChat: chat, busyThread: thread, activeProjects: active.length }, calls: [] };
    const add = (name, actorId, input, fn) => out.calls.push(this.call(form, name, actorId, input, fn));
    for (const [role, id] of Object.entries(people)) {
      add('session.get', id, {}, () => {});
      add('notifications.count', id, {}, calls.notificationsCount);
      add('chats.unreadCount', id, {}, calls.chatsUnread);
      add('tasks.list mine', id, { filter: 'mine' }, calls.tasksList);
      add('tasks.list review_for_me', id, { filter: 'review_for_me' }, calls.tasksList);
      add('projects.list (Home)', id, role === 'admin' ? { filter: 'all' } : { filter: 'mine', status: 'all' }, calls.projectsList);
      add('projects.list (Projects screen, active)', id, {}, calls.projectsList);
      if (role === 'admin' || role === 'management') add('dashboard.get', id, {}, calls.dashboardGet);
      add('events.list', id, {}, calls.eventsList);
      add('notifications.list', id, {}, calls.notificationsList);
      add('chats.list', id, {}, calls.chatsAll);
      add('search.query common word', id, { text: 'roof' }, calls.searchQuery);
      add('search.query no match', id, { text: 'zzqx' }, calls.searchQuery);
    }
    add('projects.get', 'usr_005', { id: big.id }, (L, i) => calls.projectCall(L, i.id));
    add('tasks.get (busiest task)', 'usr_001', { id: busy.id }, (L, i) => calls.taskScope(L, i.id));
    add('updates.list', 'usr_005', { projectId: big.id, limit: 50 }, calls.updatesList);
    add('files.list', 'usr_005', { projectId: big.id }, calls.filesList);
    add('chats.messages (busiest chat)', 'usr_001', { conversationId: chat.id, limit: 200 }, calls.chatsMessages);
    add('comments.list (busiest thread)', 'usr_001', { targetType: 'task', targetId: thread.id }, calls.commentsList);
    add('events.list since 1 hour (meeting)', 'usr_012', { since: '2026-10-16T14:00:00.000+03:00', limit: 500 }, calls.eventsList);
    // The 15-minute job: the trigger step's loader and its dedupe lookup, and the other steps' reads.
    out.jobs = this.jobs(form);
    return out;
  }

  jobs(form) {
    const m = this.meter();
    const L = new Load(sqliteSource(m, form), this.office(form), '', true);
    const tasks = calls.loadJobs(L);
    L.finish();
    const loader = m.take();
    // The dedupe lookup: one key for each open task with a due date (the due and overdue reminders of the day).
    const keys = tasks.filter((t) => t.dueDate).map((t) => `due:${t.id}:${t.ownerId}:2026-10-16`);
    m.exec('select dedupe_key from notifications where dedupe_key in (select value from json_each(?))', JSON.stringify(keys));
    const dedupe = m.take();
    m.exec("select id from outbox where done_at is null and attempts < 5 and created_at < '2026-10-16T14:58'");
    const outbox = m.take();
    for (const [table, col] of [['stories', 'created_at'], ['idempotency', 'created_at'], ['office_deletes', 'created_at']]) m.exec(`select count(*) from ${table} where ${col} < '2026-10-15'`);
    m.exec("select id from upload_intents where used_at is null and expires_at < '2026-10-16'");
    const cleanup = m.take();
    return { openTasks: tasks.length, loader, dedupe: { keys: keys.length, ...dedupe }, outbox, cleanup };
  }

  cold(form) {
    const m = this.meter();
    officeFromTables(m, form);
    const tables = m.take();
    const office = officeFromTables(this.meter(), form);
    const written = writeSnapshot(m, office, 5000);
    const write = m.take();
    officeFromSnapshot(m);
    const snapshot = m.take();
    return { fromTables: tables, snapshotWrite: { ...written, ...write }, fromSnapshot: snapshot };
  }

  exportAll() {
    const m = this.meter();
    const sql = this.ctx.storage.sql;
    const tables = sql.exec("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '_cf_%' order by name").toArray();
    const out = {};
    let rows = 0;
    let bytes = 0;
    for (const { name } of tables) {
      const got = m.exec(`select * from "${name}"`);
      rows += got.length;
      for (const row of got) bytes += JSON.stringify(row).length;
      out[name] = m.take().rowsRead;
    }
    const rowsRead = Object.values(out).reduce((a, b) => a + b, 0);
    return { rows, rowsRead, bytes, byTable: out };
  }

  async fetch(request) {
    const url = new URL(request.url);
    const q = Object.fromEntries(url.searchParams);
    const form = q.form ?? 'rowid';
    const sql = this.ctx.storage.sql;
    useProfile(q.profile ?? 'year');
    try {
      switch (url.pathname) {
        case '/proof': return Response.json(proof(sql));
        case '/matrix': return Response.json(matrix(sql));
        case '/reset': dropAll(sql); this.warm = undefined; return Response.json({ ok: true, databaseSize: sql.databaseSize });
        case '/schema': {
          const m = this.meter();
          for (const text of ddl(form, q.indexes !== '0')) m.exec(text);
          return Response.json({ ok: true, ...m.take() });
        }
        case '/indexes': {
          const m = this.meter();
          const out = {};
          for (const text of indexDdl()) {
            m.exec(text);
            out[text.split(' ')[5] ?? text] = m.take();
          }
          const total = Object.values(out).reduce((s, p) => ({ rowsRead: s.rowsRead + p.rowsRead, rowsWritten: s.rowsWritten + p.rowsWritten }), { rowsRead: 0, rowsWritten: 0 });
          return Response.json({ total, byIndex: out });
        }
        case '/sizes': return Response.json(TABLE_SIZES());
        case '/load': return Response.json(this.load(q.table, Number(q.from), Number(q.to), form));
        case '/load-server': return Response.json(this.loadServer());
        case '/stats': return Response.json(this.stats());
        case '/reads': {
          this.opt = { jsSort: q.jsSort === '1', authorCols: q.authorCols === '1' };
          const out = this.reads(form);
          out.options = this.opt;
          this.opt = undefined;
          return Response.json(out);
        }
        case '/analyze': {
          const m = this.meter();
          if (q.limit) m.exec(`pragma analysis_limit = ${Number(q.limit)}`);
          m.exec(q.optimize === '1' ? 'pragma optimize = 0x10002' : 'analyze');
          return Response.json({ step: 'analyze', ...m.take(), stat1: sql.exec('select count(*) as n from sqlite_stat1').one().n });
        }
        case '/authors': {
          // Author columns with covering indexes: messages (conversation_id, created_at, author_id, acting_for_id) and
          // comments (target_type, author_id, target_id). The update of the year's rows is local only.
          const m = this.meter();
          m.exec('alter table messages add column author_id text');
          m.exec('alter table messages add column acting_for_id text');
          m.exec("update messages set author_id = json_extract(doc, '$.authorId'), acting_for_id = json_extract(doc, '$.actingForId')");
          m.exec('alter table comments add column author_id text');
          m.exec("update comments set author_id = json_extract(doc, '$.authorId')");
          const fill = m.take();
          m.exec('create index messages_unread on messages (conversation_id, created_at, author_id, acting_for_id)');
          m.exec('create index comments_author on comments (target_type, author_id, target_id)');
          return Response.json({ step: 'authors', fill, indexes: m.take() });
        }
        case '/cold': return Response.json(this.cold(form));
        case '/trace': {
          // One call with the rows of each statement, and the plan of SQLite for one statement text when asked.
          const fns = {
            'chats.unreadCount': calls.chatsUnread, 'chats.list': calls.chatsAll, 'tasks.list': calls.tasksList, 'projects.list': calls.projectsList,
            'dashboard.get': calls.dashboardGet, 'events.list': calls.eventsList, 'notifications.list': calls.notificationsList,
            'notifications.count': calls.notificationsCount, 'search.query': calls.searchQuery,
          };
          const m = this.meter();
          m.trace = true;
          m.plans = Number(q.plans ?? 0);
          const L = new Load(sqliteSource(m, form, { jsSort: q.jsSort === '1', authorCols: q.authorCols === '1' }), this.office(form), q.actor, false);
          fns[q.name](L, JSON.parse(q.input ?? '{}'));
          L.finish();
          const t = m.take();
          const big = t.log.filter((s) => s.read >= Number(q.min ?? 100));
          return Response.json({ rowsRead: t.rowsRead, statements: t.statements, small: t.log.length - big.length, smallRead: t.rowsRead - big.reduce((s, x) => s + x.read, 0), big });
        }
        case '/plan': return Response.json(sql.exec(`explain query plan ${q.sql}`).toArray());
        case '/export': return Response.json(this.exportAll());
        case '/writes': {
          const office = this.office(form);
          const o = JSON.parse(q.w);
          // The newest open task of the project, with many events: the task that a typical write changes.
          o.taskId = sql.exec("select t.id from tasks t where t.project_id = ? and t.status != 'done' order by (select count(*) from events e where e.target_type = 'task' and e.target_id = t.id) desc limit 1", o.projectId).one().id;
          const out = { taskId: o.taskId, changedColumns: runWrites(this.ctx, this.meter(), form, office, o) };
          out.allColumns = runWrites(this.ctx, this.meter(), form, office, { ...o, allColumns: true });
          return Response.json(out);
        }
        default: return new Response('not found', { status: 404 });
      }
    } catch (error) {
      return Response.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const name = url.searchParams.get('o') ?? 'office';
    return env.OFFICE.get(env.OFFICE.idFromName(name)).fetch(request);
  },
};

export { SERVER };
