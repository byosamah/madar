import { describe, expect, it } from 'vitest';
import { addSignIn, signinOffice, type TestOffice } from '../auth/own/testOffice';
import type { Deps } from '../core/ports';
import { liteData } from '../data/lite/callData';
import { readLiteOffice } from '../data/lite/office';
import { ensureAgentUser } from './agentUser';
import { offWith } from './aiRoles.testing';
import { sqlMcpLimit } from './app';
import { recordApproval } from './approval';
import { liteAgentOf } from './oauth/agent';

const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

async function approvedClient(t: TestOffice, ownerId = 'usr_002') {
  const authId = await addSignIn(t, ownerId, { password: 'a good password' });
  const clientId = crypto.randomUUID();
  const now = t.deps.clock.now().toISOString();
  t.raw.prepare('insert into oauth_clients (id, name, redirect_uris, created_at) values (?, ?, ?, ?)').run(clientId, 'Claude', JSON.stringify([CALLBACK]), now);
  t.raw.prepare('insert into agent_approvals (client_id, owner_user_id, approved_at) values (?, ?, ?)').run(clientId, ownerId, now);
  t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at, created_at) values (?, ?, ?, 'oauth', ?, '2026-11-17T06:00:00.000Z', ?)").run(`s-${clientId}`, authId, clientId, `h-${clientId}`, now);
  return { authId, clientId, sessionId: `s-${clientId}` };
}

async function linkedAgent(t: TestOffice, ownerId = 'usr_002') {
  const client = await approvedClient(t, ownerId);
  const deps = t.deps as unknown as Deps;
  const made = await ensureAgentUser(deps, { ownerId, clientId: client.clientId, data: liteData(deps) });
  return { ...client, agentId: made.agentUserId };
}

const officeOf = (t: TestOffice) => () => t.db.tx('read', (q) => readLiteOffice(t.db, q));

