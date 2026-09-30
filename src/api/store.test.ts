import { describe, expect, it } from 'vitest';
import { Store, emptyState, memberKey, nextId } from './store';
import { memoryPersister } from './persist';

describe('Store', () => {
  it('gives ids with a prefix and three digits', () => {
    const state = emptyState('2026-09-30');
    expect(nextId(state, 'prj')).toBe('prj_001');
    expect(nextId(state, 'prj')).toBe('prj_002');
    expect(nextId(state, 'tsk')).toBe('tsk_001');
  });

  it('keys members by project and user', () => {
    expect(memberKey('prj_001', 'usr_002')).toBe('prj_001:usr_002');
  });

  it('rolls back a failed change', () => {
    const store = new Store(emptyState('2026-09-30'), memoryPersister());
    expect(() =>
      store.run((state) => {
        nextId(state, 'prj');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.state.counters.prj).toBeUndefined();
  });

  it('saves a good change', async () => {
    const persister = memoryPersister();
    const store = new Store(emptyState('2026-09-30'), persister);
    store.run((state) => {
      state.settings.workloadLimit = 12;
    });
    await store.flush();
    expect((await persister.load())?.settings.workloadLimit).toBe(12);
  });

  it('tells listeners about changes but not about reads', () => {
    const store = new Store(emptyState('2026-09-30'), memoryPersister());
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.read((state) => state.version);
    expect(calls).toBe(0);
    store.run((state) => {
      state.settings.workloadLimit = 11;
    });
    expect(calls).toBe(1);
  });

  it('marks storage as not persistent when a save fails', async () => {
    const persister = {
      ...memoryPersister(),
      persistent: true,
      save: async () => {
        throw new Error('quota');
      },
    };
    const store = new Store(emptyState('2026-09-30'), persister);
    expect(store.persistent).toBe(true);
    store.run((state) => {
      state.settings.workloadLimit = 9;
    });
    await store.flush();
    expect(store.persistent).toBe(false);
  });
});
