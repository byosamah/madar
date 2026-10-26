import { describe, expect, it } from 'vitest';
import { addSignIn, signinOffice, type TestOffice } from '../auth/own/testOffice';
import type { Deps } from '../core/ports';
import { createRunCall } from '../core/runCall';
import type { RunResult } from '../core/types';
import { liteData } from '../data/lite/callData';
import { readLiteOffice } from '../data/lite/office';
import { ensureAgentUser } from './agentUser';

/**
 * The server calls that the MCP parity track opens (owner, 2026-10-26), run as an agent on node:sqlite, as the office object runs them:
 * users.invites, users.resendInvite, agents.list and agents.remove. The agent acts with the rights of its person, and the answers stay those
 * of the screens. The in-process MCP tests (parity.test.ts) cover the shared calls on the memory office.
 */
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';

async function agentOf(t: TestOffice, ownerId: string) {
  const authId = await addSignIn(t, ownerId, { password: 'a good password' });
  const clientId = crypto.randomUUID();
  const now = t.deps.clock.now().toISOString();
  t.raw.prepare('insert into oauth_clients (id, name, redirect_uris, created_at) values (?, ?, ?, ?)').run(clientId, 'Claude', JSON.stringify([CALLBACK]), now);
  t.raw.prepare('insert into agent_approvals (client_id, owner_user_id, approved_at) values (?, ?, ?)').run(clientId, ownerId, now);
  t.raw.prepare("insert into auth_sessions (id, auth_id, client_id, amr, refresh_hash, expires_at, created_at) values (?, ?, ?, 'oauth', ?, '2026-11-17T06:00:00.000Z', ?)").run(`s-${clientId}`, authId, clientId, `h-${clientId}`, now);
  const deps = t.deps as unknown as Deps;
  const made = await ensureAgentUser(deps, { ownerId, clientId, data: liteData(deps) });
  return { agentId: made.agentUserId, clientId };
}

type Agent = { agentId: string; clientId: string };
const run = createRunCall({ data: liteData });
/** One call as the agent: the principal carries the OAuth client, as the MCP token check makes it. */
const asAgent = (t: TestOffice, agent: Agent, name: string, input: unknown): Promise<RunResult> =>
  run(t.deps as unknown as Deps, { principal: { userId: agent.agentId, agent: { clientId: agent.clientId } }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });

const usersOf = (t: TestOffice) => t.db.tx('read', (q) => readLiteOffice(t.db, q)).then((office) => office.lists.users);

describe('the invitation calls for the agent of an Admin, on SQLite', () => {
  it('lists who is invited, and sends an invitation again with the mail of the person', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_001');
    // An invitation of an agent needs the email code of its person (guard.ts): the first call fails, the second sends the code.
    const person = { name: 'New Person', email: 'new.person@madar.test', systemRole: 'member', discipline: 'Architect' };
    expect(await asAgent(t, agent, 'users.create', person)).toMatchObject({ ok: false, error: { details: { reason: 'confirm_needed' } } });
    const [mail] = t.deps.mail.sent.filter((item) => item.tag === 'confirm');
    const created = (await asAgent(t, agent, 'users.create', { ...person, confirmCode: /\b(\d{6})\b/.exec(mail.text)![1] })) as { ok: boolean; output: { id: string } };
    expect(created.ok).toBe(true);
    const rows = (await asAgent(t, agent, 'users.invites', {})) as { ok: boolean; output: { userId: string; state: string; sentAt: string | null }[] };
    expect(rows.ok).toBe(true);
    expect(rows.output.find((row) => row.userId === created.output.id)).toEqual({ userId: created.output.id, state: 'invited', sentAt: expect.any(String) });
    const before = t.deps.mail.sent.length;
    t.deps.clock.advance(60_000);
    expect((await asAgent(t, agent, 'users.resendInvite', { id: created.output.id })).ok).toBe(true);
    expect(t.deps.mail.sent.length).toBe(before + 1);
  });

  it('gives the agent of a Member the same refusal as the screens, and sends no mail', async () => {
    const t = await signinOffice();
    const agent = await agentOf(t, 'usr_003');
    expect(await asAgent(t, agent, 'users.invites', {})).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    const before = t.deps.mail.sent.length;
    expect(await asAgent(t, agent, 'users.resendInvite', { id: 'usr_005' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(t.deps.mail.sent.length).toBe(before);
  });
});

describe('the own AI apps of the person, for an agent, on SQLite', () => {
  it('lists the agents of the person, and removes one of them: its links end and it turns off', async () => {
    const t = await signinOffice();
    const first = await agentOf(t, 'usr_002');
    expect(await asAgent(t, first, 'agents.list', {})).toMatchObject({ ok: true, output: [{ agentId: first.agentId, clientIds: [first.clientId], active: true }] });
    expect(await asAgent(t, first, 'agents.remove', { agentId: first.agentId })).toMatchObject({ ok: true, output: { removed: true } });
    expect((await usersOf(t))[first.agentId].active).toBe(false);
    expect(t.raw.prepare('select count(*) as n from agent_links where revoked_at is null').get()).toEqual({ n: 0 });
  });

  it('keeps the agent of one person from the agents of another person', async () => {
    const t = await signinOffice();
    const mine = await agentOf(t, 'usr_002');
    const other = await agentOf(t, 'usr_003');
    expect(await asAgent(t, other, 'agents.list', {})).toMatchObject({ ok: true, output: [{ agentId: other.agentId }] });
    expect(JSON.stringify(await asAgent(t, other, 'agents.list', {}))).not.toContain(mine.clientId);
    expect(await asAgent(t, other, 'agents.remove', { agentId: mine.agentId })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect((await usersOf(t))[mine.agentId].active).toBe(true);
  });
});
