import { afterEach, describe, expect, it } from 'vitest';
import { processOutbox, registerEffect, writeOutbox } from '../../core/effects';
import { fakeDeps } from '../../test/fakes/deps';
import { freshLite } from './testDb';

const NOW = new Date('2026-10-04T06:00:00Z');
const removers: (() => void)[] = [];
afterEach(() => {
  while (removers.length > 0) removers.pop()!();
});

describe('the outbox on SQLite (server/core/effects.ts)', () => {
  it('writes the rows of a call in order, then claims and marks each one done, failed or waiting', async () => {
    const { db } = await freshLite();
    const deps = fakeDeps({ db });
    deps.clock.set(NOW);
    const retryAt = new Date('2026-10-05T00:00:00Z');
    removers.push(registerEffect('lite.ok', async () => undefined));
    removers.push(registerEffect('lite.fail', async () => {
      throw new Error('no');
    }));
    removers.push(registerEffect('lite.wait', async () => {
      throw Object.assign(new Error('full'), { retryAt });
    }));
    const ids = await db.tx('write', (q) => writeOutbox(q, [{ kind: 'lite.ok', payload: { a: 1 } }, { kind: 'lite.fail', payload: {} }, { kind: 'lite.wait', payload: {} }]));
    expect(ids).toEqual(['1', '2', '3']);
    expect(await processOutbox(deps, ids)).toEqual({ done: ['1'], failed: ['2', '3'] });
    expect(await db.statement('read', 'select id, done_at, error, attempts, claimed_until from outbox order by id')).toEqual([
      { id: 1, done_at: NOW.toISOString(), error: null, attempts: 1, claimed_until: new Date(NOW.getTime() + 120_000).toISOString() },
      { id: 2, done_at: null, error: 'no', attempts: 1, claimed_until: new Date(NOW.getTime() + 120_000).toISOString() },
      { id: 3, done_at: null, error: 'full', attempts: 0, claimed_until: retryAt.toISOString() },
    ]);
    expect(await processOutbox(deps, ['1'])).toEqual({ done: [], failed: [] });
  });
});
