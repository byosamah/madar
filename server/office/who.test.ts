import { describe, expect, it } from 'vitest';
import type { User } from '../../src/api/contract/entities';
import { buildSeed } from '../../src/data/seed';
import type { OfficeSnapshot } from '../core/types';
import { principalOfWho } from './who';

/** The sample office with one agent of usr_002, as ensureAgentUser makes it. */
async function snapshot(edit: (users: Record<string, User>) => void = () => undefined): Promise<OfficeSnapshot> {
  const seed = await buildSeed('2026-10-04', async () => undefined);
  const owner = seed.users.usr_002;
  seed.users.usr_090 = { ...owner, id: 'usr_090', kind: 'agent', ownerId: 'usr_002', email: 'agent.090@agents.madar.test', name: 'Claude' };
  edit(seed.users);
  return { version: 1, lists: seed } as unknown as OfficeSnapshot;
}

describe('who sends a batch to the office object (server/office/who.ts)', () => {
  it('gives an agent the principal of its agent user with its client', async () => {
    const office = await snapshot();
    expect(principalOfWho({ kind: 'agent', agentUserId: 'usr_090', clientId: 'client-1' }, office)).toEqual({ userId: 'usr_090', agent: { clientId: 'client-1' } });
  });

  it('refuses an agent that is off, and an agent whose person is off, with account_off', async () => {
    const agentOff = await snapshot((users) => void (users.usr_090 = { ...users.usr_090, active: false }));
    expect(() => principalOfWho({ kind: 'agent', agentUserId: 'usr_090', clientId: 'client-1' }, agentOff)).toThrow(expect.objectContaining({ details: { reason: 'account_off' } }));
    const ownerOff = await snapshot((users) => void (users.usr_002 = { ...users.usr_002, active: false }));
    expect(() => principalOfWho({ kind: 'agent', agentUserId: 'usr_090', clientId: 'client-1' }, ownerOff)).toThrow(expect.objectContaining({ details: { reason: 'account_off' } }));
  });

  it('refuses an agent kind that names a person, and a person that does not exist', async () => {
    const office = await snapshot();
    expect(() => principalOfWho({ kind: 'agent', agentUserId: 'usr_002', clientId: 'client-1' }, office)).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() => principalOfWho({ kind: 'agent', agentUserId: 'usr_999', clientId: 'client-1' }, office)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });
});
