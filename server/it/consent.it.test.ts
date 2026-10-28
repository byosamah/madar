import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WireResponse } from '../../src/api/remote/wire';
import { httpOAuthPort } from '../../src/features/oauth/oauthPort';
import { setEnvSource } from '../env';
import { apiApp } from '../http/app';
import { ROUTES } from '../http/routes';
import { clearOfficeCaches } from '../data/officeCache';
import { mcpApp } from '../mcp/app';
import { APPROVE_PATH, withApproveRoute } from '../mcp/approval';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { authOf, localStack, PASSWORD } from './authStack';
import { connectAgent, LOCAL_API, LOCAL_MCP_URL, publicOffice, registerClient, RELINK_SQL, type PublicOffice } from './oauthAgent';

/**
 * Task G4 on the local stack [Docker] (plan 5.6; proof.md Z0a item 2, "Z7 and G (consent)", and section G4): an agent token can
 * approve a client of its own at Auth, so Madar links only a client that the person approved in Madar; the consent port of the
 * screens against the real Auth server and the api app; agents.list and agents.remove on the database. Run it after
 * "supabase db reset" from this worktree.
 */

const stack = localStack();
const auth = authOf(stack, 'g4consent');
const LOCK_KEY = 7_350_000 + (process.pid % 10_000);
const VERSION = '2026-07-28';
const API_URL = 'http://api.madar.test/functions/v1/api';

let office: PublicOffice;
let deps: FakeDeps;
let mcp: ReturnType<typeof mcpApp>;
let api: ReturnType<typeof apiApp>;
let person: { client: SupabaseClient; token: string; authUserId: string };
let nextId = 1;

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await mcp.fetch(new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': name, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, any>) : {} };
}

async function batch(token: string, calls: { name: string; input: unknown }[]) {
  const response = await api.fetch(new Request('http://127.0.0.1/batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 1, calls: calls.map((c, i) => ({ i, ...c })) }),
  }));
  return (await response.json()) as WireResponse;
}

/** The browser port of the screens with this token: Auth for real, the api function in process. */
const portFor = (token: string) => httpOAuthPort({
  supabaseUrl: LOCAL_API, publishableKey: stack.publishableKey, apiUrl: API_URL, accessToken: async () => token,
  fetch: async (input, init) => (input.startsWith(API_URL) ? api.fetch(new Request(`http://127.0.0.1${input.slice(API_URL.length)}`, init)) : fetch(input, init)),
});

/** The authorize step of an MCP client, as the agent starts it: it gives the consent page's authorization_id. */
async function authorize(clientId: string, redirectUri: string) {
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL(`${LOCAL_API}/auth/v1/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state: 's', resource: LOCAL_MCP_URL,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  }).toString();
  const start = await fetch(url, { redirect: 'manual' });
  const authorizationId = new URL(start.headers.get('location')!).searchParams.get('authorization_id')!;
  const exchange = async (redirect: string) => {
    const response = await fetch(`${LOCAL_API}/auth/v1/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: new URL(redirect).searchParams.get('code')!, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource: LOCAL_MCP_URL }),
    });
    return { status: response.status, body: (await response.json()) as { access_token?: string } };
  };
  return { authorizationId, exchange };
}

const linkOf = async (clientId: string) => (await office.admin.query<{ agent_user_id: string; revoked_at: Date | null }>('select agent_user_id, revoked_at from public.agent_links where client_id = $1', [clientId])).rows[0];
const approvalOf = async (clientId: string) => (await office.admin.query<{ owner_user_id: string }>('select owner_user_id from public.agent_approvals where client_id = $1', [clientId])).rows;

