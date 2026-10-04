import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { historyCalls } from '../../src/api/handlers/history';
import { peopleCalls } from '../../src/api/handlers/people';
import { taskCalls } from '../../src/api/handlers/tasks';
import { emptyState, type State } from '../../src/api/store';
import { setNow } from '../../src/lib/dates';
import { makeTask, makeWorld, NOW } from '../../src/test/factories';
import { memoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { fakeDeps } from './fakes/deps';
import { createDbApi, officeOf, type MirrorBackend } from './dbApi';

/**
 * The mirror store on the in-memory data of runCall (server/core/memoryData.ts), so its rules run without Docker. The database
 * backend of server/test/db.ts follows the same interface, and the db project runs it on the local stack.
 */
function memoryBackend(o: { lie?: (result: RunResult, mem: ReturnType<typeof memoryData>) => void } = {}) {
  const mem = memoryData(emptyState(''));
  const deps = fakeDeps({ db: mem.db });
  let runs = 0;
  const backend: MirrorBackend & { runs(): number; mem: typeof mem } = {
    mem,
    owner: undefined,
    runs: () => runs,
    async begin() {},
    async writeDown(before, after) {
      if (JSON.stringify(officeOf(before)) === JSON.stringify(officeOf(after))) return false;
      Object.assign(mem.tables.state, structuredClone(officeOf(after)));
      mem.tables.version += 1;
      return true;
    },
    async run(req, calls) {
      runs += 1;
      const result = await createRunCall({ calls, data: () => mem.data(), afterCommit: async () => undefined })(deps, req);
      o.lie?.(result, mem);
      return result;
    },
    async readBack() {
      const state = structuredClone(mem.tables.state);
      // The memory data keeps undoneBy as null, as the database does; the read fills it from the undo events (plan 4.3).
      for (const event of Object.values(state.events)) if (event.undoes && state.events[event.undoes]) state.events[event.undoes].undoneBy = event.id;
      return state;
    },
    async checksum() {
      const t = mem.tables;
      return JSON.stringify([t.state, t.version, t.officeSeq, [...t.stories], [...t.keys], t.outbox]);
    },
    signals: deps.signal.sent,
    clock: deps.clock,
  };
  return backend;
}

function world(): State {
  const state = makeWorld();
  state.tasks.tsk_001 = makeTask();
  state.counters.tsk = 1;
  return state;
}

const CALLS = { ...peopleCalls, ...taskCalls, ...historyCalls };

beforeEach(() => setNow(NOW));
afterEach(() => setNow(null));

describe('the db-mode mirror store (TM 3.3)', () => {
  it('runs a write on the backend and updates the mirror in place, so held objects see the change', async () => {
    const backend = memoryBackend();
    const t = createDbApi(CALLS, world(), backend);
    const s = t.store.state;
    const task = s.tasks.tsk_001;
    const detail = await t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'Roof plan' } });
    expect(detail.task.title).toBe('Roof plan');
    expect(backend.runs()).toBe(1);
    expect(t.store.state).toBe(s);
    expect(s.tasks.tsk_001).toBe(task);
    expect(task.title).toBe('Roof plan');
    expect(backend.mem.tables.state.tasks.tsk_001.title).toBe('Roof plan');
  });

  it('writes the direct edits of the test before the call, so exact new ids still hold', async () => {
    const t = createDbApi(CALLS, world(), memoryBackend());
    t.store.state.counters.tsk = 5;
    const detail = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Roof plan' });
    expect(detail.task.id).toBe('tsk_006');
    expect(t.store.state.tasks.tsk_006.title).toBe('Roof plan');
    expect(t.store.state.counters.tsk).toBe(6);
  });

  it('removes deleted records from the mirror and keeps the order of the database', async () => {
    const state = world();
    state.tasks.tsk_002 = makeTask({ id: 'tsk_002', title: 'Second' });
    const t = createDbApi(CALLS, state, memoryBackend());
    const tasks = t.store.state.tasks;
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    expect(t.store.state.tasks).toBe(tasks);
    expect(Object.keys(tasks)).toEqual(['tsk_002']);
  });

  it('gives a made-up story ID a real story, and maps it back in the mirror, the output and the Undo input', async () => {
    const backend = memoryBackend();
    const t = createDbApi(CALLS, world(), backend);
    const result = await t.api.run('tasks.update', { id: 'tsk_001', patch: { title: 'Late' } }, { correlationId: 'cor_late' });
    expect(result).toMatchObject({ storyId: 'cor_late', changed: true });
    const mine = Object.values(t.store.state.events).filter((event) => event.correlationId === 'cor_late');
    expect(mine.length).toBeGreaterThan(0);
    const real = Object.values(backend.mem.tables.state.events).map((event) => event.correlationId);
    expect(real.every((id) => /^sty_[a-z2-7]{22}$/.test(id))).toBe(true);
    await t.api.call('events.undoStory', { correlationId: 'cor_late' });
    expect(t.store.state.tasks.tsk_001.title).toBe('Ground floor plan');
  });

  it('throws the ApiError of the server with its code', async () => {
    const t = createDbApi(CALLS, world(), memoryBackend());
    t.as('usr_004');
    const refusal = t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'Mine' } });
    await expect(refusal).rejects.toBeInstanceOf(ApiError);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'Mine' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('no.such' as never, {} as never)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('runs a call that the server does not have in memory on the mirror, and writes its change down on the next call', async () => {
    const backend = memoryBackend();
    const t = createDbApi(CALLS, world(), backend);
    await t.api.call('session.previewAs', { userId: 'usr_003' });
    expect(t.store.state.session.currentUserId).toBe('usr_003');
    expect(backend.runs()).toBe(0);
    expect((await t.api.call('session.get', {})).user.id).toBe('usr_003');
  });

  it('acts as an agent with the agent principal', async () => {
    const t = createDbApi(CALLS, world(), memoryBackend());
    t.as('usr_005');
    expect((await t.api.call('session.get', {})).user.id).toBe('usr_005');
  });

  it('reads the database again when another mirror of the same test wrote in between', async () => {
    const backend = memoryBackend();
    const first = createDbApi(CALLS, world(), backend);
    await first.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'First' } });
    const other = world();
    other.tasks.tsk_001.title = 'Other';
    const second = createDbApi(CALLS, other, backend);
    await second.api.call('tasks.get', { id: 'tsk_001' });
    expect(backend.mem.tables.state.tasks.tsk_001.title).toBe('Other');
    // The first mirror still holds "First", so its write-down puts it back before its next call.
    expect((await first.api.call('tasks.get', { id: 'tsk_001' })).task.title).toBe('First');
  });

  it('runs the calls of one test one at a time', async () => {
    const t = createDbApi(CALLS, world(), memoryBackend());
    const [a, b] = await Promise.all([
      t.api.call('tasks.create', { projectId: 'prj_001', title: 'A' }),
      t.api.call('tasks.create', { projectId: 'prj_001', title: 'B' }),
    ]);
    expect([a.task.id, b.task.id]).toEqual(['tsk_002', 'tsk_003']);
  });

  it('fails the call with the shadow run when the database drops a change', async () => {
    const t = createDbApi(CALLS, world(), memoryBackend({ lie: (_result, mem) => { mem.tables.state.tasks.tsk_001.title = 'Ground floor plan'; } }));
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'Lost' } })).rejects.toThrow(
      /db mode: tasks\.update: the database saved another change than the whole office in memory/,
    );
  });

  it('fails the call with the free checks when a read changes the database', async () => {
    const t = createDbApi(CALLS, world(), memoryBackend({ lie: (_result, mem) => { mem.tables.state.tasks.tsk_001.flagged = true; } }));
    await expect(t.api.call('tasks.get', { id: 'tsk_001' })).rejects.toThrow(/db mode: tasks\.get is a read, and it changed the database/);
  });
});
