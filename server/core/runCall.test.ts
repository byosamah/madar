import { z } from 'zod';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { defineCall, type AnyCall } from '../../src/api/registry';
import { sharedCalls } from '../../src/api/sharedCalls';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { nowStamp } from '../../src/lib/dates';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { runInHost } from './after';
import { diffState } from '../data/save';
import { CHAT_NOTICE_EFFECT } from '../mail/notices';
import { PUSH_CHAT_EFFECT } from '../push/notify';
import { registerOutbox } from './effects';
import { EXPECTED_REFUSALS, everyCall } from './everyCall';
import { memoryData, type MemoryData } from './memoryData';
import { createRunCall, type CallData, type RunCallOptions } from './runCall';
import { serverCallMap, type CallEntry, type SharedEntry } from './serverCallMap';
import { STORY_LIFE_MS } from './story';
import type { BatchScope, Principal, RunRequest, RunResult } from './types';

/**
 * Suite 2 of TM 7, the server core (task C3): runCall on the memory data (server/core/memoryData.ts), with no database.
 * server/it/runCall.it.test.ts runs the same rules on the local database through the real office cache, loaders and save step.
 */

const TODAY = '2026-10-04';
const NOW = new Date('2026-10-04T06:00:00Z');
const ADMIN = 'usr_001';
const AGENT = 'usr_009';
const HIDDEN = 'Something went wrong. Try again.';

let seed: State;
beforeAll(async () => {
  seed = await buildSeed(TODAY, async () => undefined);
});

const undo: (() => void)[] = [];
afterEach(() => {
  while (undo.length > 0) undo.pop()!();
});

const principal = (userId: string): Principal => (userId === AGENT ? { userId, agent: { clientId: 'cli-test' } } : { userId });
const newBatch = (): BatchScope => ({ storyRefs: new Map(), overviewCalls: 0 });

type Setup = {
  mem: MemoryData;
  deps: FakeDeps;
  call(userId: string, name: string, input: unknown, more?: Partial<RunRequest>): Promise<RunResult>;
  /** Changes the committed office between calls, as another isolate's commit would, and raises the office version. */
  edit(change: (state: State) => void): void;
};

function setup(o: Omit<RunCallOptions, 'data'> & { wrap?: (data: CallData) => CallData } = {}): Setup {
  const mem = memoryData(seed);
  const deps = fakeDeps({ db: mem.db });
  deps.clock.set(NOW);
  const run = createRunCall({ ...o, data: () => (o.wrap ? o.wrap(mem.data()) : mem.data()) });
  return {
    mem,
    deps,
    call: (userId, name, input, more = {}) => run(deps, { principal: principal(userId), name, input, batch: newBatch(), ...more }),
    edit(change) {
      change(mem.tables.state);
      mem.tables.version += 1;
    },
  };
}

/** The call map with one shared call replaced by another definition (same name, so the same loader). */
function mapWith(name: string, def: AnyCall, hooks?: SharedEntry['hooks']): ReadonlyMap<string, CallEntry> {
  const map = new Map(serverCallMap);
  map.set(name, { kind: 'shared', name, def, input: def.input, readOnly: def.readOnly === true, ...(hooks ? { hooks } : {}) });
  return map;
}

function okOutput<T = Record<string, unknown>>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

function errorOf(result: RunResult) {
  if (result.ok) throw new Error('The call did not fail.');
  return result.error;
}

describe('runCall: finding and parsing the call (plan 4.5, steps 1 and 2)', () => {
  it('answers not_found for an unknown call and for a call that the server leaves out', async () => {
    const { call } = setup();
    expect(errorOf(await call(ADMIN, 'nope.call', {})).code).toBe('not_found');
    expect(errorOf(await call(ADMIN, 'files.get', { id: 'fil_001' })).code).toBe('not_found');
    expect(errorOf(await call(ADMIN, 'session.previewAs', { userId: 'usr_002' })).code).toBe('not_found');
  });

  it('refuses a wrong input with invalid_input and the fields, as the fake API does', async () => {
    const { call, mem } = setup();
    // A task with no project is an office task (owner, 2026-10-06), so the wrong input is a project id of the wrong form.
    const error = errorOf(await call(ADMIN, 'tasks.create', { projectId: 'project-1', title: 'Wrong project id' }));
    expect(error.code).toBe('invalid_input');
    expect(error.details?.fields).toContain('projectId');
    expect(mem.txCount).toEqual({ read: 0, write: 0 });
  });
});

