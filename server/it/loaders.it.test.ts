import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { FEED_VERBS } from '../../src/api/views';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import { runBoth } from '../data/loaders/compare';
import { memorySource } from '../data/loaders/memorySource';
import { columnOfField, type CountSelect, type Select } from '../data/loaders/query';
import type { Source } from '../data/loaders/source';
import { countSql, selectSql, sqlSource } from '../data/loaders/sqlSource';
import { badgeTraps, readSweep, TIE_PROJECT, trapOffice, writeSweep } from '../data/loaders/sweep';
import { diffState, writeDiff } from '../data/save';
import { tableOf, type TableCollection } from '../data/tables';
import { REFERENCE_FIELDS } from '../../src/api/references';
import { writeState } from '../data/whole';
import { applyMigrations, dropSchema, localClient } from './migrate';

/**
 * The loaders on the local database (task C2). The SQL form of every read must return the rows that the memory form returns,
 * which the loader tests use (server/data/loaders/loaders.test.ts). This suite writes the sample office with a few extra records
 * (an undo pair, a thread with a read mark, messages with the same stamp, a decision, a helper, a direct message with a file),
 * then:
 *  1. records every read that the loaders make while the sweep runs on the memory form, and runs each read on both forms;
 *  2. runs the whole sweep with the SQL form, against the whole office in memory.
 * It needs the local stack and the Docker lock, and talks only to 127.0.0.1.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');

type Request = { method: keyof Source; args: unknown[] };

/** A source that writes down every read it answers. */
function recording(inner: Source, log: Request[]): Source {
  const wrap = <K extends keyof Source>(method: K) => (async (...args: unknown[]) => {
    log.push({ method, args: structuredClone(args) });
    return (inner[method] as (...a: unknown[]) => Promise<unknown>)(...args);
  }) as Source[K];
  return {
    select: wrap('select'), count: wrap('count'), countWhere: wrap('countWhere'), undoLinks: wrap('undoLinks'), referencing: wrap('referencing'),
    threads: wrap('threads'), counters: wrap('counters'),
  };
}

/** The answer of one read, comparable across the two forms: docs in order (an event keeps undoneBy null in the database). */
function comparable(method: keyof Source, answer: unknown): unknown {
  if (method === 'select' || method === 'referencing') {
    return (answer as { doc: Record<string, unknown> }[]).map((row) => ('undoneBy' in row.doc ? { ...row.doc, undoneBy: null } : row.doc));
  }
  if (answer instanceof Map) return Object.fromEntries([...answer.entries()].sort());
  return answer;
}

