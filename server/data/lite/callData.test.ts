import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { everyCall } from '../../core/everyCall';
import { createRunCall } from '../../core/runCall';
import type { BatchScope, RunRequest } from '../../core/types';
import { fakeDeps } from '../../test/fakes/deps';
import { liteData } from './callData';
import { freshLite } from './testDb';
import { liteLoadWhole, liteWriteState } from './whole';

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
const batchOf = (): BatchScope => ({ storyRefs: new Map(), overviewCalls: 0 });

async function office() {
  const lite = await freshLite();
  const seed = await buildSeed(TODAY, async () => undefined);
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  const deps = fakeDeps({ db: lite.db });
  deps.clock.set(NOW);
  const run = createRunCall({ data: liteData });
  const call = (name: string, input: unknown, actorId: string, extra: Partial<RunRequest> = {}) =>
    run(deps, { principal: { userId: actorId }, name, input, batch: batchOf(), ...extra });
  const count = async (table: string) => Number((await lite.db.statement<{ n: number }>('read', `select count(*) as n from ${table}`))[0].n);
  return { ...lite, seed, deps, call, count };
}

const entryOf = (seed: State, name: string) => everyCall(seed).find((c) => c.name === name)!;

describe('runCall on SQLite (server/data/lite/callData.ts)', () => {
  it('runs a write and saves its change, its story and its events', async () => {
    const { call, seed, db, count } = await office();
    const c = entryOf(seed, 'tasks.update');
    expect((await call(c.name, c.input, c.actorId)).ok).toBe(true);
    const back = await db.tx('read', (q) => liteLoadWhole(q));
    expect(Object.keys(back.events).length).toBeGreaterThan(Object.keys(seed.events).length);
    expect(await count('stories')).toBe(1);
  });

  it('gives the stored answer to a retry with the same key, and writes nothing more', async () => {
    const { call, seed, count } = await office();
    const c = entryOf(seed, 'tasks.update');
    const first = await call(c.name, c.input, c.actorId, { key: 'key_001' });
    const events = await count('events');
    const second = await call(c.name, c.input, c.actorId, { key: 'key_001' });
    expect(second.ok && second.output).toEqual(first.ok && first.output);
    expect(await count('events')).toBe(events);
    expect(await count('idempotency')).toBe(1);
  });

  it('rolls back a write that the handler refuses: no story, no event', async () => {
    const { call, seed, count } = await office();
    const c = entryOf(seed, 'tasks.take');
    const events = await count('events');
    const result = await call(c.name, c.input, c.actorId);
    expect(result.ok ? 'ok' : result.error.code).toBe('invalid_input');
    expect(await count('stories')).toBe(0);
    expect(await count('events')).toBe(events);
  });

  it('keeps the office of the batch after a read, and drops it after a write that changed an office list', async () => {
    const { call, seed } = await office();
    const batch = batchOf();
    const read = entryOf(seed, 'projects.list');
    await call(read.name, read.input, read.actorId, { batch });
    expect(batch.office).toBeDefined();
    const write = entryOf(seed, 'projects.update');
    expect((await call(write.name, write.input, write.actorId, { batch })).ok).toBe(true);
    expect(batch.office).toBeUndefined();
  });

  it('runs story.start, a server call, on the SQLite stories table', async () => {
    const { call, count } = await office();
    const result = await call('story.start', {}, 'usr_001');
    expect(result.ok && (result.output as { storyId: string }).storyId).toMatch(/^sty_[a-z2-7]{22}$/);
    expect(await count('stories')).toBe(1);
  });
});
