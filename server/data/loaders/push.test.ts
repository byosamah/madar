import { beforeAll, describe, expect, it } from 'vitest';
import type { PushDevice } from '../../../src/api/contract/entities';
import { PUSH_DEVICES_PER_PERSON } from '../../../src/api/contract/push';
import type { State } from '../../../src/api/store';
import { NOW as FACTORY_NOW, makeWorld } from '../../../src/test/factories';
import { buildSeed } from '../../../src/data/seed';
import { sharedCalls } from '../../../src/api/sharedCalls';
import { snapshotOf } from '../officeCache';
import { runBoth } from './compare';
import { loadFor } from './index';
import { memorySource } from './memorySource';
import { readSweep, writeSweep } from './sweep';

/**
 * The push loader (owner, 2026-10-08): each call gives the handler the same answer on the scoped load as on the whole office, and
 * the scoped load holds no device of another person, except the row of the endpoint that push.register saves.
 */

const NOW = FACTORY_NOW;
const FCM = 'https://fcm.googleapis.com/fcm/send/';
const device = (n: number, userId: string, endpoint = `${FCM}token-${n}`): PushDevice => ({
  id: `pdv_${String(n).padStart(3, '0')}`, userId, endpoint, label: `Device ${n}`, createdAt: `2026-09-${String(10 + n).padStart(2, '0')}T09:00:00.000+03:00`, lastPushAt: null,
});

/** Sara (usr_003) has 10 devices, Omar (usr_004) has 2, and the Admin (usr_001) has 1. */
function office(): State {
  const state = makeWorld();
  const rows = [
    ...Array.from({ length: PUSH_DEVICES_PER_PERSON }, (_, i) => device(i + 1, 'usr_003')),
    device(11, 'usr_004'), device(12, 'usr_004'), device(13, 'usr_001'),
  ];
  state.pushDevices = Object.fromEntries(rows.map((row) => [row.id, row]));
  state.counters.pdv = rows.length;
  return state;
}

const idsOf = (state: State) => Object.keys(state.pushDevices ?? {}).sort();

async function same(name: 'push.register' | 'push.remove' | 'push.mine', input: unknown, actor: string, state = office()) {
  const run = await runBoth(state, name, input, actor, { now: NOW, correlationId: 'cor_test' });
  expect(run.scoped, `${name} as ${actor}`).toEqual(run.whole);
  return run;
}

describe('the push loader', () => {
  it('push.mine loads the devices of the person only', async () => {
    for (const [actor, expected] of [['usr_003', 10], ['usr_004', 2], ['usr_001', 1], ['usr_002', 0]] as const) {
      const run = await same('push.mine', {}, actor);
      expect(idsOf(run.loaded)).toHaveLength(expected);
      expect(Object.values(run.loaded.pushDevices ?? {}).every((d) => d.userId === actor), actor).toBe(true);
    }
  });

  it('push.remove loads the row of the person with this endpoint, and never the row of another person', async () => {
    const own = await same('push.remove', { endpoint: `${FCM}token-11` }, 'usr_004');
    expect(idsOf(own.loaded)).toEqual(['pdv_011']);
    expect(own.whole.outcome.output).toEqual({ removed: true });
    expect(own.whole.changes).toEqual([expect.objectContaining({ table: 'push_devices', deleted: ['pdv_011'] })]);
    const other = await same('push.remove', { endpoint: `${FCM}token-11` }, 'usr_003');
    expect(idsOf(other.loaded)).toEqual([]);
    expect(other.whole.outcome.output).toEqual({ removed: false });
    expect(other.whole.changes).toEqual([]);
  });

  it('push.register loads the devices of the person and the row of the endpoint, and writes the same rows on both loads', async () => {
    // A new endpoint: the oldest of the 10 devices of Sara goes.
    const added = await same('push.register', { endpoint: `${FCM}token-new`, label: 'Chrome on Mac' }, 'usr_003');
    expect(idsOf(added.loaded)).toEqual(Array.from({ length: 10 }, (_, i) => `pdv_${String(i + 1).padStart(3, '0')}`).sort());
    expect(added.whole.changes).toEqual([expect.objectContaining({ table: 'push_devices', inserted: ['pdv_014'], deleted: ['pdv_001'] })]);
    // The endpoint of Omar: Sara takes it, and Omar loses it.
    const moved = await same('push.register', { endpoint: `${FCM}token-11`, label: 'Chrome on Mac' }, 'usr_003');
    expect(idsOf(moved.loaded)).toContain('pdv_011');
    expect(idsOf(moved.loaded)).not.toContain('pdv_012');
    expect(idsOf(moved.loaded)).not.toContain('pdv_013');
    expect(moved.whole.changes).toEqual([expect.objectContaining({ table: 'push_devices', updated: ['pdv_011'], deleted: ['pdv_001'] })]);
  });

  it('writes no event, no counter for events and no signal kind for a device', async () => {
    const run = await same('push.register', { endpoint: `${FCM}token-new`, label: 'Chrome on Mac' }, 'usr_004');
    expect(run.whole.changes).toEqual([expect.objectContaining({ table: 'push_devices' })]);
    expect((run.whole.changes as { table: string }[]).map((change) => change.table)).toEqual(['push_devices']);
    expect(run.whole.counters).toEqual({ pdv: 14 });
  });
});

