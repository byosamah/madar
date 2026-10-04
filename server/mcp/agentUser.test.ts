import { describe, expect, it } from 'vitest';
import { User } from '../../src/api/contract/entities';
import { buildSeed } from '../../src/data/seed';
import { executeParsed } from '../../src/api/execute';
import { AGENT_USER_CREATE, agentNameOf, redirectHostOf } from './agentUser';

/** The parts of ensureAgentUser that need no database. The whole step runs on the local stack in server/it/mcp.it.test.ts. */

describe('the agent user of an approval', () => {
  it('takes the client name of the AI app, trimmed to the 80 characters a name may have', () => {
    expect(agentNameOf('  Claude   Code ')).toBe('Claude Code');
    expect(agentNameOf('x'.repeat(200))).toHaveLength(80);
    expect(agentNameOf(null)).toBe('AI agent');
    expect(agentNameOf('   ')).toBe('AI agent');
  });

  it('takes the host of the first redirect address, without the port, as Auth keeps the list (commas)', () => {
    expect(redirectHostOf('http://127.0.0.1:33418/callback,http://localhost:9/cb')).toBe('127.0.0.1');
    expect(redirectHostOf('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
    expect(redirectHostOf('cursor://anysphere.cursor-retrieval/oauth/callback')).toBe('anysphere.cursor-retrieval');
    expect(redirectHostOf('not a url')).toBe('unknown');
    expect(redirectHostOf('')).toBe('unknown');
  });

  it('makes an agent user of the person: a member with no role of its own, an address that no mail reaches, and a user.created event by the person', async () => {
    const state = await buildSeed('2026-10-04', async () => undefined);
    const owner = state.users.usr_002;
    const now = new Date('2026-10-04T06:00:00Z');
    const created = executeParsed(AGENT_USER_CREATE, 'agents.connect', { name: 'Claude Code' }, state, {
      actorId: owner.id, authorityId: owner.id, correlationId: 'sty_test', now, persistent: true,
    }, undefined) as User;
    expect(User.parse(created)).toEqual(created);
    expect(created).toMatchObject({
      id: 'usr_012', name: 'Claude Code', email: 'usr_012@agents.madar.invalid', kind: 'agent', systemRole: 'member', ownerId: owner.id, active: true,
    });
    expect(created.preferences.language).toBe(owner.preferences.language);
    expect(state.users.usr_012).toEqual(created);
    const event = Object.values(state.events).find((e) => e.targetId === 'usr_012');
    expect(event).toMatchObject({ verb: 'user.created', actorId: owner.id, correlationId: 'sty_test', targetType: 'user' });
  });
});
