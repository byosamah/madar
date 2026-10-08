import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { FEED_VERBS } from '../../src/api/views';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import { runBoth } from '../data/loaders/compare';
import { memorySource } from '../data/loaders/memorySource';
import type { Select } from '../data/loaders/query';
import type { Source } from '../data/loaders/source';
import { selectSql, sqlSource } from '../data/loaders/sqlSource';
import { readSweep, TIE_PROJECT, trapOffice, writeSweep } from '../data/loaders/sweep';
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

  it('counts the bytes it reads toward the egress meter', async () => {
    let bytes = 0;
    await sqlSource(q, { bytes: (n) => (bytes += n) }).select({ c: 'tasks', where: [{ col: 'project_id', in: ['prj_001'] }] });
    expect(bytes).toBeGreaterThan(1000);
  });
});
