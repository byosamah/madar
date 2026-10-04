import { z } from 'zod';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import { defineCall } from '../../src/api/registry';
import { registerEffect, registerOutbox } from '../core/effects';
import { EXPECTED_REFUSALS, everyCall } from '../core/everyCall';
import { createRunCall, runCall } from '../core/runCall';
import type { Principal, RunRequest, RunResult } from '../core/types';
import { readOffice } from '../data/officeCache';
import { mapWith, newBatch, startOffice, type ItOffice } from './runCallOffice';

/**
 * Suite 2 of TM 7 on the local database (plan 4.5; task C3): runCall with the real office cache, SQL loaders, diff writer, story,
 * idempotency and outbox tables, as madar_server with real commits. server/core/runCall.test.ts runs the same rules in memory.
 * The last test runs every call that the server runs once on the sample office. It needs the local stack and the Docker lock.
 */

const ADMIN = 'usr_001';
const AGENT = 'usr_009';
const HIDDEN = 'Something went wrong. Try again.';

const principal = (userId: string): Principal => (userId === AGENT ? { userId, agent: { clientId: 'cli-test' } } : { userId });

function okOf<T = Record<string, unknown>>(result: RunResult): T {
  if (!result.ok) throw new Error(`The call failed: ${result.error.code} ${result.error.message}`);
  return result.output as T;
}

const undo: (() => void)[] = [];
afterEach(() => {
  while (undo.length > 0) undo.pop()!();
});

