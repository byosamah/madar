import { describe, expect, it, vi } from 'vitest';
import { Store, emptyState, memberKey, nextId } from './store';
import { memoryPersister } from './persist';
import { TaskId } from './contract/entities';
import { compareTasks } from '../lib/stageFlow';

describe('Store', () => {
  it('gives ids with a prefix and three digits', () => {
    const state = emptyState('2026-09-30');
    expect(nextId(state, 'prj')).toBe('prj_001');
    expect(nextId(state, 'prj')).toBe('prj_002');
    expect(nextId(state, 'tsk')).toBe('tsk_001');
  });

  // fbk_086: an id has at least 3 digits, so tsk_1000 is the next id after tsk_999. The zod rule takes it, and a tie-break sort puts it after tsk_999.
  it('goes on to four digits after 999, and a tie-break puts tsk_999 before tsk_1000', () => {
    const state = emptyState('2026-09-30');
    state.counters.tsk = 998;
    const ids = [nextId(state, 'tsk'), nextId(state, 'tsk')];
    expect(ids).toEqual(['tsk_999', 'tsk_1000']);
    expect(TaskId.safeParse('tsk_1000').success).toBe(true);
    const task = (id: string) => ({ id, stageId: 'stg_001', title: 'Same title', status: 'todo', startDate: '2026-11-01', dueDate: '2026-11-10' });
    // The later id first in the list: the sort must still put tsk_999 first.
    expect([task('tsk_1000'), task('tsk_999')].sort((a, b) => compareTasks(a, b)).map((t) => t.id)).toEqual(['tsk_999', 'tsk_1000']);
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

  it('runIf saves and tells the listeners only when the change says it changed something (performance audit FET-11)', async () => {
    vi.useFakeTimers();
    try {
      const persister = memoryPersister();
      const save = vi.spyOn(persister, 'save');
      const store = new Store(emptyState('2026-09-30'), persister);
      let calls = 0;
      store.subscribe(() => {
        calls += 1;
      });
      expect(store.runIf(() => false)).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect([calls, save.mock.calls.length]).toEqual([0, 0]);
      expect(store.runIf((state) => {
        state.settings.workloadLimit = 13;
        return true;
      })).toBe(true);
      await vi.advanceTimersByTimeAsync(1000);
      expect([calls, save.mock.calls.length]).toEqual([1, 1]);
      expect((await persister.load())?.settings.workloadLimit).toBe(13);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runIf rolls back a failed change, like run', () => {
    const store = new Store(emptyState('2026-09-30'), memoryPersister());
    expect(() =>
      store.runIf((state) => {
        nextId(state, 'prj');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.state.counters.prj).toBeUndefined();
  });
});
