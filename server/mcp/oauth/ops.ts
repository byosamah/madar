import { z } from 'zod';
import { ApiError } from '../../../src/api/errors';
import { randomToken, sha256Hex } from '../../auth/own/crypto';
import { HOUR_MS, REGISTER_PER_ADDRESS } from '../../auth/own/limits';
import { countLimits } from '../../auth/own/sessions';
import { OAuthError, type SigninDeps } from '../../auth/own/types';
import { ownIssuer } from '../../auth/ownKeys';
import { principalOf } from '../../auth/principal';
import { hashedKey } from '../../auth/rateLimit';
import type { LiteDb } from '../../data/lite/db';
import { readLiteOffice } from '../../data/lite/office';
import { notApproved } from '../agentUser';
import { APPROVAL_LITE, recordApproval, REMOVED_LINK_LITE } from '../approval';
import { redirectAllowed, registrable, withQuery } from './redirects';
import {
  CLIENT_BY_ID, CLIENT_INSERT, GRANT_REVOKE, GRANTS_LITE, REQUEST_APPROVE, REQUEST_BIND, REQUEST_BY_ID, REQUEST_DENY, REQUEST_INSERT,
  type ClientRow, type RequestRow,
} from './rows';

/**
 * The OAuth 2.1 steps of the own sign-in for agents (Supabase exit, wave 2). They run in the office object, like the browser steps:
 * crypto first, then SQL only inside a transaction. Tasks 18 and 19 add the consent, the grants and the token steps.
 */

/** An authorize request waits 10 minutes for the person. */
export const REQUEST_LIFE_MS = 10 * 60_000;
/** A code works once, for 60 seconds. */
export const CODE_LIFE_MS = 60_000;

