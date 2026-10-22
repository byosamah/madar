import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEED_VERBS } from '../../src/api/views';
import type { Query } from '../core/ports';
import type { Select } from '../data/loaders/query';
import { countSql, selectSql, sqlSource } from '../data/loaders/sqlSource';
import { grantServerRole } from '../test/global-setup';
import { applyMigrations, dropSchema, localClient } from './migrate';

/**
 * The read indexes of the performance audit (2026-10-07, migration 20261007000100_read_indexes.sql). This suite writes a few
 * months of growth data into its own schema (about 12,000 events, 2% of them changes of office tasks), and asks Postgres for the
 * plan of each loader read, as madar_server under RLS. A plan that stops using its index fails here; the rows of each read stay
 * the rows of the memory form (server/it/loaders.it.test.ts). It needs the local stack and the Docker lock.
 */

type Node = { 'Node Type': string; 'Index Name'?: string; 'Relation Name'?: string; 'Scan Direction'?: string; Plans?: Node[] };
type Statement = { text: string; values: unknown[] };

/** Every node of a plan, the root first. */
function nodesOf(node: Node): Node[] {
  return [node, ...(node.Plans ?? []).flatMap(nodesOf)];
}

/** Growth data: 50 projects of 20 tasks, 20 office tasks, 9 changes of each task, 2,000 feed events, comments, posts, messages. */
const GROWTH = `
create function pid(prefix text, n bigint) returns text language sql immutable as $$ select prefix || '_' || lpad(n::text, greatest(3, length(n::text)), '0') $$;
create function stamp(ts timestamptz) returns text language sql immutable as $$ select to_char(ts at time zone 'Asia/Riyadh', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+03:00' $$;
create function hum(i bigint) returns text language sql immutable as $$ select 'usr_' || lpad(((i % 15) + 1)::text, 3, '0') $$;
insert into projects (id, doc, search_text)
select pid('prj', n), jsonb_build_object('id', pid('prj', n), 'code', 'KH-26-' || n, 'name', 'Project ' || n,
  'status', case when n % 10 < 4 then 'active' else 'completed' end, 'leaderId', hum(n)), 'p'
from generate_series(1, 50) n;
insert into tasks (id, doc, search_text)
select pid('tsk', (n - 1) * 20 + k), jsonb_build_object('id', pid('tsk', (n - 1) * 20 + k), 'title', 'Task ' || k, 'status', 'todo',
  'ownerId', hum(n * 7 + k), 'createdBy', hum(n), 'projectId', pid('prj', n), 'helperIds', '[]'::jsonb,
  'createdAt', stamp(timestamptz '2026-06-01 09:00+03' + ((n + k) || ' hours')::interval)), 't'
from generate_series(1, 50) n, generate_series(1, 20) k;
insert into tasks (id, doc, search_text)
select pid('tsk', 2000 + i), jsonb_build_object('id', pid('tsk', 2000 + i), 'title', 'Office errand ' || i, 'status', 'todo', 'ownerId', hum(i + 3),
  'createdBy', hum(i), 'projectId', null, 'helperIds', '[]'::jsonb, 'createdAt', stamp(timestamptz '2026-06-01 09:00+03' + (i || ' days')::interval)), 't'
from generate_series(1, 20) i;
insert into events (id, doc)
select pid('evt', s), jsonb_build_object('id', pid('evt', s), 'seq', s, 'verb', verb, 'after', jsonb_build_object('status', 'in_progress'), 'before', null,
  'actorId', hum(j), 'actingForId', hum(j), 'actorKind', 'human', 'targetType', 'task', 'targetId', tid, 'projectId', pj, 'undoneBy', null,
  'createdAt', stamp(at), 'correlationId', 'sty_' || tid || '_' || j)
  || case when pj is null then jsonb_build_object('officeTaskId', tid) else '{}'::jsonb end
from (select row_number() over (order by at, tid, j) as s, * from (
  select t.id tid, t.project_id pj, j, (t.doc->>'createdAt')::timestamptz + (j * 26 || ' hours')::interval as at,
    case when j = 0 then 'task.created' when j in (4, 7) then 'task.status_changed' else 'task.updated' end as verb
  from tasks t, generate_series(0, 8) j) a) e;
insert into events (id, doc)
select pid('evt', s), jsonb_build_object('id', pid('evt', s), 'seq', s, 'verb', 'file.added', 'after', null, 'before', null, 'actorId', hum(n + k),
  'actingForId', hum(n + k), 'actorKind', 'human', 'targetType', 'project', 'targetId', pid('prj', n), 'projectId', pid('prj', n), 'undoneBy', null,
  'createdAt', stamp(timestamptz '2026-09-20 10:00+03' + (k * 3600 + n || ' seconds')::interval), 'correlationId', 'sty_p' || n || '_' || k)
from (select n, k, (select max(seq) from events) + row_number() over (order by k, n) as s from generate_series(1, 50) n, generate_series(1, 40) k) x;
insert into updates (id, doc)
select pid('upd', i), jsonb_build_object('id', pid('upd', i), 'projectId', pid('prj', 1 + i % 50), 'authorId', hum(i), 'body', 'Notes ' || i,
  'fileIds', '[]'::jsonb, 'createdAt', stamp(timestamptz '2026-06-01 09:00+03' + ((i * 41) % 150000 || ' minutes')::interval))
from generate_series(1, 500) i;
insert into comments (id, doc, project_id)
select pid('cmt', i), jsonb_build_object('id', pid('cmt', i), 'body', 'Check item ' || i, 'authorId', hum(i * 7), 'targetType', 'task',
  'targetId', pid('tsk', 1 + (i * 7919) % 1000), 'createdAt', stamp(timestamptz '2026-06-01 09:00+03' + ((i * 37) % 150000 || ' minutes')::interval)), null
from generate_series(1, 20000) i;
insert into messages (id, doc)
select pid('msg', i), jsonb_build_object('id', pid('msg', i), 'body', 'Message ' || i, 'authorId', hum(i * 11), 'actingForId', hum(i * 11),
  'mentions', '[]'::jsonb, 'fileIds', '[]'::jsonb, 'conversationId', pid('cnv', 1 + i % 75),
  'createdAt', stamp(timestamptz '2026-06-01 09:00+03' + ((i * 35) % 150000 || ' minutes')::interval))
from generate_series(1, 15000) i;
-- The notices of the Inbox: 2,000 for each of 15 people, one in ten unread (performance audit DB-9, perf2).
insert into notifications (id, doc)
select pid('ntf', i), jsonb_build_object('id', pid('ntf', i), 'userId', hum(i), 'read', (i % 10) <> 0, 'trigger', 'task_assigned', 'targetType', 'task',
  'targetId', pid('tsk', 1 + i % 1000), 'createdAt', stamp(timestamptz '2026-01-01 09:00+03' + ((i * 17) % 400000 || ' minutes')::interval), 'correlationId', 'sty_n' || i)
from generate_series(1, 30000) i;
-- The report verbs of the Reports screen, a few in every hundred events (performance audit DB-10, perf2).
insert into events (id, doc)
select pid('evt', 100000 + i), jsonb_build_object('id', pid('evt', 100000 + i), 'seq', 100000 + i,
  'verb', (array['project.stage_changed', 'project.status_changed', 'project.paused', 'task.approved', 'task.sent_back'])[1 + i % 5],
  'after', jsonb_build_object('status', 'completed'), 'before', null, 'actorId', hum(i), 'actingForId', hum(i), 'actorKind', 'human',
  'targetType', 'project', 'targetId', pid('prj', 1 + i % 50), 'projectId', pid('prj', 1 + i % 50), 'undoneBy', null,
  'createdAt', stamp(timestamptz '2026-01-01 10:00+03' + (i * 5 || ' hours')::interval), 'correlationId', 'sty_r' || i)
from generate_series(1, 1200) i;
analyze;
`;

