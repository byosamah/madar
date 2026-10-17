import { z } from 'zod';
import { randomToken } from '../../auth/own/crypto';
import { HOUR_MS, REGISTER_PER_ADDRESS } from '../../auth/own/limits';
import { countLimits } from '../../auth/own/sessions';
import { OAuthError, type SigninDeps } from '../../auth/own/types';
import { ownIssuer } from '../../auth/ownKeys';
import { hashedKey } from '../../auth/rateLimit';
import { redirectAllowed, registrable, withQuery } from './redirects';
import { CLIENT_BY_ID, CLIENT_INSERT, REQUEST_INSERT, type ClientRow } from './rows';

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