const RegisterBody = z.object({
  client_name: z.string().trim().max(200).optional(),
  redirect_uris: z.array(z.string().min(1)).min(1).max(10),
  token_endpoint_auth_method: z.string().optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

export type RegisteredClient = {
  client_id: string; client_id_issued_at: number; client_name?: string; redirect_uris: string[];
  grant_types: string[]; response_types: string[]; token_endpoint_auth_method: 'none';
};

/** POST /mcp/oauth/register (RFC 7591): a public client (PKCE, no secret) with safe return addresses. */
export async function registerClient(deps: SigninDeps, input: { body: unknown; address: string }): Promise<RegisteredClient> {
  await countLimits(deps, [{ key: await hashedKey('register:ip', input.address), limit: REGISTER_PER_ADDRESS, windowMs: HOUR_MS }]);
  const parsed = RegisterBody.safeParse(input.body);
  if (!parsed.success) throw new OAuthError(400, 'invalid_client_metadata', 'The client metadata is not valid.');
  const body = parsed.data;
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
    throw new OAuthError(400, 'invalid_client_metadata', 'Madar takes public clients only: token_endpoint_auth_method none.');
  }
  if (!body.redirect_uris.every(registrable)) throw new OAuthError(400, 'invalid_redirect_uri', 'A return address is not safe.');
  const id = crypto.randomUUID();
  const now = deps.clock.now();
  await deps.db.tx('write', (q) => q(CLIENT_INSERT, [id, body.client_name ?? null, JSON.stringify(body.redirect_uris), now.toISOString()]));
  return {
    client_id: id, client_id_issued_at: Math.floor(now.getTime() / 1000), ...(body.client_name ? { client_name: body.client_name } : {}),
    redirect_uris: body.redirect_uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
  };
}

const AuthorizeQuery = z.object({
  response_type: z.literal('code'),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  state: z.string().max(2000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(2000).optional(),
});

/**
 * GET /mcp/oauth/authorize: the request waits in oauth_requests, and the person goes to the Madar consent screen. Until the client
 * and its return address hold, no error goes to the address (RFC 6749, section 4.1.2.1). The resource must be MCP_URL (RFC 8707).
 */
export async function startAuthorization(deps: SigninDeps, input: { query: Record<string, string> }): Promise<{ redirect: string }> {
  const { client_id: clientId, redirect_uri: redirectUri, state } = input.query;
  const [client] = clientId ? await deps.db.statement<ClientRow>('read', CLIENT_BY_ID, [clientId]) : [];
  if (!client || !redirectUri || !redirectAllowed(JSON.parse(client.redirect_uris) as string[], redirectUri)) {
    throw new OAuthError(400, 'invalid_request', 'Madar does not know this AI app or its return address. Connect it again in the AI app.');
  }
  const parsed = AuthorizeQuery.safeParse(input.query);
  if (!parsed.success) {
    return { redirect: withQuery(redirectUri, { error: 'invalid_request', error_description: 'Madar needs response_type code and a PKCE S256 challenge.', state }) };
  }
  if (parsed.data.resource !== undefined && ownIssuer(parsed.data.resource) !== ownIssuer(deps.config.mcpUrl)) {
    return { redirect: withQuery(redirectUri, { error: 'invalid_target', state }) };
  }
  const id = randomToken(16);
  const now = deps.clock.now();
  await deps.db.tx('write', (q) => q(REQUEST_INSERT, [
    id, client.id, redirectUri, parsed.data.state ?? null, parsed.data.code_challenge, parsed.data.scope ?? null, parsed.data.resource ?? null,
    new Date(now.getTime() + REQUEST_LIFE_MS).toISOString(), now.toISOString(),
  ]));
  return { redirect: `${deps.config.appUrl.replace(/\/+$/, '')}/oauth/consent?authorization_id=${encodeURIComponent(id)}` };
}

export type DetailsAnswer = { redirect_url: string } | { authorization_id: string; client: { id: string; name: string }; redirect_uri: string };
export type GrantRow = { client_id: string; client_name: string; granted_at: string };

function ended(): ApiError {
  return new ApiError('not_found', 'This approval request ended. Start the connection again in your AI app.', { reason: 'authorization_ended' });
}

const open = (request: RequestRow | undefined, authId: string, now: Date): request is RequestRow =>
  request !== undefined && request.status === 'pending' && request.expires_at > now.toISOString() && (request.auth_id === null || request.auth_id === authId);

/**
 * GET /api/oauth/authorizations/:id (the consent screen). The first person who opens a request owns it; for anyone else it reads as
 * an unknown request, with no client name. A client that this person approved before, whose link Madar did not remove, gets its
 * code at once (as Supabase gave the redirect of a known client, proof.md G3).
 */
export async function authorizationDetails(deps: SigninDeps, input: { authId: string; id: string }): Promise<DetailsAnswer> {
  const code = randomToken();
  const codeHash = await sha256Hex(code);
  const now = deps.clock.now();
  return deps.db.tx('write', async (q) => {
    const [request] = await q<RequestRow>(REQUEST_BY_ID, [input.id]);
    if (!open(request, input.authId, now)) throw ended();
    const ownerId = principalOf(input.authId, await readLiteOffice(deps.db as LiteDb, q)).userId;
    if (request.auth_id === null) await q(REQUEST_BIND, [request.id, input.authId]);
    const [approved] = await q(APPROVAL_LITE, [request.client_id, ownerId]);
    const [removed] = await q(REMOVED_LINK_LITE, [request.client_id, ownerId]);
    if (approved && !removed) {
      await q(REQUEST_APPROVE, [request.id, codeHash, new Date(now.getTime() + CODE_LIFE_MS).toISOString()]);
      return { redirect_url: withQuery(request.redirect_uri, { code, state: request.state }) };
    }
    const [client] = await q<ClientRow>(CLIENT_BY_ID, [request.client_id]);
    return { authorization_id: request.id, client: { id: request.client_id, name: client?.name?.trim() ?? '' }, redirect_uri: request.redirect_uri };
  });
}

/** POST /api/agents/approve on the own stack: the Madar approval (recordApproval, approval.ts) of a request of this person. */
export async function approveClient(deps: SigninDeps, input: { authId: string; id: string }): Promise<{ approved: true }> {
  const now = deps.clock.now();
  await deps.db.tx('write', async (q) => {
    const ownerId = principalOf(input.authId, await readLiteOffice(deps.db as LiteDb, q)).userId;
    await recordApproval(q, { authorizationId: input.id, authUserId: input.authId, ownerId, now });
  });
  return { approved: true };
}

/** POST /api/oauth/authorizations/:id/consent. Approve gives a code only after the Madar approval; deny records nothing. */
export async function answerConsent(deps: SigninDeps, input: { authId: string; id: string; action: 'approve' | 'deny' }): Promise<{ redirect_url: string }> {
  const code = randomToken();
  const codeHash = await sha256Hex(code);
  const now = deps.clock.now();
  return deps.db.tx('write', async (q) => {
    const [request] = await q<RequestRow>(REQUEST_BY_ID, [input.id]);
    if (!open(request, input.authId, now) || request.auth_id !== input.authId) throw ended();
    if (input.action === 'deny') {
      await q(REQUEST_DENY, [request.id]);
      return { redirect_url: withQuery(request.redirect_uri, { error: 'access_denied', state: request.state }) };
    }
    const ownerId = principalOf(input.authId, await readLiteOffice(deps.db as LiteDb, q)).userId;
    if ((await q(APPROVAL_LITE, [request.client_id, ownerId])).length === 0) throw notApproved();
    await q(REQUEST_APPROVE, [request.id, codeHash, new Date(now.getTime() + CODE_LIFE_MS).toISOString()]);
    return { redirect_url: withQuery(request.redirect_uri, { code, state: request.state }) };
  });
}

/** POST /api/oauth/grants (Settings, Agents): the AI apps with a live agent session of this person. */
export async function listGrants(deps: SigninDeps, input: { authId: string }): Promise<GrantRow[]> {
  const rows = await deps.db.statement<GrantRow>('read', GRANTS_LITE, [input.authId, deps.clock.now().toISOString()]);
  return [...rows].sort((a, b) => a.granted_at.localeCompare(b.granted_at) || a.client_id.localeCompare(b.client_id));
}

/** POST /api/oauth/grants/revoke: ends the agent sessions of one AI app of this person. An app with none is done already. */
export async function revokeGrant(deps: SigninDeps, input: { authId: string; clientId: string }): Promise<{ ok: true }> {
  await deps.db.tx('write', (q) => q(GRANT_REVOKE, [input.authId, input.clientId, deps.clock.now().toISOString()]));
  return { ok: true };
}
