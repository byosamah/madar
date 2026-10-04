import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WireResponse } from '../../src/api/remote/wire';
import { httpOAuthPort } from '../../src/features/oauth/oauthPort';
import { clearOfficeCaches } from '../data/officeCache';
import { setEnvSource } from '../env';
import { apiApp } from '../http/app';
import { ROUTES } from '../http/routes';
import { mcpApp } from '../mcp/app';
import { withApproveRoute } from '../mcp/approval';
import { fakeDeps, type FakeDeps } from '../test/fakes/deps';
import { authOf, localStack, PASSWORD } from './authStack';
import { connectAgent, LOCAL_API, LOCAL_MCP_URL, publicOffice, REDIRECT_URI, registerClient, RELINK_SQL, type PublicOffice } from './oauthAgent';

/**
 * The G item of the wave 4 follow-ups, on the local stack [Docker] (proof.md, section H): after agents.revokeAll (a person
 * turned off, then on again) Auth still holds the OAuth grant of each AI app, so its authorize step gives a code at once and the
 * Madar consent screen never shows. Supabase Auth v2.197.0 (CLI 2.119.0) has no admin call that removes one person's grant for
 * one client: only the person's own token can (DELETE /user/oauth/grants), and the admin API can only delete a whole client,
 * which other people may use too. So the proof here is that the next connection still cannot act until the person approves again
 * in Madar, and that the consent screen is reachable. Run it after "supabase db reset" from this worktree.
 */

const stack = localStack();
const auth = authOf(stack, 'hrevoke');
const LOCK_KEY = 7_360_000 + (process.pid % 10_000);
const VERSION = '2026-07-28';
const API_URL = 'http://api.madar.test/functions/v1/api';
/** The person whose agents these are; usr_001 (the Admin) turns that person off and on. */
const PERSON = 'usr_002';

type Session = { client: SupabaseClient; token: string; authUserId: string; email: string };

let office: PublicOffice;
let deps: FakeDeps;
let mcp: ReturnType<typeof mcpApp>;
let api: ReturnType<typeof apiApp>;
let admin: Session;
let person: Session;
let nextId = 1;

async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await mcp.fetch(new Request('http://127.0.0.1/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': name, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args, _meta: { 'io.modelcontextprotocol/protocolVersion': VERSION, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
  }));
  const text = await response.text();
  return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function batch(token: string, calls: { name: string; input: unknown }[]) {
  const response = await api.fetch(new Request('http://127.0.0.1/batch', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ v: 1, calls: calls.map((c, i) => ({ i, ...c })) }),
  }));
  return (await response.json()) as WireResponse;
}

/** The browser port of the screens (consent screen, Settings, Agents) with this token: Auth for real, the api function in process. */
const portFor = (token: string) => httpOAuthPort({
  supabaseUrl: LOCAL_API, publishableKey: stack.publishableKey, apiUrl: API_URL, accessToken: async () => token,
  fetch: async (input, init) => (input.startsWith(API_URL) ? api.fetch(new Request(`http://127.0.0.1${input.slice(API_URL.length)}`, init)) : fetch(input, init)),
});

/** The consent screen of the person: Madar records the approval before Auth approves. */
const record = (authorizationId: string) => portFor(person.token).recordApproval(authorizationId);

