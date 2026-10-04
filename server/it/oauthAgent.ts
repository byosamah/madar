import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { buildSeed } from '../../src/data/seed';
import { pgDb, type PgDb } from '../data/sql';
import { writeState } from '../data/whole';
import { localClient, localDbUrl } from './migrate';

/**
 * The agent side of the MCP suites on the local stack (task G3): the OAuth 2.1 flow of an MCP client against the local Auth
 * server (dynamic client registration, the authorize step with PKCE, the approval through the Auth API as the consent screen
 * does it, the code exchange), and the office in the public schema, where the platform migrations put the madar_private
 * functions that the MCP token check uses. It talks only to 127.0.0.1.
 */

export const LOCAL_API = 'http://127.0.0.1:54321';
export const LOCAL_MCP_URL = `${LOCAL_API}/functions/v1/mcp`;
export const REDIRECT_URI = 'http://127.0.0.1:33418/callback';

export type AgentTokens = { access_token: string; refresh_token: string; token_type: string; expires_in: number };

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** Dynamic client registration, as an MCP client does it (RFC 7591): a public client with PKCE and no secret. */
export async function registerClient(name: string, redirectUri = REDIRECT_URI): Promise<string> {
  const response = await fetch(`${LOCAL_API}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }),
  });
  const body = (await response.json()) as { client_id?: string };
  if (!response.ok || !body.client_id) throw new Error(`The client registration failed: ${response.status} ${JSON.stringify(body)}`);
  return body.client_id;
}

/** The authorize step, the approval by the signed-in person, and the code exchange. */
export async function connectAgent(person: SupabaseClient, clientId: string, o: { redirectUri?: string; resource?: string } = {}): Promise<AgentTokens> {
  const redirectUri = o.redirectUri ?? REDIRECT_URI;
  const resource = o.resource ?? LOCAL_MCP_URL;
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(12));
  const authorize = new URL(`${LOCAL_API}/auth/v1/oauth/authorize`);
  authorize.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', state, resource,
  }).toString();
  const start = await fetch(authorize, { redirect: 'manual' });
  const consent = start.headers.get('location');
  if (!consent?.includes('authorization_id=')) throw new Error(`The authorize step gave no consent page: ${start.status}`);
  const authorizationId = new URL(consent).searchParams.get('authorization_id')!;
  const details = await person.auth.oauth.getAuthorizationDetails(authorizationId);
  if (details.error) throw details.error;
  // A client that the person approved before needs no new approval: the details carry the redirect at once (platform facts 6.3).
  let redirect: string;
  if (details.data && !('authorization_id' in details.data)) {
    redirect = (details.data as { redirect_url: string }).redirect_url;
  } else {
    const approved = await person.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (approved.error) throw approved.error;
    redirect = approved.data!.redirect_url;
  }
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error('The approval gave no code.');
  const response = await fetch(`${LOCAL_API}/auth/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier, resource }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`The code exchange failed: ${response.status} ${text}`);
  return JSON.parse(text) as AgentTokens;
}

/**
 * The office in the public schema. The first suite after "supabase db reset" writes the sample office; a later run uses the
 * office as it is, so the suites never assume a fixed agent id. The server pool is madar_server through the startup role:
 * the local superuser supabase_admin logs in and role madar_server applies (postgres is no superuser on Supabase and may not
 * take the role), so no suite changes the login of madar_server under another suite. Local test values only.
 */
export type PublicOffice = { admin: pg.Client; db: PgDb; close(): Promise<void> };

export async function publicOffice(o: { mcpUrl?: string } = {}): Promise<PublicOffice> {
  const admin = await localClient();
  await admin.query('set search_path to public');
  const url = new URL(localDbUrl());
  url.username = 'supabase_admin';
  url.searchParams.set('options', '-c role=madar_server');
  const db = pgDb({ writeUrl: url.toString(), readUrl: url.toString() });
  const [{ n }] = (await admin.query<{ n: string }>('select count(*) as n from public.users')).rows;
  if (Number(n) === 0) await db.tx('write', async (q) => writeState(q, await buildSeed('2026-10-04', async () => undefined)));
  await admin.query("insert into public.platform_config (key, value) values ('mcp_url', $1) on conflict (key) do update set value = excluded.value", [o.mcpUrl ?? LOCAL_MCP_URL]);
  return {
    admin,
    db,
    async close() {
      await db.close().catch(() => undefined);
      await admin.end().catch(() => undefined);
    },
  };
}

/** Gives a person of the office an Auth user of this run, with a new office version, as the save step and setAuthUserId do. */
export const RELINK_SQL =
  "with v as (update office_meta set version = version + 1 returning version) update users set doc = jsonb_set(doc, '{email}', to_jsonb($2::text)), auth_user_id = $3::uuid, chg = (select version from v) where id = $1";