describe('the read indexes on growth data', () => {
  const schema = `madar_idx_${process.pid}`;
  let db: pg.Client;
  let granted = false;

  beforeAll(async () => {
    db = await localClient();
    await applyMigrations(db, schema);
    await db.query(`set search_path to ${schema}`);
    await db.query(GROWTH);
    granted = await grantServerRole(db);
  }, 120_000);

  afterAll(async () => {
    if (!db) return;
    if (granted) await db.query('revoke madar_server from current_user');
    await dropSchema(db, schema);
    await db.end();
  });

  /** The plan of one statement as madar_server, as the server runs it. */
  async function planOf(s: Statement): Promise<Node[]> {
    await db.query('begin');
    try {
      await db.query('set local role madar_server');
      const { rows } = await db.query(`explain (format json) ${s.text}`, s.values);
      return nodesOf((rows[0]['QUERY PLAN'] as { Plan: Node }[])[0].Plan);
    } finally {
      await db.query('rollback');
    }
  }

  /** The statements that one read of the source sends, without their rows. */
  async function statementsOf(read: (source: ReturnType<typeof sqlSource>) => Promise<unknown>): Promise<Statement[]> {
    const sent: Statement[] = [];
    const q: Query = async <R,>(text: string, values: unknown[] = []) => {
      sent.push({ text, values });
      return [] as R[];
    };
    await read(sqlSource(q));
    return sent;
  }

  const uses = (nodes: Node[], index: string) => nodes.some((n) => n['Index Name'] === index);
  const scans = (nodes: Node[], table: string) => nodes.some((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === table);

  /** events.list of a person who is not the Admin: the events that are not changes of office tasks, or of the ones they see. */
  const memberEvents = (more: Select['where'] = [], limit = 50): Select => ({
    c: 'events',
    where: [{ col: 'target_type', notIn: ['payment', 'feedback'] }, ...more, { or: [{ field: 'officeTaskId', null: true }, { field: 'officeTaskId', in: ['tsk_2001', 'tsk_2016'] }] }],
    order: { col: 'seq', desc: true }, limit,
  });

  it('holds the statistics object and the indexes of the migration', async () => {
    const { rows: stats } = await db.query('select stxname from pg_statistic_ext where stxnamespace = $1::regnamespace', [schema]);
    expect(stats.map((row) => row.stxname)).toContain('events_office_task');
    const { rows: indexes } = await db.query('select indexname from pg_indexes where schemaname = $1', [schema]);
    expect(indexes.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      'events_created_c', 'events_project_created', 'messages_conversation_newest', 'comments_target_id', 'events_target_id',
      'comments_author_task', 'notifications_inbox_c', 'events_report_verbs',
    ]));
  });

  it('DB-1: reads the newest events of a member backward on events_seq, with no scan of every event and no big sort', async () => {
    const nodes = await planOf(selectSql(memberEvents()));
    expect(nodes.some((n) => n['Index Name'] === 'events_seq' && n['Scan Direction'] === 'Backward')).toBe(true);
    expect(scans(nodes, 'events')).toBe(false);
    // The one sort is the last "order by ord" of the 50 rows that the read keeps.
    expect(nodes.slice(1).filter((n) => n['Node Type'] === 'Sort')).toEqual([]);
  });

  it('DB-1: finds the events after a meeting start through the text index on created_at', async () => {
    const nodes = await planOf(selectSql(memberEvents([{ col: 'created_at', atOrAfter: '2027-01-01T09:00:00+03:00' }], 500)));
    expect(uses(nodes, 'events_created_c')).toBe(true);
    expect(scans(nodes, 'events')).toBe(false);
  });

  it('DB-2: reads the newest feed events of each project and the newest message of each chat on their indexes', async () => {
    const projects = Array.from({ length: 20 }, (_, i) => `prj_${String(i + 1).padStart(3, '0')}`);
    const feed = await planOf(selectSql({
      c: 'events', where: [{ col: 'project_id', in: projects }, { col: 'verb', in: [...FEED_VERBS] }, { notUndone: true }],
      order: { col: 'created_at', desc: true }, per: 'project_id', limit: 2, ties: true,
    }));
    expect(uses(feed, 'events_project_created')).toBe(true);
    const chats = Array.from({ length: 100 }, (_, i) => `cnv_${String(i + 1).padStart(3, '0')}`);
    const newest = await planOf(selectSql({
      c: 'messages', where: [{ col: 'conversation_id', in: chats }], order: { col: 'created_at', desc: true, id: true }, per: 'conversation_id', limit: 1,
    }));
    expect(uses(newest, 'messages_conversation_newest')).toBe(true);
    expect(scans(newest, 'messages')).toBe(false);
  });

  it('DB-3: counts the comments of a task and finds the delete events of gone targets by target_id alone', async () => {
    const [count] = await statementsOf((s) => s.count('comments', 'target_id', ['tsk_005']));
    expect(uses(await planOf(count), 'comments_target_id')).toBe(true);
    const gone = await planOf(selectSql({
      c: 'events', where: [{ col: 'target_id', in: ['tsk_9001', 'tsk_005'] }, { col: 'verb', in: ['task.deleted', 'update.deleted', 'project.deleted'] }],
    }));
    expect(uses(gone, 'events_target_id')).toBe(true);
  });

  it('DB-M3: finds a comment that still names a task on an index of target_id, with no scan of every comment', async () => {
    const [lookup] = await statementsOf((s) => s.referencing('comments', 'targetId', 'tsk_9999', null));
    const nodes = await planOf(lookup);
    expect(nodes.some((n) => n['Index Name'] === 'comments_target_id' || n['Index Name'] === 'comments_target')).toBe(true);
    expect(scans(nodes, 'comments')).toBe(false);
  });

  it('DB-5 (perf2): counts the unread messages of each chat with one index read for each key, never a scan of every message', async () => {
    const chats = Array.from({ length: 40 }, (_, i) => `cnv_${String(i + 1).padStart(3, '0')}`);
    const by = Object.fromEntries(chats.map((id) => [id, { gt: '2026-06-02T00:00:00' }]));
    const count = countSql({
      c: 'messages', per: 'conversation_id',
      where: [{ bounds: { col: 'conversation_id', by } }, { field: 'deletedAt', null: true }, { field: 'authorId', notIn: ['usr_005'] }, { field: 'actingForId', notIn: ['usr_005'] }],
    });
    const nodes = await planOf(count);
    expect(scans(nodes, 'messages')).toBe(false);
    expect(nodes.some((n) => n['Index Name'] === 'messages_conversation_newest')).toBe(true);
  });

  it('DB-6 (perf2): finds the comments of the person in the thread statement on comments_author_task, with no scan of every comment', async () => {
    const [threads] = await statementsOf((s) => s.threads({ owner: 'usr_005', led: ['prj_005'], me: ['usr_005'], limit: 100, admin: false, seen: ['prj_005'] }));
    const nodes = await planOf(threads);
    expect(uses(nodes, 'comments_author_task')).toBe(true);
  });

  it('DB-9 (perf2): reads the newest 100 read notices of a person on notifications_inbox_c, with no sort of every notice', async () => {
    const list = selectSql({
      c: 'notifications', where: [{ col: 'user_id', in: ['usr_005'] }, { col: 'read', eq: true }], order: { col: 'created_at', desc: true, id: true }, limit: 100,
    });
    const nodes = await planOf(list);
    expect(uses(nodes, 'notifications_inbox_c')).toBe(true);
    expect(scans(nodes, 'notifications')).toBe(false);
    // The one sort left is the last "order by ord" of the 100 rows that the read keeps.
    expect(nodes.slice(1).filter((n) => n['Node Type'] === 'Sort')).toEqual([]);
    const unread = await planOf(selectSql({ c: 'notifications', where: [{ col: 'user_id', in: ['usr_005'] }, { col: 'read', eq: false }] }));
    expect(uses(unread, 'notifications_inbox_c')).toBe(true);
  });

  it('DB-10 (perf2): counts the report verbs of a year on the partial index events_report_verbs', async () => {
    const year = [{ col: 'created_at', atOrAfter: '2026-01-01T00:00:00+03:00' }, { col: 'created_at', atBefore: '2027-01-01T00:00:00+03:00' }] as const;
    const stage = await planOf(countSql({ c: 'events', per: 'verb', where: [{ col: 'verb', in: ['project.stage_changed'] }, ...year] }));
    expect(uses(stage, 'events_report_verbs')).toBe(true);
    const reviews = await planOf(selectSql({ c: 'events', where: [{ col: 'verb', in: ['task.approved', 'task.sent_back'] }, ...year], pick: ['id', 'verb'] }));
    expect(uses(reviews, 'events_report_verbs')).toBe(true);
    expect(scans(reviews, 'events')).toBe(false);
  });
});
