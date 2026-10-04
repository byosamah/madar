import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WireResponse } from '../../src/api/remote/wire';
import { setEnvSource } from '../env';
import { apiApp } from '../http/app';
import { clearOfficeCaches } from '../data/officeCache';
import { mcpApp, sqlMcpLimit, TOOL_CALLS_PER_MINUTE } from '../mcp/app';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { authOf, localStack, PASSWORD } from './authStack';
import { connectAgent, LOCAL_API, LOCAL_MCP_URL, publicOffice, registerClient, RELINK_SQL, type PublicOffice } from './oauthAgent';

/**
 * Suite 12 of TM 7 on the local stack (plan 5.6; task G3) [Docker]: the real MCP app (token check against the local JWKS, the
 * agent link SQL, ensureAgentUser, runCall, the rate limit) and the real api app, on the office in the public schema, with the
 * OAuth 2.1 flow of an MCP client against the local Auth server. Run it after "supabase db reset" from this worktree.
 */

const stack = localStack();
const auth = authOf(stack, 'g3mcp');
const LOCK_KEY = 7_340_000 + (process.pid % 10_000);
const VERSION = '2026-07-28';

let office: PublicOffice;
let deps: FakeDeps;
let mcp: ReturnType<typeof mcpApp>;
let api: ReturnType<typeof apiApp>;
const people: Record<string, { client: SupabaseClient; token: string }> = {};
let nextId = 1;

async function signIn(userId: string, label: string): Promise<void> {
  const email = auth.email(label);
  const { authUserId } = await auth.admin.createUser(email, PASSWORD);
  await office.admin.query(RELINK_SQL, [userId, email, authUserId]);
  const client = createClient(stack.apiUrl, stack.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(signedIn.error).toBeNull();
  people[userId] = { client, token: signedIn.data.session!.access_token };
}

async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const response = await mcp.fetch(new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': VERSION, 'Mcp-Method': method,
      ...(method === 'tools/call' ? { 'Mcp-Name': String(params.name) } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
  }));
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
}

const tool = (token: string, name: string, args: Record<string, unknown> = {}) => rpc(token, 'tools/call', { name, arguments: args });

async function batch(token: string, calls: { name: string; input: unknown }[]) {
  const response = await api.fetch(new Request('http://127.0.0.1/batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 1, calls: calls.map((c, i) => ({ i, ...c })) }),
  }));
  return { status: response.status, body: (await response.json()) as WireResponse & { error?: { code: string; details?: Record<string, unknown> } } };
}

const linkOf = async (clientId: string) =>
  (await office.admin.query<{ owner_user_id: string; agent_user_id: string; client_name: string; redirect_host: string; revoked_at: Date | null; last_used_at: Date | null }>(
    'select * from public.agent_links where client_id = $1', [clientId])).rows[0];
const userDoc = async (id: string) => (await office.admin.query<{ doc: Record<string, unknown> }>('select doc from public.users where id = $1', [id])).rows[0]?.doc;

beforeAll(async () => {
  setEnvSource({ SUPABASE_URL: stack.apiUrl });
  clearOfficeCaches();
  office = await publicOffice();
  deps = fakeDeps({ db: office.db, config: { lockKey: LOCK_KEY, supabaseUrl: LOCAL_API, mcpUrl: LOCAL_MCP_URL } });
  deps.clock.set(new Date());
  mcp = mcpApp(deps, { stateKey: 'g3-it-state-key-of-at-least-32-bytes' });
  api = apiApp(deps);
  await signIn('usr_001', 'admin');
  await signIn('usr_005', 'sara');
}, 60_000);

afterAll(async () => {
  setEnvSource(undefined);
  await auth.cleanup();
  await office?.close();
});

