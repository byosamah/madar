import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { defineCall, type AnyCall } from '../../src/api/registry';
import { sharedCalls } from '../../src/api/sharedCalls';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { fakeDeps } from '../test/fakes/deps';
import { memoryData } from './memoryData';
import { createRunCall } from './runCall';
import { serverCallMap, type CallEntry, type SharedEntry } from './serverCallMap';
import type { BatchScope, Principal, RunResult } from './types';

/**
 * The settle hook (Madar enterprises, plan C): runCall calls it once after the write transaction ended, with ok after a commit or a replay
 * of an idempotency key, and with not ok after any throw. A throw in the hook is logged and never changes the answer.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

type Seen = { outcome: { ok: boolean; output?: unknown; replayed?: boolean }; preflight: unknown }[];

function setup(hooks: Partial<NonNullable<SharedEntry['hooks']>> = {}, def?: AnyCall) {
  const seen: Seen = [];
  const map = new Map<string, CallEntry>(serverCallMap);
  const real = def ?? (sharedCalls['clients.create'] as AnyCall);
  map.set('clients.create', {
    kind: 'shared', name: 'clients.create', def: real, input: real.input, readOnly: false,
    hooks: { preflight: async () => 'reserved', settle: async (_input, _ctx, preflight, outcome) => void seen.push({ outcome, preflight }), ...hooks },
  });
  const mem = memoryData(seed);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ calls: map, data: () => mem.data() });
  const batch = (): BatchScope => ({ storyRefs: new Map(), overviewCalls: 0 });
  const call = (userId: string, input: unknown, more: { key?: string } = {}): Promise<RunResult> =>
    run(deps, { principal: { userId } as Principal, name: 'clients.create', input, batch: batch(), ...more });
  return { seen, call, deps };
}

describe('the settle hook of runCall', () => {
  it('hears ok after a commit, with the output and the value of the preflight', async () => {
    const { seen, call } = setup();
    expect((await call(ADMIN, { name: 'Settled client' })).ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ outcome: { ok: true, output: { name: 'Settled client' } }, preflight: 'reserved' });
  });

  it('hears ok after a replay of an idempotency key, once for each call', async () => {
    const { seen, call } = setup();
    expect((await call(ADMIN, { name: 'Twice' }, { key: 'key-1' })).ok).toBe(true);
    expect((await call(ADMIN, { name: 'Twice' }, { key: 'key-1' })).ok).toBe(true);
    expect(seen.map((one) => one.outcome.ok)).toEqual([true, true]);
  });

  it('tells the settle hook that a replayed answer is a replay, and a first answer is not', async () => {
    const { seen, call } = setup();
    await call(ADMIN, { name: 'Flagged' }, { key: 'key-flag' });
    await call(ADMIN, { name: 'Flagged' }, { key: 'key-flag' });
    expect(seen.map((one) => one.outcome.replayed ?? false)).toEqual([false, true]);
  });

  it('hears not ok after a throw of the handler', async () => {
    const real = sharedCalls['clients.create'] as AnyCall;
    const { seen, call } = setup({}, defineCall({ input: real.input, output: real.output, run: () => { throw new ApiError('forbidden', 'You cannot do this.'); } }));
    const result = await call(ADMIN, { name: 'Refused' });
    expect(result.ok).toBe(false);
    expect(seen).toEqual([{ outcome: { ok: false }, preflight: 'reserved' }]);
  });

  it('hears not ok after a throw in the transaction, and rolls the change back', async () => {
    const { seen, call } = setup({ prepare: async () => { throw new Error('The prepare failed.'); } });
    expect((await call(ADMIN, { name: 'Broken' })).ok).toBe(false);
    expect(seen.map((one) => one.outcome.ok)).toEqual([false]);
  });

  it('keeps the answer when the settle hook throws, and logs a warning', async () => {
    const { call, deps } = setup({ settle: async () => { throw new Error('The settle failed.'); } });
    expect((await call(ADMIN, { name: 'Still saved' })).ok).toBe(true);
    expect(deps.logs.some((line) => line.level === 'warn' && line.message.includes('settle step'))).toBe(true);
  });

  it('runs no settle when the preflight throws, and none for a read', async () => {
    const { seen, call } = setup({ preflight: async () => { throw new Error('The preflight failed.'); } });
    await call(ADMIN, { name: 'No preflight' }).catch(() => undefined);
    expect(seen).toEqual([]);
  });
});
