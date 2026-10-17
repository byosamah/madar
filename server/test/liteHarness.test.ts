import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { liteDb } from '../data/lite/db';
import { nodeHost } from '../data/lite/host';
import { applyLiteSchema } from '../data/lite/schema';
import { liteLoadWhole } from '../data/lite/whole';
import { createGate } from './gate';
import { liteChecksum, liteWriteDown, LiteWorker } from './liteHarness';

async function office() {
  const raw = new DatabaseSync(':memory:');
  const host = nodeHost(raw);
  await applyLiteSchema(host);
  return { raw, db: liteDb(host) };
}

describe('the SQLite mirror backend (server/test/liteHarness.ts)', () => {
  it('writes the test edits with no rule check, also a change of an old event, and makes the event guards again', async () => {
    const { db } = await office();
    const seed = await buildSeed('2026-10-04', async () => undefined);
    const blank = { ...emptyState(''), settings: undefined as unknown as State['settings'] };
    expect(await liteWriteDown(db, blank, seed)).toBe(true);
    const event = Object.values(seed.events)[0];
    const edited = structuredClone(seed);
    edited.events[event.id] = { ...event, createdAt: '2026-01-01T00:00:00.000+03:00' };
    expect(await liteWriteDown(db, seed, edited)).toBe(true);
    const back = await db.tx('read', (q) => liteLoadWhole(q));
    expect(back.events[event.id].createdAt).toBe('2026-01-01T00:00:00.000+03:00');
    await expect(db.statement('write', 'delete from events')).rejects.toThrow('events only grow');
  });

  it('gives the same checksum for the same rows, and another after a write', async () => {
    const { raw, db } = await office();
    const first = liteChecksum(raw);
    expect(liteChecksum(raw)).toBe(first);
    await db.tx('write', (q) => q('insert into counters (prefix, n) values (?, ?)', ['tsk', 1]));
    expect(liteChecksum(raw)).not.toBe(first);
  });

  it('gives each test a new office: no row of one test is in the next one', async () => {
    const worker = new LiteWorker();
    const gate = createGate();
    gate.start('one');
    const backend = worker.backendFor(gate);
    await backend.begin();
    const seed = await buildSeed('2026-10-04', async () => undefined);
    await backend.writeDown(await backend.readBack(), seed);
    expect(Object.keys((await backend.readBack()).tasks).length).toBeGreaterThan(0);
    await gate.end();
    worker.end();
    gate.start('two');
    const next = worker.backendFor(gate);
    await next.begin();
    expect((await next.readBack()).tasks).toEqual({});
    await gate.end();
    worker.end();
  });
});
