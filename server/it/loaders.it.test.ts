import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import { runBoth } from '../data/loaders/compare';
import { memorySource } from '../data/loaders/memorySource';
import type { Source } from '../data/loaders/source';
import { sqlSource } from '../data/loaders/sqlSource';
import { readSweep, trapOffice, writeSweep } from '../data/loaders/sweep';
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
    select: wrap('select'), count: wrap('count'), undoLinks: wrap('undoLinks'), referencing: wrap('referencing'), threads: wrap('threads'), counters: wrap('counters'),
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
    expect(new Set(unique.map((request) => request.method))).toEqual(new Set(['select', 'count', 'undoLinks', 'referencing', 'threads', 'counters']));
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

  it('counts the bytes it reads toward the egress meter', async () => {
    let bytes = 0;
    await sqlSource(q, { bytes: (n) => (bytes += n) }).select({ c: 'tasks', where: [{ col: 'project_id', in: ['prj_001'] }] });
    expect(bytes).toBeGreaterThan(1000);
  });
});
