import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { runBoth } from '../loaders/compare';
import { memorySource } from '../loaders/memorySource';
import type { Source } from '../loaders/source';
import { readSweep, trapOffice, writeSweep } from '../loaders/sweep';
import type { LiteDb } from './db';
import { liteSource } from './source';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');

type Request = { method: keyof Source; args: unknown[] };

/** A source that writes down every read it answers (as in server/it/loaders.it.test.ts). */
function recording(inner: Source, log: Request[]): Source {
  const wrap = <K extends keyof Source>(method: K) => (async (...args: unknown[]) => {
    log.push({ method, args: structuredClone(args) });
    return (inner[method] as (...a: unknown[]) => Promise<unknown>)(...args);
  }) as Source[K];
  return { select: wrap('select'), count: wrap('count'), countWhere: wrap('countWhere'), undoLinks: wrap('undoLinks'), referencing: wrap('referencing'), threads: wrap('threads'), counters: wrap('counters') };
}

/** One answer in a form that both sources share: docs in order, with undoneBy null; a Map as a sorted object. */
function comparable(method: keyof Source, answer: unknown): unknown {
  if (method === 'select' || method === 'referencing') {
    return (answer as { doc: Record<string, unknown> }[]).map((row) => ('undoneBy' in row.doc ? { ...row.doc, undoneBy: null } : row.doc));
  }
  if (answer instanceof Map) return Object.fromEntries([...answer.entries()].sort());
  return answer;
}

describe('every loader read on SQLite (the sweep of server/it/loaders.it.test.ts on node:sqlite)', () => {
  let office: State;
  let db: LiteDb;
  let log: string[];

  beforeAll(async () => {
    office = trapOffice(await buildSeed(TODAY, async () => undefined));
    const lite = await freshLite();
    db = lite.db;
    log = lite.log;
    await db.tx('write', (q) => liteWriteState(q, office));
  }, 60_000);

  it('answers every read of the loaders with the rows of the memory form', async () => {
    const requests: Request[] = [];
    const source = recording(memorySource(office), requests);
    for (const [name, input, actor, prepared] of [...readSweep(office), ...writeSweep(office)]) {
      await runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_lite', prepared, source });
    }
    const unique = [...new Map(requests.map((request) => [JSON.stringify(request), request])).values()];
    expect(unique.length).toBeGreaterThan(300);
    const memory = memorySource(office);
    for (const request of unique) {
      const call = (s: Source) => (s[request.method] as (...a: unknown[]) => Promise<unknown>)(...structuredClone(request.args));
      const lite = await db.tx('read', (q) => call(liteSource(q)));
      expect(comparable(request.method, lite), JSON.stringify(request)).toEqual(comparable(request.method, await call(memory)));
    }
  }, 120_000);

  it('gives every call of the sweep the same answer from SQLite as from the whole office', async () => {
    for (const [name, input, actor, prepared] of [...readSweep(office), ...writeSweep(office)]) {
      const { whole, scoped } = await db.tx('read', (q) => runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_lite', prepared, source: liteSource(q) }));
      expect(scoped, `${name} ${JSON.stringify(input)} as ${actor}`).toEqual(whole);
    }
  }, 120_000);

  it('never sorts in a temporary b-tree for a cut order', async () => {
    log.length = 0;
    for (const [name, input, actor, prepared] of readSweep(office)) {
      await db.tx('read', (q) => runBoth(office, name, input, actor, { now: NOW, correlationId: 'cor_lite', prepared, source: liteSource(q) }));
    }
    const cuts = [...new Set(log.filter((text) => /order by .* limit \?$/.test(text) && !text.includes('order by t.rowid')))];
    expect(cuts.length).toBeGreaterThan(5);
    const sorts = cuts.filter((text) => {
      const plan = db.host.exec(`explain query plan ${text}`, Array.from({ length: (text.match(/\?/g) ?? []).length }, () => null)).rows;
      return plan.some((row) => String(row.detail).includes('TEMP B-TREE'));
    });
    expect(sorts).toEqual([]);
  }, 120_000);
});
