// The save step of typical writes, as SQLite statements, after the loader reads of the same call. The records each write saves
// come from the real handlers (writes-diff.mts ran them in memory): for example tasks.complete to review saves 1 task, 1 event,
// 1 notice and 2 counters. Beside the records, runCall writes a story, an idempotency key, the outbox rows of mail and push, the
// person and office signal numbers, and the usage row of the request. Each write runs in a transaction that it rolls back.

import { columnsOf, ENTITY } from './schema.js';
import { Load, sqliteSource } from './engine.js';
import { commentsCreate, chatsSend, notificationsCount, taskScope } from './calls.js';
import { NOW, stamp } from './gen.js';

const AT = stamp(NOW);
let uniq = 0;
const nextId = (prefix) => `${prefix}_w${Date.now().toString(36)}${(uniq++).toString(36)}`;

/** The column values of a record of one table, for an insert. */
function insertRow(m, form, table, id, doc, cols, ord) {
  const names = columnsOf(table, form);
  const values = names.map((name) => (name === 'id' ? id : name === 'doc' ? JSON.stringify(doc) : name === 'ord' ? ord : name === 'chg' ? 0 : cols[name] ?? null));
  m.exec(`insert into ${table} (${names.join(', ')}) values (${names.map(() => '?').join(', ')})`, ...values);
}

/** An update of a record: doc plus only the key columns that changed (all: every key column, as a simple save would). */
function updateRow(m, table, id, doc, changed, all = false) {
  const [cols] = ENTITY[table];
  const set = all ? Object.fromEntries(cols.map((c) => [c, changed[c] ?? null])) : changed;
  const names = Object.keys(set);
  m.exec(`update ${table} set doc = ?${names.map((n) => `, ${n} = ?`).join('')} where id = ?`, JSON.stringify(doc), ...names.map((n) => set[n]), id);
}

function eventRow(m, form, seq, verb, targetType, targetId, projectId, actorId, after) {
  const id = nextId('evt');
  const doc = { id, seq, verb, targetType, targetId, projectId, actorId, actingForId: actorId, actorKind: 'human', before: null, after, undoes: null, undoneBy: null, createdAt: AT, correlationId: 'sty_write' };
  insertRow(m, form, 'events', id, doc, { seq, project_id: projectId, target_type: targetType, target_id: targetId, correlation_id: 'sty_write', verb, undoes: null, created_at: AT }, seq);
}
function noticeRow(m, form, userId, targetType, targetId, trigger) {
  const id = nextId('ntf');
  const doc = { id, userId, trigger, targetType, targetId, actorId: 'usr_005', read: false, createdAt: AT, correlationId: 'sty_write', dedupeKey: null, text: 'x' };
  insertRow(m, form, 'notifications', id, doc, { user_id: userId, read: 0, created_at: AT, correlation_id: 'sty_write', target_type: targetType, target_id: targetId, dedupe_key: null }, 9e12);
}
function counters(m, prefixes) {
  for (const prefix of prefixes) m.exec('insert into counters (prefix, n) values (?, 1) on conflict (prefix) do update set n = n + 1', prefix);
}
/** What runCall writes beside the records. outbox: the mail and push rows. people: the person signal numbers. */
function runCallRows(m, { outbox = 0, people = [], office = true, key = true }) {
  m.exec('insert into stories (id, actor_id, created_at) values (?, ?, ?)', nextId('sty'), 'usr_005', AT);
  for (let i = 0; i < outbox; i++) m.exec('insert into outbox (id, kind, payload, created_at, done_at, attempts) values (?, ?, ?, ?, null, 0)', nextId('obx'), i === 0 ? 'push.notify' : 'mail.notice', '{"userIds":["usr_002"]}', AT);
  if (key) m.exec('insert into idempotency (actor_id, key, name, digest, result, created_at) values (?, ?, ?, ?, ?, ?)', 'usr_005', nextId('key'), 'x', 'd'.repeat(64), '{"output":{}}', AT);
  for (const userId of people) m.exec('insert into person_seq (user_id, seq) values (?, 1) on conflict (user_id) do update set seq = seq + 1', userId);
  if (office) m.exec('update office_meta set office_seq = office_seq + 1 where id = 1');
}
/** The usage row of the request (server/usage/meter.ts, once for each request). */
const usage = (m) => m.exec("insert into usage_month (month, calls, bytes_read, signals_failed) values ('2026-10', 1, 100, 0) on conflict (month) do update set calls = calls + 1, bytes_read = bytes_read + 100");
/** After the commit: each outbox row is claimed, then marked done; a mail adds one mail_log row. */
function afterCommit(m, mails) {
  const open = m.exec("select id from outbox where done_at is null and id like 'obx_w%'");
  for (const { id } of open) {
    m.exec("update outbox set claimed_until = ?, attempts = attempts + 1 where id = ? and done_at is null", AT, id);
    m.exec('update outbox set done_at = ?, error = null where id = ?', AT, id);
  }
  for (let i = 0; i < mails; i++) m.exec('insert into mail_log (id, ref, to_email, kind, resend_id, created_at) values (?, ?, ?, ?, ?, ?)', nextId('mlg'), 'r', 'a@b.test', 'notice', 're_x', AT);
}