describe('runCall: reads and writes', () => {
  it('runs a read in one read transaction, with no story and no change', async () => {
    const { call, mem, deps } = setup();
    const result = await call(ADMIN, 'users.list', {});
    expect(okOutput<unknown[]>(result)).toHaveLength(Object.keys(seed.users).length);
    expect(result).toMatchObject({ ok: true, changed: false });
    expect('storyId' in result).toBe(false);
    expect(mem.txCount).toEqual({ read: 1, write: 0 });
    expect(deps.signal.sent).toEqual([]);
  });

  it('runs a write under a new server story, saves it, and sends its signals inside the transaction', async () => {
    const { call, mem, deps } = setup();
    const leader = seed.projects.prj_001.leaderId!;
    const result = await call(leader, 'tasks.create', { projectId: 'prj_001', title: 'From the server' });
    const { task } = okOutput<{ task: { id: string } }>(result);
    if (!result.ok) return;
    expect(result.storyId).toMatch(/^sty_[a-z2-7]{22}$/);
    expect(result.changed).toBe(true);
    expect(mem.tables.state.tasks[task.id].title).toBe('From the server');
    expect(Object.values(mem.tables.state.events).filter((e) => e.correlationId === result.storyId).length).toBeGreaterThan(0);
    expect(mem.tables.stories.get(result.storyId!)).toEqual({ actorId: leader, createdAt: NOW });
    expect(deps.signal.sent.map((s) => s.channel)).toContain('office');
    expect(deps.signal.sent.every((s) => s.storyId === result.storyId && s.actorId === leader)).toBe(true);
    expect(result.signals?.map((s) => s.channel)).toEqual(['office']);
    expect(result.signals?.[0].projects).toEqual(['prj_001']);
  });

  it('gives only the actor\'s own signals back: the office signal and the actor\'s person signal, never another person\'s', async () => {
    const { call, deps } = setup();
    const notice = Object.values(seed.notifications).find((n) => !n.read)!;
    const result = await call(notice.userId, 'notifications.markRead', { ids: [notice.id] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A read mark changes no event, so the call counts as unchanged, as in the fake API.
    expect(result.changed).toBe(false);
    expect(deps.signal.sent.map((s) => s.channel)).toEqual([`person:${notice.userId}`]);
    expect(result.signals?.map((s) => s.channel)).toEqual([`person:${notice.userId}`]);
  });

  it('sends the person signal of a notice for another person, and keeps it out of the actor\'s own signals', async () => {
    const { call, deps } = setup();
    const leader = seed.projects.prj_001.leaderId!;
    const owner = Object.values(seed.members).find((m) => m.projectId === 'prj_001' && m.userId !== leader && seed.users[m.userId]?.active)!.userId;
    const result = await call(leader, 'tasks.create', { projectId: 'prj_001', title: 'For a team member', ownerId: owner });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deps.signal.sent.map((s) => s.channel)).toContain(`person:${owner}`);
    expect(result.signals?.map((s) => s.channel)).toEqual(['office']);
  });

  it('stamps a write with the time after the office lock, so the stamps follow the commit order', async () => {
    const after = new Date(NOW.getTime() + 5_000);
    const preflightAt: Date[] = [];
    const real = sharedCalls['clients.create'] as AnyCall;
    const holder: { deps?: FakeDeps } = {};
    const s = setup({
      calls: mapWith('clients.create', real, { preflight: async (_input, ctx) => void preflightAt.push(ctx.now) }),
      // Another write holds the lock for 5 seconds: the clock moves while this call waits.
      wrap: (data) => ({ office: data.office, tx: (mode, work) => data.tx(mode, (t) => work({ ...t, lock: async () => holder.deps!.clock.advance(5_000) })) }),
    });
    holder.deps = s.deps;
    const result = await s.call(ADMIN, 'clients.create', { name: 'Waited' }, { key: 'key-late' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(preflightAt).toEqual([NOW]);
    const events = Object.values(s.mem.tables.state.events).filter((e) => e.correlationId === result.storyId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.createdAt === nowStamp(after))).toBe(true);
    expect(s.mem.tables.stories.get(result.storyId!)?.createdAt).toEqual(after);
    expect(s.mem.tables.keys.get(`${ADMIN}|key-late`)?.at).toEqual(after);
  });
});

describe('runCall: the actor (plan 4.5, the actor; TM 7 suite 2)', () => {
  it('lets an agent act with its person\'s rights, and records the agent as the actor', async () => {
    const { call, mem } = setup();
    // Only an Admin may add a client; the agent's person usr_001 is the Admin.
    const result = await call(AGENT, 'clients.create', { name: 'Agent client' });
    const client = okOutput<{ id: string }>(result);
    const event = Object.values(mem.tables.state.events).find((e) => e.targetId === client.id)!;
    expect([event.actorId, event.actingForId, event.actorKind]).toEqual([AGENT, ADMIN, 'agent']);
  });

  it('refuses an agent whose person is turned off, and a person who is turned off, with account_off', async () => {
    const { call, edit } = setup();
    edit((state) => {
      state.users.usr_005.active = false;
    });
    for (const [userId, name, input] of [['usr_005', 'users.list', {}], ['usr_005', 'tasks.create', { projectId: 'prj_001', title: 'X' }]] as const) {
      const error = errorOf(await call(userId, name, input));
      expect([error.code, error.details?.reason], name).toEqual(['unauthenticated', 'account_off']);
    }
    edit((state) => {
      state.users[ADMIN].active = false;
    });
    const error = errorOf(await call(AGENT, 'users.list', {}));
    expect([error.code, error.details?.reason]).toEqual(['unauthenticated', 'account_off']);
  });

  it('checks the actor on every call, so a person turned off between two calls of one batch is refused at the second', async () => {
    const { call, edit } = setup();
    const batch = newBatch();
    expect((await call('usr_005', 'users.list', {}, { batch })).ok).toBe(true);
    edit((state) => {
      state.users.usr_005.active = false;
    });
    expect(errorOf(await call('usr_005', 'users.list', {}, { batch })).details?.reason).toBe('account_off');
  });
});

describe('runCall: a failed call writes nothing (plan 4.5, step 5.11)', () => {
  const writesAClient = (output: unknown) => defineCall({
    input: z.object({ name: z.string() }),
    output: z.object({ id: z.string() }),
    run: (input, ctx) => {
      ctx.state.clients.cli_999 = { id: 'cli_999', name: input.name, nameAr: '', contactName: '', phone: '', email: '' } as never;
      ctx.state.counters.cli = 999;
      return output as never;
    },
  });

  it('rolls back a call whose output has the wrong shape: no record, no counter, no story, no signal', async () => {
    const { call, mem, deps } = setup({ calls: mapWith('clients.create', writesAClient({ id: 42 })) });
    const before = mem.tables;
    const error = errorOf(await call(ADMIN, 'clients.create', { name: 'Broken' }));
    expect(error.code).toBe('failed');
    expect(error.message).toMatch(/wrong shape/);
    expect(mem.tables).toBe(before);
    expect(mem.tables.state.clients.cli_999).toBeUndefined();
    expect(mem.tables.stories.size).toBe(0);
    expect(deps.signal.sent).toEqual([]);
  });

  it('keeps the office unchanged after a call that adds a member and then throws; the next call does not see the member', async () => {
    const addsThenThrows = defineCall({
      input: z.object({ projectId: z.string(), userId: z.string() }),
      output: z.object({}),
      run: (input, ctx) => {
        ctx.state.members[`${input.projectId}:${input.userId}`] = { projectId: input.projectId, userId: input.userId, discipline: 'X', addedAt: ctx.stamp } as never;
        throw new ApiError('conflict', 'Stopped after the change.');
      },
    });
    const { call, mem } = setup({ calls: mapWith('members.add', addsThenThrows) });
    const batch = newBatch();
    expect((await call(ADMIN, 'users.list', {}, { batch })).ok).toBe(true);
    const office = batch.office!;
    expect(errorOf(await call(ADMIN, 'members.add', { projectId: 'prj_001', userId: 'usr_011' }, { batch })).code).toBe('conflict');
    expect(batch.office).toBe(office);
    expect(await mem.data().office()).toBe(office);
    expect(office.lists.members['prj_001:usr_011']).toBeUndefined();
    const detail = okOutput<{ members: { user: { id: string } }[] }>(await call(ADMIN, 'projects.get', { id: 'prj_001' }, { batch }));
    expect(detail.members.map((m) => m.user.id)).not.toContain('usr_011');
  });

  it('hides an error that is not an ApiError, and logs it with the call name', async () => {
    const crashes = defineCall({ input: z.object({}), output: z.object({}), readOnly: true, run: () => {
      throw new Error('a bug with private words');
    } });
    const { call, deps } = setup({ calls: mapWith('users.list', crashes) });
    expect(errorOf(await call(ADMIN, 'users.list', {}))).toEqual({ code: 'failed', message: HIDDEN });
    expect(deps.logs).toEqual([{ level: 'error', message: 'A call failed.', fields: { name: 'users.list', error: 'a bug with private words' } }]);
  });

  it('turns a lock timeout into failed with the reason busy, and logs no error', async () => {
    const timeout = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    const { call, deps } = setup({
      wrap: (data) => ({
        office: data.office,
        tx: (mode, work) => data.tx(mode, (t) => work({ ...t, lock: () => Promise.reject(timeout) })),
      }),
    });
    const error = errorOf(await call(ADMIN, 'clients.create', { name: 'Busy' }));
    expect([error.code, error.details?.reason]).toEqual(['failed', 'busy']);
    expect(deps.logs.filter((line) => line.level === 'error')).toEqual([]);
    // The call never held the lock, so it logs no hold time.
    expect(deps.logs.filter((line) => line.message.startsWith('The call held the office lock'))).toEqual([]);
  });
});

describe('runCall: the office of a batch (plan 4.7)', () => {
  it('lets a batch entry after an office write see that write, and drops the batch office after it', async () => {
    const { call } = setup();
    const batch = newBatch();
    expect((await call(ADMIN, 'clients.list', {}, { batch })).ok).toBe(true);
    const first = batch.office!;
    const created = okOutput<{ id: string }>(await call(ADMIN, 'clients.create', { name: 'Seen at once' }, { batch }));
    expect(batch.office).toBeUndefined();
    const list = okOutput<{ id: string }[]>(await call(ADMIN, 'clients.list', {}, { batch }));
    expect(list.map((c) => c.id)).toContain(created.id);
    expect(batch.office!.version).toBeGreaterThan(first.version);
  });

  it('keeps the batch office after a write that changed no office table, and drops it after a project touch', async () => {
    const { call } = setup();
    const batch = newBatch();
    const notice = Object.values(seed.notifications).find((n) => !n.read)!;
    await call(notice.userId, 'users.list', {}, { batch });
    const office = batch.office;
    expect((await call(notice.userId, 'notifications.markRead', { ids: [notice.id] }, { batch })).ok).toBe(true);
    expect(batch.office).toBe(office);
    // A new task touches its project's updatedAt, which the project index of the office holds (plan 4.7).
    const leader = seed.projects.prj_001.leaderId!;
    expect((await call(leader, 'tasks.create', { projectId: 'prj_001', title: 'A project touch' }, { batch })).ok).toBe(true);
    expect(batch.office).toBeUndefined();
  });
});

describe('runCall: story IDs only from the server (plan 4.9)', () => {
  it('accepts a story from story.start for the same actor, and every event of the write carries it', async () => {
    const { call, mem } = setup();
    const story = okOutput<{ storyId: string }>(await call(ADMIN, 'story.start', {}));
    expect(story.storyId).toMatch(/^sty_/);
    const result = await call(ADMIN, 'clients.create', { name: 'In my story' }, { story: { id: story.storyId } });
    expect(result).toMatchObject({ ok: true, storyId: story.storyId, changed: true });
    const client = okOutput<{ id: string }>(result);
    expect(Object.values(mem.tables.state.events).find((e) => e.targetId === client.id)?.correlationId).toBe(story.storyId);
  });

  it('refuses a story of another actor, a made-up story, and a story 24 hours old, with story_not_yours', async () => {
    const { call, deps } = setup();
    const story = okOutput<{ storyId: string }>(await call(ADMIN, 'story.start', {}));
    for (const [userId, id] of [['usr_010', story.storyId], [ADMIN, 'cor_made_up_1']] as const) {
      const error = errorOf(await call(userId, 'clients.create', { name: 'X' }, { story: { id } }));
      expect([error.code, error.details?.reason]).toEqual(['forbidden', 'story_not_yours']);
    }
    deps.clock.advance(STORY_LIFE_MS);
    const error = errorOf(await call(ADMIN, 'clients.create', { name: 'X' }, { story: { id: story.storyId } }));
    expect(error.details?.reason).toBe('story_not_yours');
  });

  it('maps a browser placeholder once for each batch, and not after a call that failed', async () => {
    const { call, mem } = setup();
    const batch = newBatch();
    const refused = await call(ADMIN, 'clients.update', { id: 'cli_404', patch: { name: 'X' } }, { batch, story: { ref: 'cor_ui_1' } });
    expect(refused.ok).toBe(false);
    expect(batch.storyRefs.size).toBe(0);
    const a = await call(ADMIN, 'clients.create', { name: 'One' }, { batch, story: { ref: 'cor_ui_1' } });
    const b = await call(ADMIN, 'clients.create', { name: 'Two' }, { batch, story: { ref: 'cor_ui_1' } });
    expect(a.ok && b.ok && a.storyId === b.storyId).toBe(true);
    expect(batch.storyRefs.get('cor_ui_1')).toBe(a.ok ? a.storyId : undefined);
    const other = await call(ADMIN, 'clients.create', { name: 'Three' }, { story: { ref: 'cor_ui_1' } });
    expect(other.ok && a.ok && other.storyId !== a.storyId).toBe(true);
    expect(mem.tables.stories.size).toBe(2);
  });
});

describe('runCall: idempotency keys (plan 4.10)', () => {
  it('runs nothing for a repeated key with the same input, and gives the stored answer', async () => {
    const { call, mem, deps } = setup();
    const first = await call(ADMIN, 'clients.create', { name: 'Once' }, { key: 'key-1' });
    const clients = Object.keys(mem.tables.state.clients).length;
    const signals = deps.signal.sent.length;
    const again = await call(ADMIN, 'clients.create', { name: 'Once' }, { key: 'key-1' });
    expect(again.ok && first.ok).toBe(true);
    if (!again.ok || !first.ok) return;
    expect([again.output, again.storyId, again.changed]).toEqual([first.output, first.storyId, first.changed]);
    expect(Object.keys(mem.tables.state.clients).length).toBe(clients);
    expect(deps.signal.sent.length).toBe(signals);
  });

  it('gives key_reused for the same key with another input, and keeps the key for one actor only', async () => {
    const { call } = setup();
    await call(ADMIN, 'clients.create', { name: 'Once' }, { key: 'key-2' });
    const error = errorOf(await call(ADMIN, 'clients.create', { name: 'Other' }, { key: 'key-2' }));
    expect([error.code, error.details?.reason]).toEqual(['conflict', 'key_reused']);
    expect((await call(AGENT, 'clients.create', { name: 'Other' }, { key: 'key-2' })).ok).toBe(true);
  });

  it('stores nothing for a call that failed, so a Retry with the key runs again', async () => {
    const { call } = setup();
    const refused = await call(ADMIN, 'clients.update', { id: 'cli_404', patch: { name: 'X' } }, { key: 'key-3' });
    expect(errorOf(refused).code).toBe('not_found');
    expect(errorOf(await call(ADMIN, 'clients.update', { id: 'cli_404', patch: { name: 'X' } }, { key: 'key-3' })).code).toBe('not_found');
  });

  it('maps the placeholder of a replayed write to its stored story, so the next entry of the batch joins that story', async () => {
    const { call, mem } = setup();
    const first = await call(ADMIN, 'clients.create', { name: 'A' }, { key: 'key-r', story: { ref: 'cor_ui_x' } });
    const batch = newBatch();
    const again = await call(ADMIN, 'clients.create', { name: 'A' }, { batch, key: 'key-r', story: { ref: 'cor_ui_x' } });
    const next = await call(ADMIN, 'clients.create', { name: 'B' }, { batch, story: { ref: 'cor_ui_x' } });
    expect(first.ok && again.ok && next.ok).toBe(true);
    if (!first.ok || !again.ok || !next.ok) return;
    expect(again.storyId).toBe(first.storyId);
    expect(batch.storyRefs.get('cor_ui_x')).toBe(first.storyId);
    expect(next.storyId).toBe(first.storyId);
    expect(mem.tables.stories.size).toBe(1);
  });
});

describe('runCall: hooks and effects (plan 4.5, steps 5.1, 5.5 and 6; plan 4.12)', () => {
  it('runs the preflight before the lock, the prepare inside it, and gives run() the prepared value', async () => {
    const order: string[] = [];
    const real = sharedCalls['clients.create'] as AnyCall;
    const def = defineCall({
      input: real.input, output: real.output,
      run: (input, ctx, prepared: unknown) => {
        order.push(`run ${String(prepared)}`);
        return real.run(input, ctx, undefined);
      },
    });
    const hooks = {
      preflight: async () => {
        order.push('preflight');
        return 7;
      },
      prepare: async (_input: unknown, _ctx: unknown, pre: unknown) => {
        order.push(`prepare ${String(pre)}`);
        return Number(pre) * 2;
      },
    };
    const { call } = setup({
      calls: mapWith('clients.create', def as AnyCall, hooks),
      wrap: (data) => ({ office: data.office, tx: (mode, work) => data.tx(mode, (t) => work({ ...t, lock: async () => void order.push('lock') })) }),
    });
    expect((await call(ADMIN, 'clients.create', { name: 'Hooked' })).ok).toBe(true);
    expect(order).toEqual(['preflight', 'lock', 'prepare 7', 'run 14']);
  });

  it('never runs a preflight for an actor that is turned off', async () => {
    let ran = false;
    const real = sharedCalls['clients.create'] as AnyCall;
    const { call, edit } = setup({ calls: mapWith('clients.create', real, { preflight: async () => {
      ran = true;
    } }) });
    edit((state) => {
      state.users.usr_005.active = false;
    });
    expect(errorOf(await call('usr_005', 'clients.create', { name: 'X' })).details?.reason).toBe('account_off');
    expect(ran).toBe(false);
  });

  it('writes the outbox rows of the call in its transaction and runs them after the commit; a failed call leaves none', async () => {
    const ran: string[][] = [];
    undo.push(registerOutbox('clients.create', async (output) => [{ kind: 'test.client', payload: { id: (output as { id: string }).id } }]));
    const { call, mem } = setup({ afterCommit: async (_deps, ids) => void ran.push(ids) });
    const created = okOutput<{ id: string }>(await call(ADMIN, 'clients.create', { name: 'With an effect' }));
    expect(mem.tables.outbox).toEqual([{ id: '1', kind: 'test.client', payload: { id: created.id } }]);
    expect(ran).toEqual([['1']]);
    const failing = defineCall({ input: z.object({ name: z.string() }), output: z.object({ id: z.string() }), run: () => {
      throw new ApiError('conflict', 'No.');
    } });
    expect((await createRunCall({ calls: mapWith('clients.create', failing), data: () => mem.data(), afterCommit: async (_d, ids) => void ran.push(ids) })(
      fakeDeps({ db: mem.db }), { principal: principal(ADMIN), name: 'clients.create', input: { name: 'Refused' }, batch: newBatch() },
    )).ok).toBe(false);
    expect(mem.tables.outbox).toHaveLength(1);
    expect(ran).toHaveLength(1);
  });

  it('answers USER_EMAIL_CHANGED_SQL from memory, so users.update writes the auth.email row only for an email change (P2)', async () => {
    const { call, mem } = setup();
    const emailRows = () => mem.tables.outbox.filter((row) => row.kind === 'auth.email' && row.payload.userId === 'usr_005');
    expect(okOutput(await call(ADMIN, 'users.update', { id: 'usr_005', patch: { name: 'A new name' } })).name).toBe('A new name');
    expect(emailRows()).toEqual([]);
    okOutput(await call(ADMIN, 'users.update', { id: 'usr_005', patch: { email: 'new.address@madar.test' } }));
    expect(emailRows()).toHaveLength(1);
    // The last user.updated event of the person counts: a name change after the email change writes no second row.
    okOutput(await call(ADMIN, 'users.update', { id: 'usr_005', patch: { name: 'Another name' } }));
    expect(emailRows()).toHaveLength(1);
  });

  it('keeps the answer of a committed call when the effects after the commit fail, and logs a warning', async () => {
    undo.push(registerOutbox('clients.create', async () => [{ kind: 'test.client', payload: {} }]));
    const { call, deps } = setup({ afterCommit: async () => {
      throw new Error('the outbox table is gone');
    } });
    expect((await call(ADMIN, 'clients.create', { name: 'Still saved' })).ok).toBe(true);
    expect(deps.logs.some((line) => line.level === 'warn' && line.fields?.name === 'clients.create')).toBe(true);
  });

  describe('the mail effects after the answer (performance audit SRV-1, BGR-2)', () => {
    /** clients.create writes an auth.invite row and then a mail.notice row; afterCommit records each call, and mail work waits for open(). */
    function mailSetup() {
      undo.push(registerOutbox('clients.create', async (output) => [
        { kind: 'auth.invite', payload: { id: (output as { id: string }).id } },
        { kind: 'mail.notice', payload: { notificationId: 'ntf_900' } },
      ]));
      const ran: string[][] = [];
      const ended: string[][] = [];
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const holder: { mem?: MemoryData } = {};
      const kindOf = (id: string) => holder.mem!.tables.outbox.find((row) => row.id === id)?.kind;
      const built = setup({ afterCommit: async (_deps, ids) => {
        ran.push(ids);
        if (ids.some((id) => kindOf(id) === 'mail.notice')) await gate;
        ended.push(ids);
      } });
      holder.mem = built.mem;
      return { ...built, ran, ended, open: () => open() };
    }

    it('hands the mail rows to after and answers before they end; every other row still runs before the answer', async () => {
      const h = mailSetup();
      const later: Promise<unknown>[] = [];
      const result = await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => h.call(ADMIN, 'clients.create', { name: 'With mail' }));
      expect(result.ok).toBe(true);
      expect(h.mem.tables.outbox.map((row) => [row.id, row.kind])).toEqual([['1', 'auth.invite'], ['2', 'mail.notice']]);
      expect(h.ended).toEqual([['1']]);
      expect(h.ran).toEqual([['1'], ['2']]);
      expect(later).toHaveLength(1);
      h.open();
      await Promise.all(later);
      expect(h.ended).toEqual([['1'], ['2']]);
    });

    it('runs every row before the answer, in one call and in row order, when the host has no after (as before)', async () => {
      const h = mailSetup();
      h.open();
      expect((await h.call(ADMIN, 'clients.create', { name: 'No host' })).ok).toBe(true);
      expect(h.ended).toEqual([['1', '2']]);
    });

    it('keeps the mails of one batch in the order of its entries: the mail work of an entry waits for the one before', async () => {
      const h = mailSetup();
      const later: Promise<unknown>[] = [];
      const batch = newBatch();
      await runInHost({ host: 'workers', after: (work) => void later.push(work) }, async () => {
        for (const name of ['First', 'Second']) expect((await h.call(ADMIN, 'clients.create', { name }, { batch })).ok).toBe(true);
      });
      // The second mail has not started: it waits on the chain behind the first, which waits on the gate.
      expect(h.ran).toEqual([['1'], ['2'], ['3']]);
      h.open();
      await Promise.all(later);
      expect(h.ran).toEqual([['1'], ['2'], ['3'], ['4']]);
      expect(h.ended).toEqual([['1'], ['3'], ['2'], ['4']]);
    });

    it('hands a push.notify row to after like a mail, and runs it before the answer when the host has no after (owner, 2026-10-08)', async () => {
      undo.push(registerOutbox('clients.create', async () => [{ kind: 'push.notify', payload: { userId: 'usr_002' } }]));
      const ran: string[][] = [];
      const { call } = setup({ afterCommit: async (_deps, ids) => void ran.push(ids) });
      const later: Promise<unknown>[] = [];
      expect((await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => call(ADMIN, 'clients.create', { name: 'With push' }))).ok).toBe(true);
      expect(later).toHaveLength(1);
      await Promise.all(later);
      expect(ran).toEqual([['1']]);
      expect((await call(ADMIN, 'clients.create', { name: 'No host' })).ok).toBe(true);
      expect(ran).toEqual([['1'], ['2']]);
    });

    it('waits CHAT_WAIT_MS after the answer for a push.chat or mail.chatNotice row, on a chain of its own (item 20)', async () => {
      undo.push(registerOutbox('clients.create', async () => [
        { kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_002', items: [] } },
        { kind: 'mail.notice', payload: { notificationId: 'ntf_900' } },
        { kind: CHAT_NOTICE_EFFECT, payload: { notificationId: 'ntf_901' } },
      ]));
      const ran: string[][] = [];
      const waits: number[] = [];
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const { call } = setup({ afterCommit: async (_deps, ids) => void ran.push(ids), wait: (ms) => { waits.push(ms); return gate; } });
      const later: Promise<unknown>[] = [];
      expect((await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => call(ADMIN, 'clients.create', { name: 'With a chat push' }))).ok).toBe(true);
      expect(waits).toEqual([10_000]);
      expect(later).toHaveLength(2);
      await later[0];
      expect(ran).toEqual([['2']]);
      open();
      await Promise.all(later);
      expect(ran).toEqual([['2'], ['1', '3']]);
    });

    it('runs a waited row before the answer, with no wait, when the host has no after', async () => {
      undo.push(registerOutbox('clients.create', async () => [{ kind: PUSH_CHAT_EFFECT, payload: { userId: 'usr_002', items: [] } }]));
      const ran: string[][] = [];
      const waits: number[] = [];
      const { call } = setup({ afterCommit: async (_deps, ids) => void ran.push(ids), wait: async (ms) => void waits.push(ms) });
      expect((await call(ADMIN, 'clients.create', { name: 'No host' })).ok).toBe(true);
      expect([waits, ran]).toEqual([[], [['1']]]);
    });

    it('logs the same warning when the mail work fails after the answer, and the answer stays', async () => {
      undo.push(registerOutbox('clients.create', async () => [{ kind: 'mail.notice', payload: {} }]));
      const { call, deps } = setup({ afterCommit: async () => {
        throw new Error('Resend is down');
      } });
      const later: Promise<unknown>[] = [];
      expect((await runInHost({ host: 'workers', after: (work) => void later.push(work) }, () => call(ADMIN, 'clients.create', { name: 'Kept' }))).ok).toBe(true);
      await Promise.all(later);
      expect(deps.logs).toContainEqual({
        level: 'warn', message: 'The effects after the commit did not run. The job tries them again.', fields: { name: 'clients.create', error: 'Resend is down' },
      });
    });
  });

  it('gives the save a before whose office lists are the frozen snapshot, and a copy of the rest (performance audit SRV-8, DB-7)', async () => {
    const seen: { before: State; after: State; frozenDiff: string; copiedDiff: string }[] = [];
    const { call, mem } = setup({ wrap: (data) => ({
      ...data,
      tx: (mode, work) => data.tx(mode, (t) => work({
        ...t,
        save: async (before, after, o) => {
          // The same Diff as with a deep copy of the State (the form before the audit).
          const text = (d: ReturnType<typeof diffState>) => JSON.stringify({ ...d, tables: d.tables.map((c) => ({ ...c, spec: c.spec.table })) }, (_k, v) => (v instanceof Set ? [...v].sort() : v));
          seen.push({ before, after, frozenDiff: text(diffState(before, after)), copiedDiff: text(diffState(structuredClone(before), after)) });
          return t.save(before, after, o);
        },
      })),
    }) });
    const task = Object.values(seed.tasks).find((t) => t.projectId === 'prj_001' && t.status !== 'done')!;
    okOutput(await call(ADMIN, 'tasks.update', { id: task.id, patch: { title: 'Roof plan' } }));
    okOutput(await call(ADMIN, 'members.update', { projectId: 'prj_001', userId: 'usr_005', discipline: 'Interiors' }));
    const stages = Object.values(mem.tables.state.stages).filter((stage) => stage.projectId === 'prj_001');
    okOutput(await call(ADMIN, 'stages.replace', { projectId: 'prj_001', stages: stages.map((stage, i) => ({
      id: stage.id, name: i === 0 ? 'Concept again' : stage.name, startDate: stage.startDate ?? null, endDate: stage.endDate ?? null,
    })) }));
    expect(seen).toHaveLength(3);
    for (const { before, after, frozenDiff, copiedDiff } of seen) {
      expect(frozenDiff).toBe(copiedDiff);
      expect(Object.isFrozen(before.members)).toBe(true);
      expect(Object.isFrozen(after.members)).toBe(false);
      expect(before.tasks).not.toBe(after.tasks);
      expect(() => {
        (before.users.usr_001 as { name: string }).name = 'No';
      }).toThrow(TypeError);
    }
    expect(seen[0].before.tasks[task.id].title).toBe(task.title);
    expect(seen[0].after.tasks[task.id].title).toBe('Roof plan');
    expect(JSON.parse(seen[1].frozenDiff).tables.map((c: { spec: string }) => c.spec)).toContain('members');
    expect(JSON.parse(seen[2].frozenDiff).tables.map((c: { spec: string }) => c.spec)).toContain('stages');
  });

  it('logs how long each write held the office lock', async () => {
    const { call, deps } = setup();
    await call(ADMIN, 'clients.create', { name: 'Timed' });
    expect(deps.logs).toContainEqual({ level: 'info', message: 'The call held the office lock.', fields: expect.objectContaining({ name: 'clients.create', region: 'eu-central-1' }) });
  });

  it('logs the lock hold of a write that failed after it took the lock', async () => {
    const refuses = defineCall({ input: z.object({ name: z.string() }), output: z.object({ id: z.string() }), run: () => {
      throw new ApiError('conflict', 'No.');
    } });
    const { call, deps } = setup({ calls: mapWith('clients.create', refuses) });
    expect(errorOf(await call(ADMIN, 'clients.create', { name: 'Refused' })).code).toBe('conflict');
    expect(deps.logs).toContainEqual({ level: 'info', message: 'The call held the office lock.', fields: expect.objectContaining({ name: 'clients.create' }) });
  });
});

