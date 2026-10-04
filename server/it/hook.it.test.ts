import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * G1, the token hook spike (plan 5.6, change 6; platform facts 6.8), on the local stack after "supabase db reset".
 * It runs the whole OAuth 2.1 flow of an MCP client against the local Auth server: dynamic client registration, the authorize
 * step, the consent approval through the Auth API (as the consent screen does), the code exchange with PKCE, and a refresh.
 * It proves: the hook sees client_id, it reads platform_config.mcp_url, Auth issues and signs the token with the changed aud,
 * a refresh keeps it, and a browser token keeps aud "authenticated". Two probes of the G repair record that a refreshed browser
 * token carries aud as a string, and that Auth's own endpoints (/user, /user/oauth/grants) give an agent token the rights of
 * the person. The result is in docs/superpowers/real-build/proof.md, G1.
 */

const root = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATION = new URL('../../supabase/migrations/20261004000400_platform_auth_hook.sql', import.meta.url);
const MCP_URL = 'http://127.0.0.1:54321/functions/v1/mcp';
const REDIRECT_URI = 'http://127.0.0.1:33418/callback';
const EMAIL = 'g1-hook@madar.test';
const PASSWORD = 'g1-hook-password-1';

type Stack = { apiUrl: string; anonKey: string; serviceKey: string; dbUrl: string };

/** The URLs and keys of the running local stack, from "supabase status". The stack must run from this worktree. */
function stackStatus(): Stack {
  const out = execFileSync(`${root}/node_modules/.bin/supabase`, ['status', '-o', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const status = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  const pick = (...names: string[]) => {
    const value = names.map((name) => status[name]).find(Boolean);
    if (!value) throw new Error(`supabase status has none of ${names.join(', ')}`);
    return value;
  };
  return {
    // config.toml turns the Data API off, and then the status has no API_URL. Kong still serves Auth on the API port.
    apiUrl: status.API_URL || 'http://127.0.0.1:54321',
    anonKey: pick('ANON_KEY', 'PUBLISHABLE_KEY'),
    serviceKey: pick('SERVICE_ROLE_KEY', 'SECRET_KEY'),
    dbUrl: pick('DB_URL'),
  };
}

const base64url = (bytes: Buffer) => bytes.toString('base64url');

type Tokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number };

let stack: Stack;
let db: pg.Client;
let person: SupabaseClient;
let personId: string;

async function setMcpUrl(value: string | null): Promise<void> {
  await db.query(`delete from public.platform_config where key = 'mcp_url'`);
  if (value !== null) await db.query(`insert into public.platform_config (key, value) values ('mcp_url', $1)`, [value]);
}

/** Dynamic client registration, as an MCP client does it (RFC 7591). A public client with PKCE, no secret. */
async function registerClient(name: string): Promise<string> {
  const res = await fetch(`${stack.apiUrl}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  });
  const body = (await res.json()) as { client_id?: string };
  expect(res.status, JSON.stringify(body)).toBeLessThan(300);
  expect(body.client_id).toBeTruthy();
  return body.client_id!;
}

/** The authorize step, the approval on the consent screen, and the code exchange. Returns the first tokens of the agent. */
async function connectAgent(clientId: string): Promise<{ tokens?: Tokens; error?: { status: number; body: string } }> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(12));
  const authorize = new URL(`${stack.apiUrl}/auth/v1/oauth/authorize`);
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT_URI, code_challenge: challenge, code_challenge_method: 'S256', state, resource: MCP_URL,
  }).toString();
  const start = await fetch(authorize, { redirect: 'manual' });
  const consentUrl = start.headers.get('location');
  expect(start.status, await start.clone().text()).toBeGreaterThanOrEqual(300);
  expect(consentUrl).toContain('/oauth/consent?authorization_id=');
  const authorizationId = new URL(consentUrl!).searchParams.get('authorization_id')!;

  // The consent screen: it reads the details, then approves (platform facts 6.3).
  const details = await person.auth.oauth.getAuthorizationDetails(authorizationId);
  expect(details.error).toBeNull();
  const approved = await person.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
  expect(approved.error).toBeNull();
  const back = new URL(approved.data!.redirect_url);
  expect(back.searchParams.get('state')).toBe(state);
  const code = back.searchParams.get('code');
  expect(code).toBeTruthy();

  const res = await fetch(`${stack.apiUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT_URI, client_id: clientId, code_verifier: verifier, resource: MCP_URL }),
  });
  const text = await res.text();
  if (!res.ok) return { error: { status: res.status, body: text } };
  return { tokens: JSON.parse(text) as Tokens };
}