/** Runs one write in a transaction that rolls back. Returns the rows read and written of each part. */
function rolledBack(ctx, m, parts) {
  const out = {};
  try {
    ctx.storage.transactionSync(() => {
      for (const [name, run] of parts) {
        run();
        out[name] = m.take();
      }
      throw new Error('rollback');
    });
  } catch (error) {
    if (error.message !== 'rollback') throw error;
  }
  out.total = Object.values(out).reduce((sum, p) => ({ rowsRead: sum.rowsRead + p.rowsRead, rowsWritten: sum.rowsWritten + p.rowsWritten }), { rowsRead: 0, rowsWritten: 0 });
  return out;
}

export function runWrites(ctx, m, form, office, o) {
  const src = sqliteSource(m, form);
  const all = o.allColumns === true;
  const results = {};
  const activeTask = o.taskId;
  const leader = office.projects[o.projectId].leaderId;

  results['tasks.complete (to review)'] = rolledBack(ctx, m, [
    ['load', () => {
      const L = new Load(src, office, 'usr_005', true);
      taskScope(L, activeTask);
      L.finish();
      results._task = L.get('tasks', activeTask);
    }],
    ['save', () => {
      const task = { ...results._task, status: 'in_review' };
      updateRow(m, 'tasks', task.id, task, all ? { project_id: task.projectId, owner_id: task.ownerId, status: 'in_review', due_date: task.dueDate, stage_id: task.stageId, search_text: task.title.toLowerCase() } : { status: 'in_review' }, all);
      eventRow(m, form, 9e8, 'task.status_changed', 'task', task.id, task.projectId, 'usr_005', { status: 'in_review' });
      noticeRow(m, form, leader, 'task', task.id, 'review');
      counters(m, ['evt', 'ntf']);
      runCallRows(m, { outbox: 2, people: [leader] });
    }],
    ['request', () => usage(m)],
    ['after', () => afterCommit(m, 1)],
  ]);

  results['tasks.update (title and due date, with reason)'] = rolledBack(ctx, m, [
    ['load', () => {
      const L = new Load(src, office, 'usr_005', true);
      taskScope(L, activeTask);
      L.finish();
      results._task = L.get('tasks', activeTask);
    }],
    ['save', () => {
      const task = { ...results._task, title: `${results._task.title} v2`, dueDate: '2026-10-30' };
      updateRow(m, 'tasks', task.id, task, all ? { project_id: task.projectId, owner_id: task.ownerId, status: task.status, due_date: task.dueDate, stage_id: task.stageId, search_text: task.title.toLowerCase() } : { due_date: task.dueDate, search_text: task.title.toLowerCase() }, all);
      const cid = nextId('cmt');
      insertRow(m, form, 'comments', cid, { id: cid, targetType: 'task', targetId: task.id, authorId: 'usr_005', body: 'Date moved: the client asked', createdAt: AT }, { target_type: 'task', target_id: task.id, created_at: AT, project_id: task.projectId }, 9e12);
      eventRow(m, form, 9e8, 'task.updated', 'task', task.id, task.projectId, 'usr_005', { title: task.title });
      eventRow(m, form, 9e8 + 1, 'comment.created', 'comment', cid, task.projectId, 'usr_005', {});
      counters(m, ['evt', 'cmt']);
      runCallRows(m, { outbox: 0, people: [] });
    }],
    ['request', () => usage(m)],
  ]);

  results['comments.create (with a mention)'] = rolledBack(ctx, m, [
    ['load', () => {
      const L = new Load(src, office, 'usr_005', true);
      commentsCreate(L, { targetType: 'task', targetId: activeTask, fileIds: [] });
      L.finish();
    }],
    ['save', () => {
      const cid = nextId('cmt');
      insertRow(m, form, 'comments', cid, { id: cid, targetType: 'task', targetId: activeTask, authorId: 'usr_005', body: 'Please check @[Leader]', createdAt: AT }, { target_type: 'task', target_id: activeTask, created_at: AT, project_id: o.projectId }, 9e12);
      eventRow(m, form, 9e8, 'comment.created', 'comment', cid, o.projectId, 'usr_005', {});
      noticeRow(m, form, leader, 'task', activeTask, 'mention');
      counters(m, ['evt', 'cmt', 'ntf']);
      runCallRows(m, { outbox: 2, people: [leader] });
    }],
    ['request', () => usage(m)],
    ['after', () => afterCommit(m, 1)],
  ]);

  results['chats.send'] = rolledBack(ctx, m, [
    ['load', () => {
      const L = new Load(src, office, 'usr_005', true);
      chatsSend(L, { conversationId: o.conversationId, fileIds: [] });
      L.finish();
    }],
    ['save', () => {
      const id = nextId('msg');
      insertRow(m, form, 'messages', id, { id, conversationId: o.conversationId, authorId: 'usr_005', actingForId: 'usr_005', body: 'Site visit at 10', createdAt: AT }, { conversation_id: o.conversationId, created_at: AT }, 9e12);
      const key = `${o.conversationId}:usr_005`;
      const names = columnsOf('chat_reads', form);
      const doc = JSON.stringify({ conversationId: o.conversationId, userId: 'usr_005', lastReadAt: AT });
      const values = names.map((n) => (n === 'id' ? key : n === 'doc' ? doc : n === 'ord' ? 9e12 : n === 'conversation_id' ? o.conversationId : 'usr_005'));
      m.exec(`insert into chat_reads (${names.join(', ')}) values (${names.map(() => '?').join(', ')}) on conflict (id) do update set doc = excluded.doc`, ...values);
      counters(m, ['msg']);
      runCallRows(m, { outbox: 1, people: ['usr_005'] });
    }],
    ['request', () => usage(m)],
    ['after', () => afterCommit(m, 0)],
  ]);

  results['projects.update (an office record)'] = rolledBack(ctx, m, [
    ['save', () => {
      const project = { ...office.projects[o.projectId], name: 'New name' };
      m.exec('update projects set doc = ?, search_text = ?, chg = 5001 where id = ?', JSON.stringify(project), 'new name', project.id);
      m.exec('update office_meta set version = version + 1, office_seq = office_seq + 1 where id = 1');
      eventRow(m, form, 9e8, 'project.updated', 'project', project.id, project.id, 'usr_001', { name: 'New name' });
      counters(m, ['evt']);
      runCallRows(m, { outbox: 0, people: [], office: false });
    }],
    ['snapshot', () => {
      const body = JSON.stringify(office);
      for (let i = 0, part = 0; i < body.length; i += 1_500_000, part++) m.exec('update office_snapshot set version = version + 1, body = ? where part = ?', body.slice(i, i + 1_500_000), part);
    }],
    ['request', () => usage(m)],
  ]);

  for (const userId of o.markAllReadUsers) {
    results[`notifications.markAllRead (${userId})`] = rolledBack(ctx, m, [
      ['load', () => {
        const L = new Load(src, office, userId, true);
        notificationsCount(L, {});
        L.finish();
        results._unread = L.list('notifications').filter((n) => !n.read).map((n) => n.id);
      }],
      ['save', () => {
        for (const id of results._unread) m.exec("update notifications set doc = json_set(doc, '$.read', json('true')), read = 1 where id = ?", id);
      }],
      ['request', () => usage(m)],
    ]);
    results[`notifications.markAllRead (${userId})`].unread = results._unread.length;
  }
  delete results._task;
  delete results._unread;
  return results;
}