beforeAll(async () => {
  setEnvSource({ SUPABASE_URL: stack.apiUrl });
  clearOfficeCaches();
  office = await publicOffice();
  deps = fakeDeps({ db: office.db, config: { lockKey: LOCK_KEY, supabaseUrl: LOCAL_API, mcpUrl: LOCAL_MCP_URL } });
  deps.clock.set(new Date());
  mcp = mcpApp(deps, { stateKey: 'g4-it-state-key-of-at-least-32-bytes' });
  api = apiApp(deps, { routes: withApproveRoute(ROUTES) });
  const email = auth.email('admin');
  const { authUserId } = await auth.admin.createUser(email, PASSWORD);
  await office.admin.query(RELINK_SQL, ['usr_001', email, authUserId]);
  const client = createClient(stack.apiUrl, stack.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(signedIn.error).toBeNull();
  person = { client, token: signedIn.data.session!.access_token, authUserId };
}, 60_000);

afterAll(async () => {
  setEnvSource(undefined);
  await auth.cleanup();
  await office?.close();
});

describe('G4: the approval that the person records in Madar', () => {
  let agentToken: string;

  it('an agent token approves a client that the agent registered itself at Auth, but Madar links nothing and records nothing (proof.md G4)', async () => {
    const own = await registerClient(`Approved app ${randomUUID().slice(0, 6)}`);
    const port = portFor(person.token);
    agentToken = (await connectAgent(person.client, own, { record: (id) => port.recordApproval(id) })).access_token;
    expect((await tool(agentToken, 'projects.get', { id: 'prj_001' })).status).toBe(200);

    // The agent registers a client of its own and answers the consent with its own token.
    const evilUri = 'https://evil.example/callback';
    const evil = await registerClient(`Self approved ${randomUUID().slice(0, 6)}`, evilUri);
    const { authorizationId, exchange } = await authorize(evil, evilUri);
    const agentPort = portFor(agentToken);
    const details = await agentPort.details(authorizationId);
    expect(details).toMatchObject({ kind: 'ask', request: { clientId: evil, redirectUri: evilUri } });
    // Madar refuses the agent token, so the agent cannot record an approval.
    await expect(agentPort.recordApproval(authorizationId)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_token' } });
    // Auth approves for the agent token: the gap of proof.md Z0a item 2.
    const redirect = await agentPort.approve(authorizationId);
    const exchanged = await exchange(redirect);
    expect(exchanged.status).toBe(200);
    const selfToken = exchanged.body.access_token!;

    const refused = await tool(selfToken, 'projects.get', { id: 'prj_001' });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain('You did not approve this AI app in Madar.');
    expect(await linkOf(evil)).toBeUndefined();
    expect(await approvalOf(evil)).toEqual([]);

    // Settings, Agents shows the grant that Madar has no approval for, so the person can remove it.
    const grants = await portFor(person.token).listGrants();
    expect(grants.map((grant) => grant.clientId)).toEqual(expect.arrayContaining([own, evil]));
  });

  it('the consent port of the screens records the approval for the person, from the pending authorization of Auth, then Auth approves', async () => {
    const uri = 'http://127.0.0.1:33418/callback';
    const client = await registerClient(`Screen app ${randomUUID().slice(0, 6)}`);
    const { authorizationId, exchange } = await authorize(client, uri);
    const port = portFor(person.token);
    expect(await port.details(authorizationId)).toMatchObject({ kind: 'ask', request: { clientId: client, redirectUri: uri } });
    await port.recordApproval(authorizationId);
    expect(await approvalOf(client)).toEqual([{ owner_user_id: 'usr_001' }]);
    const exchanged = await exchange(await port.approve(authorizationId));
    expect((await tool(exchanged.body.access_token!, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    expect((await linkOf(client)).revoked_at).toBeNull();
    // An answered request records nothing more: the route reads only a pending one.
    await expect(port.recordApproval(authorizationId)).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'authorization_ended' } });
  });

  it('refuses the approval of a client with an address that the screen did not show, and stores the seen address of one that is fine (CWE-863)', async () => {
    const known = 'https://claude.ai/api/mcp/auth_callback';
    const loopback = 'http://127.0.0.1:33418/callback';
    const port = portFor(person.token);
    // The screen shows the known address, the client also holds an address of its own: the finding. Auth would give the code at once later.
    const hidden = await registerClient(`Hidden address ${randomUUID().slice(0, 6)}`, [known, 'https://attacker.example/cb']);
    const first = await authorize(hidden, known);
    await port.details(first.authorizationId);
    await expect(port.recordApproval(first.authorizationId)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_redirect_hidden' } });
    expect(await approvalOf(hidden)).toEqual([]);
    // A client with loopback and a known app is fine, and the row keeps the address that the person saw.
    const fine = await registerClient(`Two safe addresses ${randomUUID().slice(0, 6)}`, [loopback, known]);
    const second = await authorize(fine, loopback);
    await port.details(second.authorizationId);
    await port.recordApproval(second.authorizationId);
    const row = await office.admin.query<{ redirect_uri: string | null }>('select redirect_uri from public.agent_approvals where client_id = $1', [fine]);
    expect(row.rows).toEqual([{ redirect_uri: loopback }]);
  });

  it('Deny gives the AI app no token, and Madar records nothing', async () => {
    const client = await registerClient(`Denied app ${randomUUID().slice(0, 6)}`);
    const { authorizationId } = await authorize(client, 'http://127.0.0.1:33418/callback');
    const port = portFor(person.token);
    await port.details(authorizationId);
    expect(new URL(await port.deny(authorizationId)).searchParams.get('error')).toBe('access_denied');
    expect(await approvalOf(client)).toEqual([]);
  });

  it('agents.list shows the agent with its clients; agents.remove turns it off and removes its links, and revokeGrant ends its grant', async () => {
    const client = await registerClient(`Removed app ${randomUUID().slice(0, 6)}`);
    const port = portFor(person.token);
    const token = (await connectAgent(person.client, client, { record: (id) => port.recordApproval(id) })).access_token;
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    const agentId = (await linkOf(client)).agent_user_id;

    const listed = await batch(person.token, [{ name: 'agents.list', input: {} }]);
    const row = (listed.results[0] as { output: { agentId: string; clientIds: string[]; redirectHost: string | null; lastUsedAt: string | null; active: boolean }[] }).output.find((agent) => agent.agentId === agentId);
    expect(row).toMatchObject({ clientIds: [client], redirectHost: '127.0.0.1', active: true });
    expect(row!.lastUsedAt).not.toBeNull();

    const removed = await batch(person.token, [{ name: 'agents.remove', input: { agentId } }]);
    expect(removed.results[0], JSON.stringify(removed)).toMatchObject({ ok: true, output: { removed: true }, changed: true });
    expect((await linkOf(client)).revoked_at).not.toBeNull();
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(401);
    const { rows } = await office.admin.query<{ doc: Record<string, unknown> }>("select doc from public.events where target_id = $1 and verb = 'user.deactivated'", [agentId]);
    expect(rows[0].doc).toMatchObject({ actorId: 'usr_001', after: { active: false } });
    const after = await batch(person.token, [{ name: 'agents.list', input: {} }]);
    expect((after.results[0] as { output: { agentId: string; active: boolean; clientIds: string[] }[] }).output.find((agent) => agent.agentId === agentId)).toMatchObject({ active: false, clientIds: [] });

    await port.revokeGrant(client);
    expect((await port.listGrants()).map((grant) => grant.clientId)).not.toContain(client);
  });

  it('after Remove, a second revoke finds no grant (404) and resolves, and the same client gets 403 agent_removed on the consent screen (review of G4)', async () => {
    const client = await registerClient(`Back again app ${randomUUID().slice(0, 6)}`);
    const port = portFor(person.token);
    const token = (await connectAgent(person.client, client, { record: (id) => port.recordApproval(id) })).access_token;
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    const agentId = (await linkOf(client)).agent_user_id;
    const removed = await batch(person.token, [{ name: 'agents.remove', input: { agentId } }]);
    expect(removed.results[0], JSON.stringify(removed)).toMatchObject({ ok: true });
    await port.revokeGrant(client);
    // The real Auth answers 404 oauth_consent_not_found now; the port takes it as done, so a Retry never sticks.
    await expect(port.revokeGrant(client)).resolves.toBeUndefined();

    // The AI app connects again with its cached client_id: Auth asks again (the grant is gone), and Madar refuses the approval.
    const { authorizationId } = await authorize(client, 'http://127.0.0.1:33418/callback');
    expect(await port.details(authorizationId)).toMatchObject({ kind: 'ask', request: { clientId: client } });
    await expect(port.recordApproval(authorizationId)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_removed' } });
    expect(await approvalOf(client)).toEqual([{ owner_user_id: 'usr_001' }]);
    expect((await linkOf(client)).revoked_at).not.toBeNull();
  });

  it('the api route refuses an agent token with 403, whatever the authorization', async () => {
    const response = await api.fetch(new Request(`http://127.0.0.1${APPROVE_PATH}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${agentToken}` }, body: JSON.stringify({ authorizationId: 'anything' }),
    }));
    expect(response.status).toBe(403);
  });
});