async function refresh(clientId: string, refreshToken: string): Promise<Tokens> {
  const res = await fetch(`${stack.apiUrl}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  });
  const text = await res.text();
  expect(res.status, text).toBe(200);
  return JSON.parse(text) as Tokens;
}

beforeAll(async () => {
  stack = stackStatus();
  expect(new URL(stack.apiUrl).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
  db = new pg.Client({ connectionString: stack.dbUrl });
  await db.connect();
  await setMcpUrl(MCP_URL);

  const admin = createClient(stack.apiUrl, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const existing = await admin.auth.admin.listUsers();
  for (const user of existing.data.users.filter((u) => u.email === EMAIL)) await admin.auth.admin.deleteUser(user.id);
  const created = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  expect(created.error).toBeNull();
  personId = created.data.user!.id;

  person = createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const signedIn = await person.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  expect(signedIn.error).toBeNull();
}, 60_000);

afterAll(async () => {
  await db?.end();
});

describe('the token hook (G1)', () => {
  it('is the function of the migration, not the stand-in of seed.sql', async () => {
    const { rows } = await db.query<{ src: string; definer: boolean }>(
      `select prosrc as src, prosecdef as definer from pg_proc where oid = 'public.madar_access_token_hook(jsonb)'::regprocedure`,
    );
    expect(rows[0].src).toContain('platform_config');
    expect(rows[0].definer).toBe(true);
  });

  it('leaves a browser token as it is: aud "authenticated" and no client_id', async () => {
    const { data } = await person.auth.getSession();
    const claims = decodeJwt(data.session!.access_token);
    // This Auth version writes aud as a list for a browser token. A token check must accept both forms.
    expect([claims.aud].flat()).toEqual(['authenticated']);
    expect(claims.client_id).toBeUndefined();
    expect(claims.sub).toBe(personId);
  });

  it('gives a refreshed browser token aud "authenticated" too, so only client_id tells an agent token from a person token', async () => {
    const refreshed = await person.auth.refreshSession();
    expect(refreshed.error).toBeNull();
    const claims = decodeJwt(refreshed.data.session!.access_token);
    expect([claims.aud].flat()).toEqual(['authenticated']);
    expect(claims.client_id).toBeUndefined();
    console.info('G1 aud form:', JSON.stringify({ refreshedPersonToken: Array.isArray(claims.aud) ? 'list' : 'string' }));
  });

  it('gives an agent token aud = platform_config.mcp_url, signed by Auth, and a refresh keeps it', async () => {
    const clientId = await registerClient('G1 hook probe');
    const first = await connectAgent(clientId);
    expect(first.error).toBeUndefined();
    const claims = decodeJwt(first.tokens!.access_token);
    expect(claims.aud).toBe(MCP_URL);
    expect(claims.client_id).toBe(clientId);
    expect(claims.sub).toBe(personId);
    expect(claims.session_id).toBeTruthy();

    // Auth signed the token with the changed aud: a check with the published keys, the issuer and aud = the MCP URL passes.
    const jwks = createRemoteJWKSet(new URL(`${stack.apiUrl}/auth/v1/.well-known/jwks.json`));
    const verified = await jwtVerify(first.tokens!.access_token, jwks, { audience: MCP_URL, issuer: `${stack.apiUrl}/auth/v1` });
    expect(verified.payload.client_id).toBe(clientId);
    // The same token fails a check that expects a browser token.
    await expect(jwtVerify(first.tokens!.access_token, jwks, { audience: 'authenticated' })).rejects.toThrow();

    // Auth itself accepts the changed aud: its user endpoint answers the agent token with the person.
    const userRes = await fetch(`${stack.apiUrl}/auth/v1/user`, { headers: { apikey: stack.anonKey, Authorization: `Bearer ${first.tokens!.access_token}` } });
    expect(userRes.status).toBe(200);
    expect(((await userRes.json()) as { id: string }).id).toBe(personId);

    const second = await refresh(clientId, first.tokens!.refresh_token);
    const refreshed = decodeJwt(second.access_token);
    expect(refreshed.aud).toBe(MCP_URL);
    expect(refreshed.client_id).toBe(clientId);
    expect(refreshed.session_id).toBe(claims.session_id);
  });

  it('reads the URL from platform_config at each token, so each project has its own', async () => {
    const other = 'https://example.invalid/functions/v1/mcp';
    await setMcpUrl(other);
    try {
      const clientId = await registerClient('G1 hook probe, other URL');
      const { tokens } = await connectAgent(clientId);
      expect(decodeJwt(tokens!.access_token).aud).toBe(other);
    } finally {
      await setMcpUrl(MCP_URL);
    }
  });

  it('refuses an agent token when platform_config has no URL, and a person still signs in', async () => {
    await setMcpUrl(null);
    try {
      const clientId = await registerClient('G1 hook probe, no URL');
      const result = await connectAgent(clientId);
      expect(result.tokens).toBeUndefined();
      expect(result.error!.status).toBeGreaterThanOrEqual(400);
      expect(result.error!.body).toContain('no MCP URL in platform_config');

      const again = createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await again.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
      expect(signedIn.error).toBeNull();
      expect([decodeJwt(signedIn.data.session!.access_token).aud].flat()).toEqual(['authenticated']);
    } finally {
      await setMcpUrl(MCP_URL);
    }
  });

  it('shows where the hook finds client_id, at the first token and at a refresh (the proof records it)', async () => {
    // A probe version of the hook keeps each event it gets, then the migration puts the real hook back.
    await db.query(`create table if not exists public.g1_hook_events (n serial, event jsonb)`);
    await db.query(`grant insert on public.g1_hook_events to supabase_auth_admin; grant usage on sequence public.g1_hook_events_n_seq to supabase_auth_admin`);
    await db.query(`
      create or replace function public.madar_access_token_hook(event jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
      begin
        insert into public.g1_hook_events (event) values (event);
        return jsonb_build_object('claims', event->'claims');
      end $$`);
    try {
      const clientId = await registerClient('G1 hook event probe');
      const { tokens } = await connectAgent(clientId);
      await refresh(clientId, tokens!.refresh_token);
      const { rows } = await db.query<{ event: Record<string, unknown> & { claims: Record<string, unknown> } }>(
        `select event from public.g1_hook_events order by n`,
      );
      const agentEvents = rows.map((row) => row.event).filter((event) => event.claims.client_id === clientId || event.client_id === clientId);
      expect(agentEvents.length).toBe(2);
      for (const event of agentEvents) {
        expect(event.claims.client_id).toBe(clientId);
        expect([event.claims.aud].flat()).toEqual(['authenticated']);
      }
      console.info('G1 hook events:', JSON.stringify(agentEvents.map((event) => ({
        topLevelKeys: Object.keys(event).sort(),
        claimKeys: Object.keys(event.claims).sort(),
        authentication_method: event.authentication_method,
        topLevelClientId: event.client_id ?? null,
      }))));
    } finally {
      await db.query(readFileSync(MIGRATION, 'utf8'));
      await db.query(`drop table if exists public.g1_hook_events`);
    }
  });

  // Last in the file: a password change can end the other sessions of the person.
  it("shows that Auth's own endpoints give an agent token the rights of the person (the proof records it; security review, risk 4)", async () => {
    const admin = createClient(stack.apiUrl, stack.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const clientA = await registerClient('G1 probe, agent A');
    const clientB = await registerClient('G1 probe, agent B');
    const a = (await connectAgent(clientA)).tokens!;
    const b = (await connectAgent(clientB)).tokens!;
    const asAgent = { apikey: stack.anonKey, Authorization: `Bearer ${a.access_token}` };
    const NEW_PASSWORD = 'g1-hook-password-2';
    const seen: Record<string, number | boolean | string> = {};
    try {
      // The grants of the person, read and revoked with the token of agent A.
      const grants = await fetch(`${stack.apiUrl}/auth/v1/user/oauth/grants`, { headers: asAgent });
      seen.listGrants = grants.status;
      const grantBody = await grants.text();
      seen.listShowsAgentB = grantBody.includes(clientB);
      const revoke = await fetch(`${stack.apiUrl}/auth/v1/user/oauth/grants?client_id=${clientB}`, { method: 'DELETE', headers: asAgent });
      seen.revokeOtherAgent = revoke.status;
      const bRefresh = await fetch(`${stack.apiUrl}/auth/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: b.refresh_token, client_id: clientB }),
      });
      seen.agentBRefreshAfterRevoke = bRefresh.status;

      // A new password for the person, set with the agent token, then a sign-in to the screens with it.
      const put = await fetch(`${stack.apiUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: { ...asAgent, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: NEW_PASSWORD }),
      });
      seen.changePassword = put.status;
      if (!put.ok) seen.changePasswordBody = (await put.text()).slice(0, 200);
      const again = createClient(stack.apiUrl, stack.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const signedIn = await again.auth.signInWithPassword({ email: EMAIL, password: NEW_PASSWORD });
      seen.signInWithNewPassword = signedIn.error === null;
      console.info('G1 agent token on Auth endpoints:', JSON.stringify(seen));

      expect(seen.listGrants).toBe(200);
      expect(seen.listShowsAgentB).toBe(true);
      expect(seen.revokeOtherAgent).toBeLessThan(300);
      expect(seen.agentBRefreshAfterRevoke).toBeGreaterThanOrEqual(400);
      expect(seen.changePassword).toBe(200);
      expect(seen.signInWithNewPassword).toBe(true);
    } finally {
      await admin.auth.admin.updateUserById(personId, { password: PASSWORD });
    }
  });
});