describe('suite 12: MCP on the local stack', () => {
  let appName: string;
  let firstClient: string;
  let firstToken: string;
  let agentId: string;

  it('runs the full OAuth 2.1 flow with PKCE, and the first call makes the agent user, its link and its user.created event', async () => {
    appName = `Claude Code ${randomUUID().slice(0, 6)}`;
    firstClient = await registerClient(appName);
    firstToken = (await connectAgent(people.usr_001.client, firstClient)).access_token;
    const { status, body } = await tool(firstToken, 'madar.readFirst');
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.result.content[0].text).toContain('You act for Hala Nasser, whose role in Madar is Admin.');
    const link = await linkOf(firstClient);
    expect(link).toMatchObject({ owner_user_id: 'usr_001', client_name: appName, redirect_host: '127.0.0.1', revoked_at: null });
    agentId = link.agent_user_id;
    expect(await userDoc(agentId)).toMatchObject({ kind: 'agent', ownerId: 'usr_001', name: appName, active: true, email: `${agentId}@agents.madar.invalid` });
    const { rows } = await office.admin.query<{ doc: Record<string, unknown> }>("select doc from public.events where target_type = 'user' and target_id = $1 and verb = 'user.created'", [agentId]);
    expect(rows[0].doc).toMatchObject({ actorId: 'usr_001', actingForId: 'usr_001' });
  });

  it('reuses the agent user when the same person registers the same app again (Supabase makes a new client each time)', async () => {
    const second = await registerClient(appName);
    const token = (await connectAgent(people.usr_001.client, second)).access_token;
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).body.result.structuredContent.output.project.id).toBe('prj_001');
    expect((await linkOf(second)).agent_user_id).toBe(agentId);
  });

  it('refuses a browser token on mcp with 401 and the challenge, and an agent token on api with 403 agent_token', async () => {
    const browser = await rpc(people.usr_001.token, 'tools/list');
    expect(browser.status).toBe(401);
    expect(browser.headers.get('WWW-Authenticate')).toContain(`resource_metadata="${LOCAL_MCP_URL}/oauth-protected-resource"`);
    const agentOnApi = await batch(firstToken, [{ name: 'session.get', input: {} }]);
    expect(agentOnApi.status).toBe(403);
    expect(agentOnApi.body.error).toMatchObject({ code: 'forbidden', details: { reason: 'agent_token' } });
  });

  it('writes as the agent: the History names the agent and its person, and the person can undo the change', async () => {
    const started = await tool(firstToken, 'story.start');
    const storyId = started.body.result.structuredContent.output.storyId as string;
    const created = await tool(firstToken, 'comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Checked by the agent.', storyId });
    expect(created.body.result.isError, JSON.stringify(created.body)).toBeUndefined();
    const { rows } = await office.admin.query<{ id: string; doc: Record<string, unknown> }>('select id, doc from public.events where correlation_id = $1', [storyId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].doc).toMatchObject({ actorId: agentId, actorKind: 'agent', actingForId: 'usr_001', verb: 'comment.created' });
    const undone = await batch(people.usr_001.token, [{ name: 'events.undo', input: { eventId: rows[0].id } }]);
    expect(undone.body.results[0], JSON.stringify(undone.body)).toMatchObject({ ok: true });
  });

  it('counts tool calls for each person over all of the person\'s agents, and notes the last use of the link', async () => {
    const ownerId = `usr_limit_${process.pid}`;
    const now = new Date();
    let last = { ok: true, count: 0, retryAfterMs: 0 };
    for (let n = 0; n <= TOOL_CALLS_PER_MINUTE; n += 1) last = await sqlMcpLimit(deps, { ownerId, clientId: n % 2 === 0 ? firstClient : randomUUID(), now });
    expect(last).toMatchObject({ ok: false, count: TOOL_CALLS_PER_MINUTE + 1 });
    expect((await linkOf(firstClient)).last_used_at).not.toBeNull();
  });

  it('stops the next call at once when the link is removed, and links again after a new approval of the same client', async () => {
    const client = await registerClient(`Removable ${randomUUID().slice(0, 6)}`);
    const token = (await connectAgent(people.usr_001.client, client)).access_token;
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    // What agents.remove (G4) does to the link.
    await office.admin.query('update public.agent_links set revoked_at = now() where client_id = $1', [client]);
    const refused = await tool(token, 'projects.get', { id: 'prj_001' });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
    const again = (await connectAgent(people.usr_001.client, client)).access_token;
    expect((await tool(again, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    expect((await linkOf(client)).revoked_at).toBeNull();
  });

  it('turning the person off refuses the agent at once and removes its links (agents.revokeAll); the old token stays refused after the person is on again', async () => {
    const client = await registerClient(`Sara's app ${randomUUID().slice(0, 6)}`);
    const token = (await connectAgent(people.usr_005.client, client)).access_token;
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    expect((await batch(people.usr_001.token, [{ name: 'users.deactivate', input: { id: 'usr_005' } }])).body.results[0]).toMatchObject({ ok: true });
    expect((await linkOf(client)).revoked_at).not.toBeNull();
    expect([401, 403]).toContain((await tool(token, 'projects.get', { id: 'prj_001' })).status);
    expect((await batch(people.usr_001.token, [{ name: 'users.reactivate', input: { id: 'usr_005' } }])).body.results[0]).toMatchObject({ ok: true });
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(401);
  });
});
