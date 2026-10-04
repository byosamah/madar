import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { EFFECTS_OF } from '../core/effects';
import { memoryData } from '../core/memoryData';
import type { Db } from '../core/ports';
import { createRunCall } from '../core/runCall';
import { fakeDeps } from '../test/fakes/deps';
import { REVOKE_ALL_KIND, REVOKE_ALL_SQL, revokeAllRowsOf, runRevokeAll } from './revokeAll';

/**
 * agents.revokeAll (plan 4.12; TASKS, P2 follow-up): when a person is turned off, every agent link of that person is removed, so
 * the agents stay off after the person is turned on again. Each agent must be approved again in its AI app.
 */

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

describe('agents.revokeAll', () => {
  it('is registered for users.deactivate and for the Undo calls, from the module that the call registry imports', async () => {
    await import('../calls/index');
    for (const name of ['users.deactivate', 'events.undo', 'events.undoStory'] as const) {
      expect(EFFECTS_OF[name]?.length, name).toBeGreaterThan(0);
    }
  });

  it('writes one row when a person or an agent is turned off, and none when one is turned on', () => {
    expect(revokeAllRowsOf('users.deactivate', { id: 'usr_002', kind: 'human', active: false })).toEqual([{ kind: REVOKE_ALL_KIND, payload: { userId: 'usr_002' } }]);
    expect(revokeAllRowsOf('users.deactivate', { id: 'usr_009', kind: 'agent', active: false })).toEqual([{ kind: REVOKE_ALL_KIND, payload: { userId: 'usr_009' } }]);
    expect(revokeAllRowsOf('users.reactivate', { id: 'usr_002', kind: 'human', active: true })).toEqual([]);
  });

  it('writes a row for an Undo that turns a person off, once for each person', () => {
    const event = (active: boolean, id = 'usr_002') => ({ event: { targetType: 'user', targetId: id, before: { active: !active }, after: { active } } });
    expect(revokeAllRowsOf('events.undo', event(false))).toEqual([{ kind: REVOKE_ALL_KIND, payload: { userId: 'usr_002' } }]);
    expect(revokeAllRowsOf('events.undo', event(true))).toEqual([]);
    expect(revokeAllRowsOf('events.undoStory', { undone: [event(false), event(false), event(false, 'usr_003')] })).toEqual([
      { kind: REVOKE_ALL_KIND, payload: { userId: 'usr_002' } }, { kind: REVOKE_ALL_KIND, payload: { userId: 'usr_003' } },
    ]);
  });

  it('puts the row in the outbox of users.deactivate, in the call\'s own transaction', async () => {
    await import('../calls/index');
    const mem = memoryData(seed);
    const deps = fakeDeps({ db: mem.db });
    const ran: string[][] = [];
    const run = createRunCall({ data: () => mem.data(), afterCommit: async (_d, ids) => void ran.push(ids) });
    const result = await run(deps, { principal: { userId: 'usr_001' }, name: 'users.deactivate', input: { id: 'usr_005' }, batch: { storyRefs: new Map(), overviewCalls: 0 } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(mem.tables.outbox.filter((row) => row.kind === REVOKE_ALL_KIND)).toMatchObject([{ payload: { userId: 'usr_005' } }]);
    expect(ran.flat().length).toBeGreaterThan(0);
  });

  it('removes the links in one statement that reads the person again, so a person who is on again keeps the links', async () => {
    const seen: { text: string; values: unknown[] }[] = [];
    const db = { statement: async (_mode: string, text: string, values: unknown[] = []) => { seen.push({ text, values }); return []; } } as unknown as Db;
    await runRevokeAll({ userId: 'usr_005' }, { ...fakeDeps(), db });
    expect(seen).toEqual([{ text: REVOKE_ALL_SQL, values: ['usr_005'] }]);
    expect(REVOKE_ALL_SQL).toContain('not u.active');
    await expect(runRevokeAll({}, { ...fakeDeps(), db })).rejects.toThrow(/user id/);
  });
});