describe('runCall: the server calls (plan 4.11)', () => {
  it('runs story.start and checks the actor first', async () => {
    const { call, edit } = setup();
    expect((await call(ADMIN, 'story.start', {})).ok).toBe(true);
    edit((state) => {
      state.users.usr_005.active = false;
    });
    expect(errorOf(await call('usr_005', 'story.start', {})).details?.reason).toBe('account_off');
  });

  it('checks the story { id } of a server write as plan 4.9 does: another actor\'s story or an old one is refused', async () => {
    const { call, deps } = setup();
    const story = okOutput<{ storyId: string }>(await call(ADMIN, 'story.start', {}));
    for (const [userId, id] of [['usr_010', story.storyId], [ADMIN, 'cor_made_up_1']] as const) {
      const error = errorOf(await call(userId, 'story.start', {}, { story: { id } }));
      expect([error.code, error.details?.reason]).toEqual(['forbidden', 'story_not_yours']);
    }
    // A server write that is not built yet refuses the foreign story before it gets to its own refusal.
    const stub = errorOf(await call('usr_010', 'agents.remove', { agentId: AGENT }, { story: { id: story.storyId } }));
    expect(stub.details?.reason).toBe('story_not_yours');
    expect((await call(ADMIN, 'story.start', {}, { story: { id: story.storyId } })).ok).toBe(true);
    deps.clock.advance(STORY_LIFE_MS);
    expect(errorOf(await call(ADMIN, 'story.start', {}, { story: { id: story.storyId } })).details?.reason).toBe('story_not_yours');
  });
});

describe('runCall: every call once on the sample office (task C3, done when)', () => {
  it('runs every shared call and story.start with no thrown error other than an ApiError', async () => {
    const { call, deps } = setup();
    const outcomes: Record<string, string> = {};
    for (const item of everyCall(seed)) {
      const result = await call(item.actorId, item.name, item.input);
      outcomes[item.name] = result.ok ? 'ok' : result.error.code;
      if (!result.ok) expect(result.error.message, item.name).not.toBe(HIDDEN);
    }
    expect(Object.keys(outcomes)).toHaveLength(Object.keys(sharedCalls).length + 1);
    expect(deps.logs.filter((line) => line.level === 'error')).toEqual([]);
    // Every call runs its rule to the end, except the named refusals: the 3 hooks not built yet and a few rules of the office.
    expect(Object.fromEntries(Object.entries(outcomes).filter(([, o]) => o !== 'ok'))).toEqual(EXPECTED_REFUSALS);
  }, 30_000);
});