async function signIn(email: string, authUserId: string): Promise<Session> {
  const client = createClient(stack.apiUrl, stack.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  expect(signedIn.error).toBeNull();
  return { client, token: signedIn.data.session!.access_token, authUserId, email };
}

async function linkedSession(userId: string, label: string): Promise<Session> {
  const email = auth.email(label);
  const { authUserId } = await auth.admin.createUser(email, PASSWORD);
  await office.admin.query(RELINK_SQL, [userId, email, authUserId]);
  return signIn(email, authUserId);
}

/** The Admin turns the person off and on again (users.deactivate runs agents.revokeAll and auth.ban; users.reactivate auth.unban). */
async function turnOffAndOn(): Promise<void> {
  for (const name of ['users.deactivate', 'users.reactivate']) {
    const answer = await batch(admin.token, [{ name, input: { id: PERSON } }]);
    expect(answer.results[0], JSON.stringify(answer)).toMatchObject({ ok: true });
  }
  person = await signIn(person.email, person.authUserId);
}

/** The authorize step of an MCP client: Auth sends the person to the consent screen with this id. */
async function authorizationOf(clientId: string): Promise<string> {
  const url = new URL(`${LOCAL_API}/auth/v1/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 's', resource: LOCAL_MCP_URL,
  }).toString();
  const start = await fetch(url, { redirect: 'manual' });
  return new URL(start.headers.get('location')!).searchParams.get('authorization_id')!;
}

const linkOf = async (clientId: string) => (await office.admin.query<{ agent_user_id: string; revoked_at: Date | null }>('select agent_user_id, revoked_at from public.agent_links where client_id = $1', [clientId])).rows[0];
const approvalOf = async (clientId: string) => (await office.admin.query<{ owner_user_id: string }>('select owner_user_id from public.agent_approvals where client_id = $1', [clientId])).rows;
const grantsOf = async () => (await portFor(person.token).listGrants()).map((grant) => grant.clientId);

beforeAll(async () => {
  setEnvSource({ SUPABASE_URL: stack.apiUrl });
  clearOfficeCaches();
  office = await publicOffice();
  deps = fakeDeps({ db: office.db, config: { lockKey: LOCK_KEY, supabaseUrl: LOCAL_API, mcpUrl: LOCAL_MCP_URL } });
  deps.authAdmin = auth.admin as unknown as FakeDeps['authAdmin'];
  deps.clock.set(new Date());
  mcp = mcpApp(deps, { stateKey: 'h-it-state-key-of-at-least-32-bytes!!' });
  api = apiApp(deps, { routes: withApproveRoute(ROUTES) });
  admin = await linkedSession('usr_001', 'admin');
  person = await linkedSession(PERSON, 'person');
}, 60_000);

afterAll(async () => {
  setEnvSource(undefined);
  await auth.cleanup();
  await office?.close();
});

describe('agents.revokeAll and the OAuth grant at Auth (proof.md, section H)', () => {
  it('Auth has no admin call for one grant: after a turn-off the grant stays, the app gets a code at once, and Madar refuses its token', async () => {
    const client = await registerClient(`Turned off app ${randomUUID().slice(0, 6)}`);
    const token = (await connectAgent(person.client, client, { record })).access_token;
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(200);

    await turnOffAndOn();
    expect((await linkOf(client)).revoked_at).not.toBeNull();
    expect(await grantsOf()).toContain(client);

    // Auth v2.197.0 routes these to nothing (404): only the person's own token removes a grant (DELETE /user/oauth/grants).
    for (const [method, path] of [
      ['DELETE', `/admin/users/${person.authUserId}/oauth/grants?client_id=${client}`],
      ['GET', `/admin/users/${person.authUserId}/oauth/grants`],
      ['DELETE', `/admin/oauth/grants?client_id=${client}&user_id=${person.authUserId}`],
    ] as const) {
      const answer = await fetch(`${LOCAL_API}/auth/v1${path}`, { method, headers: { apikey: stack.secretKey, Authorization: `Bearer ${stack.secretKey}` } });
      expect([method, path, answer.status]).toEqual([method, path, 404]);
    }
    expect(await grantsOf()).toContain(client);

    // The AI app connects again with its cached client: Auth answers at once (no consent screen), and Madar still refuses it.
    const again = await connectAgent(person.client, client);
    expect((await tool(again.access_token, 'projects.get', { id: 'prj_001' })).status).toBe(401);
    expect((await linkOf(client)).revoked_at).not.toBeNull();
  });

  it('the consent screen is reachable: Settings, Agents lists the grant, its Remove ends it, the next connection asks again, and only a new approval in Madar works', async () => {
    const name = `Back after a turn-off ${randomUUID().slice(0, 6)}`;
    const client = await registerClient(name);
    const token = (await connectAgent(person.client, client, { record })).access_token;
    expect((await tool(token, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    const agentId = (await linkOf(client)).agent_user_id;
    await turnOffAndOn();

    // Settings, Agents shows each grant whose client no active agent holds: this one, so the person can remove it.
    const listed = await batch(person.token, [{ name: 'agents.list', input: {} }]);
    const agent = (listed.results[0] as { output: { agentId: string; clientIds: string[] }[] }).output.find((row) => row.agentId === agentId);
    expect(agent?.clientIds ?? []).not.toContain(client);
    expect(await grantsOf()).toContain(client);
    const port = portFor(person.token);
    await port.revokeGrant(client);
    expect(await grantsOf()).not.toContain(client);

    // The same client: the consent screen asks, and Madar refuses it in plain words, because its link was removed.
    const authorizationId = await authorizationOf(client);
    expect(await port.details(authorizationId)).toMatchObject({ kind: 'ask', request: { clientId: client } });
    await expect(port.recordApproval(authorizationId)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'agent_removed' } });

    // The app registers again (as Madar's words tell the person): the consent screen asks, the person approves in Madar, and it works.
    const fresh = await registerClient(name);
    const freshToken = (await connectAgent(person.client, fresh, { record })).access_token;
    expect((await tool(freshToken, 'projects.get', { id: 'prj_001' })).status).toBe(200);
    expect((await linkOf(fresh)).revoked_at).toBeNull();
  });

  it('an approval that the person recorded before the turn-off, for an app that never called Madar, links nothing after it', async () => {
    const client = await registerClient(`Approved, never used ${randomUUID().slice(0, 6)}`);
    await connectAgent(person.client, client, { record });
    expect(await approvalOf(client)).toEqual([{ owner_user_id: PERSON }]);
    expect(await linkOf(client)).toBeUndefined();

    await turnOffAndOn();
    expect(await approvalOf(client)).toEqual([]);
    // Auth still holds the grant, so the app gets a code at once; Madar refuses it until the person approves again in Madar.
    const again = await connectAgent(person.client, client);
    const refused = await tool(again.access_token, 'projects.get', { id: 'prj_001' });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).toContain('You did not approve this AI app in Madar.');
    expect(await linkOf(client)).toBeUndefined();

    // Remove in Settings, Agents ends the grant; the next connection asks, the person approves in Madar, and the app works.
    await portFor(person.token).revokeGrant(client);
    const back = await connectAgent(person.client, client, { record });
    expect((await tool(back.access_token, 'projects.get', { id: 'prj_001' })).status).toBe(200);
  });
});
