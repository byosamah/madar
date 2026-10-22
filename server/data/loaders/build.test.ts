import { beforeAll, describe, expect, it } from 'vitest';
import { can } from '../../../src/api/permissions';
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

describe('the authority of a load holds the office rights of its person (fbk_014)', () => {
  it('gives a custom role its right, and an agent of that person the same right', () => {
    const state = structuredClone(seed) as State;
    state.settings.roles = { custom: [{ id: 'rol_001', name: 'Cashier', nameAr: 'أمين الصندوق', rights: ['payment.manage'] }] };
    state.users.usr_050 = { ...state.users.usr_003, id: 'usr_050', email: 'cashier@madar.test', roleId: 'rol_001' };
    state.users.usr_052 = { ...state.users.usr_003, id: 'usr_052', email: 'agent@madar.test', kind: 'agent', ownerId: 'usr_050' };
    const office = officeOf(state);
    const own = new Load({ src: memorySource(structuredClone(state)), office, actorId: 'usr_050', write: false });
    expect(can(own.authority!, 'payment.view')).toBe(true);
    expect(can(own.authority!, 'payment.add')).toBe(true);
    expect(can(own.authority!, 'people.invite')).toBe(false);
    const agent = new Load({ src: memorySource(structuredClone(state)), office, actorId: 'usr_052', write: false });
    expect(agent.authority?.id).toBe('usr_050');
    expect(can(agent.authority!, 'payment.view')).toBe(true);
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

describe('Load.batch (SV-10 of perf2)', () => {
  /** A Source that counts how it is asked: one batch call, or one call for each read. */
  function counting(state: State) {
    const inner = memorySource(structuredClone(state));
    const calls = { batch: 0, select: 0, countWhere: 0, threads: 0 };
    const src: Source = {
      ...inner,
      select: async (s) => (calls.select++, inner.select(s)),
      countWhere: async (s) => (calls.countWhere++, inner.countWhere(s)),
      threads: async (o) => (calls.threads++, inner.threads(o)),
    };
    return { src, calls, inner };
  }
  const comments = { c: 'comments' as const, where: [{ col: 'target_type', eq: 'task' }, { col: 'target_id', in: ['tsk_001'] }] };
  const unread = { s: { c: 'messages' as const, per: 'conversation_id', where: [{ bounds: { col: 'conversation_id', by: { cnv_001: { gt: '' } } } }] }, values: ['cnv_001', 'cnv_002'], keyOf: (id: string) => `unread:${id}` };
  const asked = { owner: 'usr_001', led: [] as string[], me: ['usr_001'], limit: 30, admin: true, seen: ['prj_001', 'prj_002', 'prj_003'] };
  const steps = () => [
    { byKey: { c: 'tasks' as const, keys: ['tsk_001', 'tsk_002', 'tsk_001', null, ''] } },
    { select: comments },
    undefined,
    { count: unread },
    { threads: asked },
    { byKey: { c: 'tasks' as const, keys: [] } },
  ] as const;

  it('sends the reads to the batch of the source in one call, and gives the same State as the reads one by one', async () => {
    const office = officeOf(seed);
    const one = counting(seed);
    const A = new Load({ src: one.src, office, actorId: 'usr_001', write: false });
    const answers = await A.batch(steps());

    const many = counting(seed);
    const sequential = new Load({ src: many.src, office, actorId: 'usr_001', write: false });
    await sequential.byKey('tasks', ['tsk_001', 'tsk_002']);
    await sequential.select(comments);
    await sequential.countWhere(unread.s, unread.values, unread.keyOf);
    const threads = await many.src.threads(asked);

    expect(await A.state()).toEqual(await sequential.state());
    expect(answers[2]).toBeUndefined();
    expect(answers[1]).toHaveLength(Object.values(A.list('comments')).length);
    expect(answers[4]).toEqual(threads);
    // The source here has no batch, so Load asked it one read at a time: the same reads that the sequential way made.
    expect(one.calls).toEqual({ batch: 0, select: 2, countWhere: 1, threads: 1 });
  });

  it('asks a source that has a batch once, and skips a byKey with no missing key and a count with no value', async () => {
    const office = officeOf(seed);
    const inner = memorySource(structuredClone(seed));
    const asked: unknown[][] = [];
    const src: Source = {
      ...inner,
      async batch(reads) {
        asked.push([...reads]);
        return Promise.all(reads.map((read) => ('select' in read ? inner.select(read.select) : 'count' in read ? inner.countWhere(read.count) : inner.threads(read.threads))));
      },
    };
    const L = new Load({ src, office, actorId: 'usr_001', write: false });
    await L.byKey('tasks', ['tsk_001']);
    await L.batch([
      { byKey: { c: 'tasks', keys: ['tsk_001'] } },
      { count: { s: { c: 'messages', per: 'conversation_id', where: [] }, values: [], keyOf: (id) => id } },
      { select: { c: 'comments', where: [{ col: 'id', in: ['cmt_001'] }] } },
      { select: { c: 'updates', where: [{ col: 'id', in: ['upd_001'] }] } },
    ]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toHaveLength(2);

    // One read left after the skips goes to select, not to the batch.
    await L.batch([{ count: { s: { c: 'messages', per: 'conversation_id', where: [] }, values: [], keyOf: (id) => id } }, { select: { c: 'files', where: [] } }]);
    expect(asked).toHaveLength(1);
  });

  it('refuses an office list and a count in a write, as select and countWhere do', async () => {
    const L = new Load({ src: memorySource(structuredClone(seed)), office: officeOf(seed), actorId: 'usr_001', write: true });
    await expect(L.batch([{ select: { c: 'projects', where: [] } }])).rejects.toThrow('office');
    await expect(L.batch([{ count: { s: { c: 'messages', per: 'conversation_id', where: [] }, values: ['cnv_001'], keyOf: (id) => id } }])).rejects.toThrow('never counts');
  });
});
