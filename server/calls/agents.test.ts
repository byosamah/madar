import { beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../src/api/errors';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { nowStamp } from '../../src/lib/dates';
import { memoryData } from '../core/memoryData';
import type { Db, Query } from '../core/ports';
import type { CallData } from '../core/runCall';
import type { ServerCallCtx } from '../core/types';
import { snapshotOf } from '../data/officeCache';
import { fakeDeps } from '../test/fakes/deps';
import { agentsList, AGENT_LINKS_SQL, createAgentsRemove, REVOKE_AGENT_SQL } from './agents';

/**
 * agents.list and agents.remove (plan 5.6; task G4) on the office in memory and a small agent_links table that answers the
 * exact statements of the calls. server/it/consent.it.test.ts runs them on the local stack.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
let seed: State;
let agentId: string;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
  agentId = Object.values(seed.users).find((user) => user.kind === 'agent' && user.ownerId === 'usr_001')!.id;
});

type Link = { client_id: string; owner_user_id: string; agent_user_id: string; redirect_host: string; approved_at: Date; last_used_at: Date | null; revoked_at: Date | null };

const link = (o: Partial<Link> & Pick<Link, 'client_id'>): Link => ({
  owner_user_id: 'usr_001', agent_user_id: agentId, redirect_host: '127.0.0.1', approved_at: new Date('2026-10-01T06:00:00Z'), last_used_at: null, revoked_at: null, ...o,
});

function setup(links: Link[]) {
  const table = links.map((row) => ({ ...row }));
  const linksQ = (async (text: string, values: unknown[] = []) => {
    if (text === AGENT_LINKS_SQL) return table.filter((row) => row.owner_user_id === values[0]).map((row) => ({ ...row }));
    if (text === REVOKE_AGENT_SQL) {
      for (const row of table) if (row.agent_user_id === values[0] && row.revoked_at === null) row.revoked_at = NOW;
      return [];
    }
    throw new Error(`No answer for: ${text.slice(0, 80)}`);
  }) as Query;
  const db: Db = {
    tx: (_mode, work) => work(linksQ),
    savepoint: (q, work) => work(q),
    statement: (_mode, text, values) => linksQ(text, values) as never,
  };
  const memory = memoryData(seed);
  const data = (): CallData => {
    const base = memory.data();
    return { tx: (mode, work) => base.tx(mode, (t) => work({ ...t, q: linksQ })), office: base.office };
  };
  const deps = fakeDeps({ db });
  deps.clock.set(NOW);
  const remove = createAgentsRemove({ data });
  const ctx = (userId = 'usr_001', more: Partial<ServerCallCtx> = {}): ServerCallCtx => ({
    deps, principal: { userId }, office: snapshotOf(memory.tables.state, memory.tables.version),
    batch: { storyRefs: new Map(), overviewCalls: 0 }, now: NOW, ...more,
  });
  return { table, memory, deps, remove, ctx };
}

async function refusal(work: Promise<unknown>): Promise<ApiError> {
  const error = await work.then(() => null, (e: unknown) => e);
  if (!(error instanceof ApiError)) throw new Error(`It did not refuse with an ApiError: ${String(error)}`);
  return error;
}

describe('agents.list', () => {
  it('lists the agents of the person with the live clients of their links, the newest approval, the last use and the host', async () => {
    const { ctx } = setup([
      link({ client_id: 'c-old', approved_at: new Date('2026-10-01T06:00:00Z'), last_used_at: new Date('2026-10-02T06:00:00Z'), redirect_host: 'old.example' }),
      link({ client_id: 'c-new', approved_at: new Date('2026-10-03T06:00:00Z'), last_used_at: new Date('2026-10-03T07:00:00Z'), redirect_host: 'claude.ai' }),
      link({ client_id: 'c-gone', revoked_at: new Date('2026-10-02T00:00:00Z'), last_used_at: new Date('2026-10-04T05:00:00Z') }),
    ]);
    const { output } = await agentsList({}, ctx());
    expect(output).toEqual([{
      agentId, clientIds: ['c-old', 'c-new'], name: 'Madar Assistant', redirectHost: 'claude.ai',
      approvedAt: nowStamp(new Date('2026-10-03T06:00:00Z')), lastUsedAt: nowStamp(new Date('2026-10-03T07:00:00Z')), active: true,
    }]);
  });

  it('gives an agent with no live link no clients, and shows another person none of these agents', async () => {
    const { ctx } = setup([link({ client_id: 'c-gone', revoked_at: new Date('2026-10-02T00:00:00Z') })]);
    expect((await agentsList({}, ctx())).output).toEqual([{ agentId, clientIds: [], name: 'Madar Assistant', redirectHost: null, approvedAt: null, lastUsedAt: null, active: true }]);
    expect((await agentsList({}, ctx('usr_002'))).output).toEqual([]);
  });
});

describe('agents.remove', () => {
  it('removes every live link of the agent and turns the agent off, with a user.deactivated event by the person and a story', async () => {
    const { table, memory, deps, remove, ctx } = setup([link({ client_id: 'c-1' }), link({ client_id: 'c-2' }), link({ client_id: 'c-other', agent_user_id: 'usr_999' })]);
    const result = await remove({ agentId }, ctx());
    expect(result.output).toEqual({ removed: true });
    expect(result.changed).toBe(true);
    expect(table.filter((row) => row.agent_user_id === agentId).map((row) => row.revoked_at)).toEqual([NOW, NOW]);
    expect(table.find((row) => row.client_id === 'c-other')!.revoked_at).toBeNull();
    expect(memory.tables.state.users[agentId].active).toBe(false);
    const event = Object.values(memory.tables.state.events).find((e) => e.targetId === agentId && e.verb === 'user.deactivated');
    expect(event).toMatchObject({ actorId: 'usr_001', targetType: 'user', correlationId: result.storyId, after: { active: false } });
    expect(deps.signal.sent.length).toBeGreaterThan(0);
  });

  it('removes the links of an agent that is already off, with no second event', async () => {
    const { table, memory, remove, ctx } = setup([link({ client_id: 'c-1' })]);
    memory.tables.state.users[agentId] = { ...memory.tables.state.users[agentId], active: false };
    const events = Object.keys(memory.tables.state.events).length;
    const result = await remove({ agentId }, ctx());
    expect(result).toMatchObject({ output: { removed: true }, changed: false });
    expect(table[0].revoked_at).toEqual(NOW);
    expect(Object.keys(memory.tables.state.events)).toHaveLength(events);
  });

  it('answers a Retry with the same idempotency key from the stored answer, with no second event', async () => {
    const { memory, remove, ctx } = setup([link({ client_id: 'c-1' })]);
    const first = await remove({ agentId }, ctx('usr_001', { key: 'key-1' }));
    const events = Object.keys(memory.tables.state.events).length;
    const again = await remove({ agentId }, ctx('usr_001', { key: 'key-1' }));
    expect(again).toMatchObject({ output: { removed: true }, storyId: first.storyId });
    expect(Object.keys(memory.tables.state.events)).toHaveLength(events);
  });

  it('refuses the agent of another person, a person, and an unknown id', async () => {
    const { table, remove, ctx } = setup([link({ client_id: 'c-1' })]);
    expect((await refusal(remove({ agentId }, ctx('usr_002')))).code).toBe('forbidden');
    expect((await refusal(remove({ agentId: 'usr_002' }, ctx()))).code).toBe('not_found');
    expect((await refusal(remove({ agentId: 'usr_404' }, ctx()))).code).toBe('not_found');
    expect(table[0].revoked_at).toBeNull();
  });
});