describe('no other loader brings a device to a handler (owner, 2026-10-08)', () => {
  let seed: State;
  beforeAll(async () => {
    seed = await buildSeed('2026-10-04', async () => undefined);
    // Every active human holds two devices, so a loader that read the table at all would show it.
    const humans = Object.values(seed.users).filter((u) => u.kind === 'human' && u.active);
    seed.pushDevices = Object.fromEntries(humans.flatMap((user, i) => [1, 2].map((n) => {
      const row = device(i * 2 + n, user.id, `${FCM}secret-of-${user.id}-${n}`);
      return [row.id, row] as const;
    })));
  });

  it('loads no device for any call of the read sweep and the write sweep, as any person (the push calls load the own devices only)', async () => {
    const sweep = [...readSweep(seed), ...writeSweep(seed)];
    expect(sweep.length).toBeGreaterThan(500);
    for (const [name, input, actorId] of sweep) {
      const parsed = sharedCalls[name].input.parse(input);
      const state = await loadFor(name, parsed, { src: memorySource(seed), office: snapshotOf(seed, 1), actorId, write: !sharedCalls[name].readOnly });
      const loaded = Object.values(state.pushDevices ?? {});
      // The push calls read the own devices of the person. Every other call reads none.
      if (name.startsWith('push.')) expect(loaded.every((d) => d.userId === actorId), `${name} as ${actorId}`).toBe(true);
      else expect(loaded, `${name} as ${actorId}`).toEqual([]);
    }
  }, 60_000);

  it('loads only the own devices for push.mine, and for push.register the own devices and the row of the endpoint', async () => {
    const admin = Object.values(seed.users).find((u) => u.systemRole === 'admin' && u.active)!;
    const other = Object.values(seed.users).find((u) => u.kind === 'human' && u.active && u.id !== admin.id)!;
    const mine = await loadFor('push.mine', {}, { src: memorySource(seed), office: snapshotOf(seed, 1), actorId: admin.id, write: false });
    expect(Object.values(mine.pushDevices ?? {}).map((d) => d.userId)).toEqual([admin.id, admin.id]);
    const endpoint = `${FCM}secret-of-${other.id}-1`;
    const register = await loadFor('push.register', { endpoint, label: 'x' }, { src: memorySource(seed), office: snapshotOf(seed, 1), actorId: admin.id, write: true });
    expect(new Set(Object.values(register.pushDevices ?? {}).map((d) => d.userId))).toEqual(new Set([admin.id, other.id]));
    expect(Object.values(register.pushDevices ?? {}).filter((d) => d.userId === other.id).map((d) => d.endpoint)).toEqual([endpoint]);
  });
});