describe('the agent rows on SQLite (Supabase exit, wave 2)', () => {
  it('links an approved client to a new agent user of the person', async () => {
    const t = await signinOffice();
    const { agentId, clientId } = await linkedAgent(t);
    expect((await officeOf(t)()).lists.users[agentId]).toMatchObject({ kind: 'agent', ownerId: 'usr_002', active: true });
    expect(t.raw.prepare('select owner_user_id, client_name, redirect_host from agent_links where client_id = ?').get(clientId)).toEqual({ owner_user_id: 'usr_002', client_name: 'Claude', redirect_host: 'claude.ai' });
  });

  it('refuses a client that the person did not approve in Madar, and makes no link', async () => {
    const t = await signinOffice();
    const { clientId } = await approvedClient(t);
    t.raw.exec('delete from agent_approvals');
    const deps = t.deps as unknown as Deps;
    await expect(ensureAgentUser(deps, { ownerId: 'usr_002', clientId, data: liteData(deps) })).rejects.toMatchObject({ details: { reason: 'agent_not_approved' } });
    expect(t.raw.prepare('select count(*) as n from agent_links').get()).toEqual({ n: 0 });
  });

  it('agents.list gives the agents of the person with their live clients, and nothing to another person', async () => {
    const t = await signinOffice();
    const { agentId, clientId } = await linkedAgent(t);
    expect(await t.call('usr_002', 'agents.list', {})).toMatchObject({ ok: true, output: [{ agentId, clientIds: [clientId], redirectHost: 'claude.ai', active: true }] });
    const other = await t.call('usr_003', 'agents.list', {});
    expect(other).toMatchObject({ ok: true, output: [] });
    expect(JSON.stringify(other)).not.toContain(clientId);
  });

  it('agents.remove ends the links and the agent sessions, and turns the agent off', async () => {
    const t = await signinOffice();
    const { agentId, sessionId } = await linkedAgent(t);
    expect(await t.call('usr_002', 'agents.remove', { agentId })).toMatchObject({ ok: true, output: { removed: true } });
    expect(t.raw.prepare('select revoked_at from agent_links').get()).toEqual({ revoked_at: '2026-10-17T06:00:00.000Z' });
    expect(t.raw.prepare('select revoked_at from auth_sessions where id = ?').get(sessionId)).toEqual({ revoked_at: '2026-10-17T06:00:00.000Z' });
    expect((await officeOf(t)()).lists.users[agentId].active).toBe(false);
  });

  it('agents.remove of the agent of another person is forbidden and changes nothing', async () => {
    const t = await signinOffice();
    const { agentId } = await linkedAgent(t);
    expect(await t.call('usr_003', 'agents.remove', { agentId })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(t.raw.prepare('select count(*) as n from agent_links where revoked_at is null').get()).toEqual({ n: 1 });
  });

  it('users.deactivate revokes the agent links and sessions inside its own transaction', async () => {
    const t = await signinOffice();
    const { sessionId } = await linkedAgent(t);
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_002' })).ok).toBe(true);
    expect(t.raw.prepare('select revoked_at is not null as gone from agent_links').get()).toEqual({ gone: 1 });
    expect(t.raw.prepare('select revoked_at is not null as gone from auth_sessions where id = ?').get(sessionId)).toEqual({ gone: 1 });
    expect(t.raw.prepare('select count(*) as n from agent_approvals').get()).toEqual({ n: 0 });
    expect(t.raw.prepare("select count(*) as n from outbox where kind = 'agents.revokeAll'").get()).toEqual({ n: 0 });
  });

  it('a refused turn-off revokes nothing', async () => {
    const t = await signinOffice();
    await linkedAgent(t);
    expect((await t.call('usr_005', 'users.deactivate', { id: 'usr_002' })).ok).toBe(false);
    expect(t.raw.prepare('select count(*) as n from agent_links where revoked_at is null').get()).toEqual({ n: 1 });
  });

  it('accepts a live agent session, and refuses a removed link, an ended session and a turned-off person', async () => {
    const t = await signinOffice();
    const { authId, clientId, sessionId, agentId } = await linkedAgent(t);
    const deps = t.deps as unknown as Deps;
    const token = { token: 'x', authUserId: authId, clientId, sessionId };
    expect(await liteAgentOf(deps, token, officeOf(t))).toMatchObject({ principal: { userId: agentId, agent: { clientId } }, ownerId: 'usr_002', linked: false });
    t.raw.prepare('update auth_sessions set revoked_at = ? where id = ?').run('2026-10-17T06:00:00.000Z', sessionId);
    await expect(liteAgentOf(deps, token, officeOf(t))).rejects.toMatchObject({ code: 'unauthenticated' });
    t.raw.prepare('update auth_sessions set revoked_at = null where id = ?').run(sessionId);
    t.raw.prepare('update agent_links set revoked_at = ?').run('2026-10-17T06:00:00.000Z');
    await expect(liteAgentOf(deps, token, officeOf(t))).rejects.toMatchObject({ message: expect.stringContaining('removed') });
  });

  it('links a new approval on the first call, and refuses it for a turned-off person', async () => {
    const t = await signinOffice();
    const { authId, clientId, sessionId } = await approvedClient(t);
    const deps = t.deps as unknown as Deps;
    expect(await liteAgentOf(deps, { token: 'x', authUserId: authId, clientId, sessionId }, officeOf(t))).toMatchObject({ ownerId: 'usr_002', linked: true });
    const second = await approvedClient(t, 'usr_007');
    expect((await t.call('usr_001', 'users.deactivate', { id: 'usr_007' })).ok).toBe(true);
    await expect(liteAgentOf(deps, { token: 'x', authUserId: second.authId, clientId: second.clientId, sessionId: second.sessionId }, officeOf(t))).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('counts the tool calls of a person and notes the last use of the link once a minute', async () => {
    const t = await signinOffice();
    const { clientId } = await linkedAgent(t);
    const deps = t.deps as unknown as Deps;
    const now = new Date('2026-10-17T06:00:30Z');
    expect(await sqlMcpLimit(deps, { ownerId: 'usr_002', clientId, now })).toEqual({ ok: true, count: 1, retryAfterMs: 30_000 });
    expect(t.raw.prepare('select last_used_at from agent_links').get()).toEqual({ last_used_at: '2026-10-17T06:00:30.000Z' });
  });

  it('records the Madar approval only for a pending authorization of the same person', async () => {
    const t = await signinOffice();
    const mine = await addSignIn(t, 'usr_002', { password: 'a good password' });
    const theirs = await addSignIn(t, 'usr_003', { password: 'a good password' });
    t.raw.prepare("insert into oauth_requests (id, client_id, redirect_uri, code_challenge, auth_id, expires_at) values ('req1', 'c1', ?, 'ch', ?, '2026-10-17T06:10:00.000Z')").run(CALLBACK, mine);
    const now = t.deps.clock.now();
    await expect(t.db.tx('write', (q) => recordApproval(q, { authorizationId: 'req1', authUserId: theirs, ownerId: 'usr_003', now }))).rejects.toMatchObject({ details: { reason: 'authorization_ended' } });
    expect(await t.db.tx('write', (q) => recordApproval(q, { authorizationId: 'req1', authUserId: mine, ownerId: 'usr_002', now }))).toEqual({ clientId: 'c1' });
    t.raw.exec("insert into agent_links (client_id, owner_user_id, agent_user_id, client_name, redirect_host, revoked_at) values ('c1', 'usr_002', 'usr_009', 'Claude', 'claude.ai', '2026-10-17T05:00:00.000Z')");
    await expect(t.db.tx('write', (q) => recordApproval(q, { authorizationId: 'req1', authUserId: mine, ownerId: 'usr_002', now }))).rejects.toMatchObject({ details: { reason: 'agent_removed' } });
  });
});

describe('the agent rows and the switch Connect AI assistants (role rights version 2)', () => {
  const connect = async (t: TestOffice, on: boolean) => {
    const done = await t.call('usr_001', 'roles.update', { role: 'member', off: on ? [] : offWith('ai.connect') });
    if (!done.ok) throw new Error(`roles.update failed: ${JSON.stringify(done)}`);
  };

  it('makes no agent user and no link on the first call of a person whose role has ai.connect off, and links it when the switch is on', async () => {
    const t = await signinOffice();
    const { authId, clientId, sessionId } = await approvedClient(t);
    const deps = t.deps as unknown as Deps;
    const users = Object.keys((await officeOf(t)()).lists.users).length;
    await connect(t, false);
    await expect(liteAgentOf(deps, { token: 'x', authUserId: authId, clientId, sessionId }, officeOf(t))).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'ai_off', right: 'ai.connect' } });
    expect(t.raw.prepare('select count(*) as n from agent_links').get()).toEqual({ n: 0 });
    expect(Object.keys((await officeOf(t)()).lists.users)).toHaveLength(users);
    await connect(t, true);
    expect(await liteAgentOf(deps, { token: 'x', authUserId: authId, clientId, sessionId }, officeOf(t))).toMatchObject({ ownerId: 'usr_002', linked: true });
  });

  it('keeps the list and the remove of the agents of a person whose role has ai.connect off (Settings, Agents)', async () => {
    const t = await signinOffice();
    const { agentId, clientId } = await linkedAgent(t);
    await connect(t, false);
    expect(await t.call('usr_002', 'agents.list', {})).toMatchObject({ ok: true, output: [{ agentId, clientIds: [clientId] }] });
    expect(await t.call('usr_002', 'agents.remove', { agentId })).toMatchObject({ ok: true, output: { removed: true } });
  });
});