describe('suite 2: runCall on the local database, as madar_server', () => {
  let office: ItOffice;
  let deps: ReturnType<ItOffice['isolate']>;
  const call = (userId: string, name: string, input: unknown, more: Partial<RunRequest> = {}) =>
    runCall(deps, { principal: principal(userId), name, input, batch: newBatch(), ...more });
  const count = async (table: string) => Number((await office.sql<{ n: string }>(`select count(*) as n from ${table}`))[0].n);
  const meta = async () => (await office.sql<{ version: string; office_seq: string }>('select version, office_seq from office_meta'))[0];

  beforeAll(async () => {
    office = await startOffice('run');
    deps = office.isolate();
  }, 60_000);

  afterAll(async () => {
    await office?.close();
  });

  it('runs a write: the rows, a story of the actor, the events under it, and the signals with the new office_seq', async () => {
    const leader = office.seed.projects.prj_001.leaderId!;
    const result = await call(leader, 'tasks.create', { projectId: 'prj_001', title: 'Saved by runCall' });
    const { task } = okOf<{ task: { id: string } }>(result);
    if (!result.ok) return;
    expect(await office.sql('select doc->>\'title\' as title from tasks where id = $1', [task.id])).toEqual([{ title: 'Saved by runCall' }]);
    expect(await office.sql('select actor_id from stories where id = $1', [result.storyId])).toEqual([{ actor_id: leader }]);
    expect(Number((await office.sql<{ n: string }>('select count(*) as n from events where correlation_id = $1', [result.storyId]))[0].n)).toBeGreaterThan(0);
    const officeSignal = deps.signal.sent.find((s) => s.storyId === result.storyId && s.channel === 'office')!;
    expect(officeSignal.seq).toBe(Number((await meta()).office_seq));
    expect(result.signals).toEqual([officeSignal]);
    expect(result.changed).toBe(true);
  });

  it('runs a read that writes nothing: no story, no change of office_meta', async () => {
    const stories = await count('stories');
    const before = await meta();
    const result = await call('usr_005', 'dashboard.get', {});
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(await count('stories')).toBe(stories);
    expect(await meta()).toEqual(before);
  });

  it('lets an agent act with its person\'s rights', async () => {
    const client = okOf<{ id: string }>(await call(AGENT, 'clients.create', { name: 'Made by the agent' }));
    const [event] = await office.sql<{ doc: { actorId: string; actingForId: string } }>('select doc from events where target_id = $1 order by seq limit 1', [client.id]);
    expect([event.doc.actorId, event.doc.actingForId]).toEqual([AGENT, ADMIN]);
  });

  it('rolls back a wrong output: no row, no counter, no story, no office change', async () => {
    const broken = defineCall({
      input: z.object({ name: z.string() }), output: z.object({ id: z.string() }),
      run: (input, ctx) => {
        ctx.state.clients.cli_999 = { id: 'cli_999', name: input.name, nameAr: '', contactName: '', phone: '', email: '' } as never;
        ctx.state.counters.cli = 999;
        return { id: 42 } as never;
      },
    });
    const [stories, before, counter] = [await count('stories'), await meta(), await office.sql("select n from counters where prefix = 'cli'")];
    const result = await createRunCall({ calls: mapWith('clients.create', broken) })(deps, { principal: { userId: ADMIN }, name: 'clients.create', input: { name: 'Broken' }, batch: newBatch() });
    expect(result.ok ? null : result.error.code).toBe('failed');
    expect(await office.sql("select id from clients where id = 'cli_999'")).toEqual([]);
    expect(await office.sql("select n from counters where prefix = 'cli'")).toEqual(counter);
    expect([await count('stories'), await meta()]).toEqual([stories, before]);
  });

  it('keeps the cache unchanged after a call that adds a member and throws; a second call on the same isolate does not see the member', async () => {
    const addsThenThrows = defineCall({
      input: z.object({ projectId: z.string(), userId: z.string() }), output: z.object({}),
      run: (input, ctx) => {
        ctx.state.members[`${input.projectId}:${input.userId}`] = { projectId: input.projectId, userId: input.userId, discipline: 'X', addedAt: ctx.stamp } as never;
        throw new ApiError('conflict', 'Stopped after the change.');
      },
    });
    const cached = await readOffice(deps);
    const result = await createRunCall({ calls: mapWith('members.add', addsThenThrows) })(deps, { principal: { userId: ADMIN }, name: 'members.add', input: { projectId: 'prj_001', userId: 'usr_011' }, batch: newBatch() });
    expect(result.ok ? null : result.error.code).toBe('conflict');
    expect(await readOffice(deps)).toBe(cached);
    expect(cached.lists.members['prj_001:usr_011']).toBeUndefined();
    const detail = okOf<{ members: { user: { id: string } }[] }>(await call(ADMIN, 'projects.get', { id: 'prj_001' }));
    expect(detail.members.map((m) => m.user.id)).not.toContain('usr_011');
  });

  it('lets a batch entry after an office write see that write', async () => {
    const batch = newBatch();
    okOf(await call(ADMIN, 'clients.list', {}, { batch }));
    const first = batch.office!;
    const created = okOf<{ id: string }>(await call(ADMIN, 'clients.create', { name: 'Seen in the same batch' }, { batch }));
    expect(batch.office).toBeUndefined();
    expect(okOf<{ id: string }[]>(await call(ADMIN, 'clients.list', {}, { batch })).map((c) => c.id)).toContain(created.id);
    expect(batch.office!.version).toBeGreaterThan(first.version);
  });

  it('takes a story from story.start for the same actor only, and maps a placeholder once for each batch', async () => {
    const { storyId } = okOf<{ storyId: string }>(await call(ADMIN, 'story.start', {}));
    expect(await call(ADMIN, 'clients.create', { name: 'Story client' }, { story: { id: storyId } })).toMatchObject({ ok: true, storyId });
    const other = await call('usr_010', 'clients.create', { name: 'Not mine' }, { story: { id: storyId } });
    expect(other.ok ? null : other.error.details?.reason).toBe('story_not_yours');
    const batch = newBatch();
    const a = await call(ADMIN, 'clients.create', { name: 'Ref one' }, { batch, story: { ref: 'cor_ui_it' } });
    const b = await call(ADMIN, 'clients.create', { name: 'Ref two' }, { batch, story: { ref: 'cor_ui_it' } });
    expect(a.ok && b.ok && a.storyId === b.storyId).toBe(true);
  });

  it('stores the answer of a key and replays it; another input with the key gives key_reused', async () => {
    const first = await call(ADMIN, 'clients.create', { name: 'Keyed' }, { key: 'it-key-1' });
    const clients = await count('clients');
    const again = await call(ADMIN, 'clients.create', { name: 'Keyed' }, { key: 'it-key-1' });
    expect(again).toEqual({ ok: true, output: okOf(first), storyId: first.ok ? first.storyId : '', changed: true });
    expect(await count('clients')).toBe(clients);
    expect(await office.sql('select name, actor_id from idempotency where key = $1', ['it-key-1'])).toEqual([{ name: 'clients.create', actor_id: ADMIN }]);
    const reused = await call(ADMIN, 'clients.create', { name: 'Other' }, { key: 'it-key-1' });
    expect(reused.ok ? null : [reused.error.code, reused.error.details?.reason]).toEqual(['conflict', 'key_reused']);
  });

  it('writes the outbox row in the call\'s transaction and runs its effect once after the commit', async () => {
    const ran: unknown[] = [];
    undo.push(registerOutbox('clients.create', async (output) => [{ kind: 'test.it', payload: { id: (output as { id: string }).id } }]));
    undo.push(registerEffect('test.it', async (payload) => void ran.push(payload)));
    const created = okOf<{ id: string }>(await call(ADMIN, 'clients.create', { name: 'With an effect' }));
    expect(ran).toEqual([{ id: created.id }]);
    const rows = await office.sql<{ attempts: number; done: boolean }>("select attempts, done_at is not null as done from outbox where kind = 'test.it'");
    expect(rows).toEqual([{ attempts: 1, done: true }]);
  });

  it('runs every shared call and story.start once on the sample office with no thrown error other than an ApiError', async () => {
    const isolate = office.isolate();
    const outcomes: Record<string, string> = {};
    for (const item of everyCall(office.seed)) {
      const result = await runCall(isolate, { principal: principal(item.actorId), name: item.name, input: item.input, batch: newBatch() });
      outcomes[item.name] = result.ok ? 'ok' : result.error.code;
      if (!result.ok) expect(result.error.message, item.name).not.toBe(HIDDEN);
    }
    expect(isolate.logs.filter((line) => line.level === 'error')).toEqual([]);
    expect(Object.keys(outcomes)).toHaveLength(everyCall(office.seed).length);
    expect(Object.fromEntries(Object.entries(outcomes).filter(([, o]) => o !== 'ok'))).toEqual(EXPECTED_REFUSALS);
  }, 60_000);
});