describe('the loaders on the local database', () => {
  const schema = `madar_c2_${process.pid}`;
  let db: pg.Client;
  let office: State;
  const q: Query = async <R,>(text: string, values?: unknown[]) => (await db.query(text, values)).rows as R[];

  beforeAll(async () => {
    db = await localClient();
    await applyMigrations(db, schema);
    await db.query(`set search_path to ${schema}`);
    office = trapOffice(await buildSeed(TODAY, async () => undefined));
    await db.query('begin');
    await writeState(q, office);
    await db.query('commit');
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await dropSchema(db, schema);
    await db.end();
  });

  it('answers every read of the loaders with the rows of the memory form', async () => {
    const log: Request[] = [];
    const source = recording(memorySource(office), log);
    for (const [name, input, actor, prepared] of [...readSweep(office), ...writeSweep(office)]) {
      await runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_it', prepared, source });
    }
    const unique = [...new Map(log.map((request) => [JSON.stringify(request), request])).values()];
    expect(unique.length).toBeGreaterThan(300);
    expect(new Set(unique.map((request) => request.method))).toEqual(new Set(['select', 'count', 'countWhere', 'undoLinks', 'referencing', 'threads', 'counters']));
    const sql = sqlSource(q);
    const memory = memorySource(office);
    for (const request of unique) {
      const call = (s: Source) => (s[request.method] as (...a: unknown[]) => Promise<unknown>)(...structuredClone(request.args));
      expect(comparable(request.method, await call(sql)), JSON.stringify(request)).toEqual(comparable(request.method, await call(memory)));
    }
  }, 120_000);

  it('gives every call of the sweep the same answer from the database as the whole office', async () => {
    const source = sqlSource(q);
    for (const [name, input, actor, prepared] of [...readSweep(office), ...writeSweep(office)]) {
      const { whole, scoped } = await runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_it', prepared, source });
      expect(scoped, `${name} ${JSON.stringify(input)} as ${actor}`).toEqual(whole);
    }
  }, 120_000);

  it('counts the unread rows as the memory form does: a tie at the own last comment, the authors left out, and a key with no row', async () => {
    const thread = Object.values(office.comments).find((c) => c.id === 'cmt_903')!.targetId;
    const stamp = '2026-10-03T11:00:00.000+03:00';
    const counts = [
      { c: 'comments', per: 'target_id', where: [
        { col: 'target_type', eq: 'task' },
        { bounds: { col: 'target_id', by: { [thread]: { gt: '', after: { at: stamp, id: 'cmt_903' } }, tsk_none: { gt: '' } } } },
      ] },
      { c: 'comments', per: 'target_id', where: [
        { col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by: { [thread]: { gt: '2026-10-01T10:00:00.000+03:00' } } } },
        { field: 'authorId', notIn: ['usr_006'] },
      ] },
      { c: 'messages', per: 'conversation_id', where: [
        { bounds: { col: 'conversation_id', by: { cnv_001: { gt: '' }, cnv_013: { gt: stamp } } } }, { field: 'actingForId', notIn: ['usr_001'] },
      ] },
    ] as const;
    const sql = sqlSource(q);
    const memory = memorySource(office);
    for (const s of counts) {
      const fromSql = comparable('countWhere', await sql.countWhere(s));
      expect(fromSql, JSON.stringify(s)).toEqual(comparable('countWhere', await memory.countWhere(s)));
      expect(Object.keys(fromSql as object).length).toBeGreaterThan(0);
    }
    expect((await sql.countWhere(counts[0])).get(thread)).toBe(1);
  });

  it('reads the newest rows of each key as the memory form does: a tie at the cut, a repeated key, two newest of one stamp (DB-2)', async () => {
    const room = Object.values(office.conversations).find((c) => c.kind === 'project' && c.projectId === TIE_PROJECT)!.id;
    const feed = (projects: string[]): Select => ({
      c: 'events', where: [{ col: 'project_id', in: projects }, { col: 'verb', in: [...FEED_VERBS] }, { notUndone: true }],
      order: { col: 'created_at', desc: true }, per: 'project_id', limit: 2, ties: true,
    });
    const newest = (chats: string[]): Select => ({
      c: 'messages', where: [{ col: 'conversation_id', in: chats }], order: { col: 'created_at', desc: true, id: true }, per: 'conversation_id', limit: 1,
    });
    const reads: Select[] = [
      feed([TIE_PROJECT]),
      feed([TIE_PROJECT, 'prj_001', TIE_PROJECT]),
      { ...feed(Object.keys(office.projects)), limit: 1 },
      { c: 'updates', where: [{ col: 'project_id', in: Object.keys(office.projects) }], order: { col: 'created_at', desc: true }, per: 'project_id', limit: 1, ties: true },
      newest([room, 'cnv_001', room]),
      newest(Object.keys(office.conversations)),
      { c: 'comments', where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: [...new Set(Object.values(office.comments).map((c) => c.targetId))] }], order: { col: 'created_at', desc: true, id: true }, per: 'target_id', limit: 1 },
      { c: 'tasks', where: [{ col: 'project_id', in: ['prj_001', 'prj_004'] }], order: { col: 'status', desc: true, id: true }, per: 'project_id', limit: 2, pick: ['id', 'dueDate'] },
    ];
    const sql = sqlSource(q);
    const memory = memorySource(office);
    for (const s of reads) {
      expect(selectSql(s).text, JSON.stringify(s)).toContain('cross join lateral');
      expect(comparable('select', await sql.select(s)), JSON.stringify(s)).toEqual(comparable('select', await memory.select(s)));
    }
    // The ties are real: the feed of 2 keeps 3 events, and the newest message is the one with the later id.
    expect(await sql.select(feed([TIE_PROJECT]))).toHaveLength(3);
    expect((await sql.select(newest([room]))).map((row) => row.doc.id)).toEqual(['msg_904']);
  });

  it('picks the fields of a read as the memory form does: an absent field stays absent, a JSON null stays null (DB-4)', async () => {
    const pick = ['id', 'prerequisiteIds', 'completedAt', 'helperIds', 'title', 'notAField'];
    const all = Object.keys(office.tasks);
    const reads: Select[] = [
      { c: 'tasks', where: [{ col: 'id', in: all }], pick },
      { c: 'tasks', where: [{ col: 'id', in: all }], pick: ['id'] },
      { c: 'tasks', where: [{ col: 'id', in: all }], pick: [] },
      { c: 'tasks', where: [{ col: 'project_id', in: ['prj_001'] }], order: { col: 'status', desc: true, id: true }, per: 'project_id', limit: 3, pick },
    ];
    const sql = sqlSource(q);
    const memory = memorySource(office);
    for (const s of reads) {
      const fromSql = await sql.select(s);
      const fromMemory = JSON.parse(JSON.stringify(await memory.select(s))) as typeof fromSql;
      expect(fromSql, JSON.stringify(s)).toEqual(fromMemory);
      expect(fromSql.map((row) => Object.keys(row.doc).sort()), JSON.stringify(s)).toEqual(fromMemory.map((row) => Object.keys(row.doc).sort()));
    }
    // The office holds each case: a task without prerequisiteIds, one that is not done (completedAt null), and none with notAField.
    const picked = await sql.select(reads[0]);
    expect(picked.some((row) => !('prerequisiteIds' in row.doc))).toBe(true);
    expect(picked.some((row) => 'prerequisiteIds' in row.doc)).toBe(true);
    expect(picked.some((row) => row.doc.completedAt === null)).toBe(true);
    expect(picked.every((row) => !('notAField' in row.doc))).toBe(true);
  });

  it('matches a key of an object field as the memory form does: absent, null, another value and a match (DB-5)', async () => {
    const reads: Select[] = [
      { c: 'events', where: [{ field: 'after', key: 'status', in: ['in_review'] }] },
      { c: 'events', where: [{ col: 'target_type', in: ['task'] }, { field: 'after', key: 'status', in: ['todo', 'in_progress', 'done'] }] },
      { c: 'events', where: [{ field: 'before', key: 'status', in: ['todo'] }, { field: 'after', key: 'status', in: ['in_progress'] }] },
      { c: 'events', where: [{ field: 'after', key: 'noSuchKey', in: ['in_review'] }] },
    ];
    // The office holds no change with a null "after" or one of another shape, so the test adds them in a transaction it rolls back.
    const base = Object.values(office.events).find((e) => e.targetType === 'task')!;
    const odd = [null, ['in_review'], 'in_review', { status: 3 }, { status: null }].map((after, i) => ({ ...base, id: `evt_99${i}`, seq: 990 + i, after }));
    const withOdd = { ...office, events: { ...office.events, ...Object.fromEntries(odd.map((e) => [e.id, e])) } } as State;
    await db.query('begin');
    try {
      for (const e of odd) await db.query('insert into events (id, doc) values ($1, $2)', [e.id, JSON.stringify({ ...e, undoneBy: null })]);
      const sql = sqlSource(q);
      const memory = memorySource(withOdd);
      for (const s of [...reads, { c: 'events', where: [{ field: 'after', key: 'status', in: ['3', 'null', 'in_review'] }] } as Select]) {
        expect(comparable('select', await sql.select(s)), JSON.stringify(s)).toEqual(comparable('select', await memory.select(s)));
      }
      expect((await sql.select(reads[0])).length).toBeGreaterThan(0);
      expect((await sql.select({ c: 'events', where: [{ field: 'after', key: 'status', in: ['3'] }] })).map((row) => row.doc.id)).toEqual(['evt_993']);
    } finally {
      await db.query('rollback');
    }
  });

  it('counts with the bounds joined on the key as the memory form does: gt, ge, after, a repeated stamp and a key with no row (DB-6)', async () => {
    const thread = office.comments.cmt_903.targetId;
    const stamp = '2026-10-03T11:00:00.000+03:00';
    const counts: CountSelect[] = [
      { c: 'comments', per: 'target_id', where: [{ col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by: { [thread]: { gt: '', ge: stamp }, tsk_none: { gt: '', ge: stamp } } } }] },
      { c: 'comments', per: 'target_id', where: [
        { col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by: { [thread]: { gt: '2026-10-01T00:00:00.000+03:00', ge: '2026-10-02T00:00:00.000+03:00', after: { at: stamp, id: 'cmt_903' } } } } },
        { field: 'authorId', notIn: ['usr_006'] },
      ] },
      { c: 'messages', per: 'conversation_id', where: [
        { bounds: { col: 'conversation_id', by: Object.fromEntries(Object.keys(office.conversations).map((id, i) => [id, { gt: i % 2 === 0 ? '' : stamp, ...(i % 3 === 0 ? { ge: stamp } : {}) }])) } },
        { field: 'authorId', notIn: ['usr_001'] },
      ] },
    ];
    const sql = sqlSource(q);
    const memory = memorySource(office);
    for (const s of counts) {
      expect(countSql(s).text).toContain('join');
      const fromSql = comparable('countWhere', await sql.countWhere(s));
      expect(fromSql, JSON.stringify(s)).toEqual(comparable('countWhere', await memory.countWhere(s)));
      expect(Object.keys(fromSql as object).length).toBeGreaterThan(0);
    }
    expect((await sql.countWhere(counts[1])).get(thread)).toBe(1);
  });

  it('gives the badge, the chat list and the bell the answers of the whole office, with the badge traps in the database (DB-6, DB-M1, DB-M2)', async () => {
    const traps = badgeTraps(office);
    const actors = [...Object.values(traps.users).filter((u) => u.kind === 'human' && u.active).map((u) => u.id), ...Object.values(traps.users).filter((u) => u.kind === 'agent').map((u) => u.id)];
    await db.query('begin');
    try {
      await writeDiff(q, diffState(office, traps), { signals: false });
      const source = sqlSource(q);
      for (const actor of actors) {
        for (const name of ['chats.unreadCount', 'chats.list', 'notifications.count', 'notifications.list'] as const) {
          const { whole, scoped } = await runBoth(traps, name, {}, actor, { now: NOW, correlationId: 'cor_it', source });
          expect(scoped, `${name} as ${actor}`).toEqual(whole);
        }
      }
    } finally {
      await db.query('rollback');
    }
  }, 120_000);

  it('finds the first row that still names a record as the memory form does, on the column of each plain field (DB-M3)', async () => {
    const plain = REFERENCE_FIELDS.filter((f) => columnOfField(f.collection as TableCollection, f.path) !== undefined);
    expect(plain.map((f) => `${f.collection}.${f.path}`)).toEqual(expect.arrayContaining([
      'comments.targetId', 'files.taskId', 'files.projectId', 'files.stageId', 'tasks.projectId', 'tasks.stageId', 'updates.projectId',
      'tracker.projectId', 'tracker.replyTaskId', 'payments.projectId', 'chatReads.conversationId',
    ]));
    const sql = sqlSource(q);
    const memory = memorySource(office);
    let found = 0;
    for (const { collection, path } of plain) {
      const c = collection as TableCollection;
      const rows = c === 'settings' ? [] : Object.values((office[c as keyof State] ?? {}) as Record<string, Record<string, unknown>>);
      const holders = rows.filter((row) => typeof row[path] === 'string');
      // No match; a match; the same id with the first holder left out (the record of the Undo itself), which finds the next one.
      const cases: [string, string | null][] = [['zzz_none', null]];
      if (holders.length > 0) cases.push([holders[0][path] as string, null], [holders[0][path] as string, tableOf(c).key(holders[0])]);
      for (const [id, except] of cases) {
        const fromSql = comparable('referencing', await sql.referencing(c, path, id, except)) as unknown[];
        expect(fromSql, `${c}.${path} ${id} ${except}`).toEqual(comparable('referencing', await memory.referencing(c, path, id, except)));
        found += fromSql.length;
      }
    }
    expect(found).toBeGreaterThan(10);
  });
});
