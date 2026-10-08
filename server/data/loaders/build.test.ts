import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { OFFICE_COLLECTIONS } from '../../core/types';
import { snapshotOf } from '../officeCache';
import { beforeOf, Load } from './build';
import { memorySource } from './memorySource';
import type { Source } from './source';

/**
 * The State of one load (performance audit SRV-M1, SRV-8 step 1). A Source gives rows that the caller owns, so Load.state() keeps
 * them with no second copy. The office lists stay a copy of the frozen snapshot. beforeOf gives a write its "before" with the
 * snapshot lists themselves and a copy of every other collection.
 */

const TODAY = '2026-10-04';
let seed: State;
beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

const officeOf = (state: State) => snapshotOf(Object.fromEntries(OFFICE_COLLECTIONS.map((c) => [c, state[c]])) as never, 1);

describe('a Source gives rows that the caller owns', () => {
  it('memorySource gives a new copy on each select, so a change to one answer never reaches the next', async () => {
    const src = memorySource(structuredClone(seed));
    const [first] = await src.select({ c: 'tasks', where: [{ col: 'id', in: ['tsk_001'] }] });
    const title = (first.doc as { title: string }).title;
    (first.doc as { title: string }).title = 'Changed by the caller';
    const [again] = await src.select({ c: 'tasks', where: [{ col: 'id', in: ['tsk_001'] }] });
    expect((again.doc as { title: string }).title).toBe(title);
    expect(again.doc).not.toBe(first.doc);
  });
});

describe('Load.state()', () => {
  it('keeps the row objects that the Source gave, with no second copy, and gives the office lists as a copy', async () => {
    const task = structuredClone(seed.tasks.tsk_001) as unknown as Record<string, unknown>;
    const given = { ord: 1, doc: task };
    const src = new Proxy(memorySource(structuredClone(seed)), {
      get(target, key, receiver) {
        if (key === 'select') return async () => [given];
        return Reflect.get(target, key, receiver);
      },
    }) as Source;
    const office = officeOf(seed);
    const L = new Load({ src, office, actorId: 'usr_001', write: false });
    await L.select({ c: 'tasks', where: [{ col: 'id', in: ['tsk_001'] }] });
    const state = await L.state();
    expect(state.tasks.tsk_001).toBe(task);
    expect(state.users).not.toBe(office.lists.users);
    expect(state.users).toEqual(office.lists.users);
    expect(Object.isFrozen(state.users.usr_001)).toBe(false);
  });
});

describe('beforeOf', () => {
  it('points the office lists to the snapshot, copies every other collection, and refuses a write into the office part', () => {
    const office = officeOf(seed);
    const state = { ...structuredClone(seed), ...structuredClone(office.lists) } as State;
    const before = beforeOf(state, office);
    for (const c of OFFICE_COLLECTIONS) expect(before[c]).toBe(office.lists[c]);
    expect(before.tasks).not.toBe(state.tasks);
    expect(before.tasks).toEqual(state.tasks);
    expect(before.events).toEqual(state.events);
    expect(Object.keys(before).sort()).toEqual(Object.keys(state).sort());
    state.tasks.tsk_001.title = 'The handler changed it';
    expect(before.tasks.tsk_001.title).toBe(seed.tasks.tsk_001.title);
    expect(() => {
      (before.users.usr_001 as { name: string }).name = 'No';
    }).toThrow(TypeError);
  });
});
