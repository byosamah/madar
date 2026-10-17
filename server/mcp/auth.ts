import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { ApiError } from '../../src/api/errors';
import { OWN_AUTH_SECRET, ownIssuer, ownKeySet } from '../auth/ownKeys';
import { issuerOf } from '../auth/verify';
import { env } from '../env';
import { userIdOfAuth } from '../data/officeCache';
import type { OfficeSnapshot, Principal } from '../core/types';

/**
 * The token check of the mcp function (plan 5.6; plan section 2, change 6; proof.md Z0a item 2 and G1).
 *
 * The token:
 * - jose jwtVerify against the JWKS of Supabase Auth, ES256 only, with the issuer of Auth and audience = MCP_URL. The token hook
 *   (20261004000400_platform_auth_hook.sql) sets that aud on every agent token. jose accepts aud as a string or a list, so the
 *   check never compares aud by hand. A browser token keeps aud "authenticated" and fails here.
 * - client_id is required: only an OAuth client (an agent) has it. session_id is required: the session check needs it.
 * - A refusal is unauthenticated (401 with the WWW-Authenticate challenge). A key set that cannot load is a plain Error, so the
 *   app answers a hidden 500 and never tells an agent to sign in again because of an outage.
 * - The token comes only from the Authorization header, never from the query string (platform facts 7.2, point 27).
 *
 * The agent behind a checked token, with one statement (AGENT_SQL): the agent link of the client, whether its session lives, and
 * madar_private.agent_session_ok (the Auth session still exists and belongs to the person who approved the link, the link is
 * not removed, the person and the agent are both on).
 * - No link: the first call of a new approval. ensureAgentUser (agentUser.ts) makes the link only when the person recorded an
 *   approval of this client on the Madar consent screen (approval.ts, task G4), then the statement runs again.
 * - A removed link: 401, also for a session that started after the removal. A new session alone does not prove that the person
 *   approved again (Auth can remember an earlier consent, and an agent token can approve at Auth). A removed client never links
 *   again (security review of G3, 2026-10-04): the AI app registers a new client, and the person approves that one in Madar.
 * - A session that is gone: 401, so the agent signs in again.
 * - A live link whose check fails: the person or the agent is off (unauthenticated with the reason account_off, 403), or the
 *   session belongs to another person than the one who approved the client (401).
 */

export type AgentToken = { token: string; authUserId: string; clientId: string; sessionId: string; expiresAt?: number };
export type AgentTokenChecker = (header: string | null) => Promise<AgentToken>;

const CLOCK_TOLERANCE_S = 5;
const BEARER = /^bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i;
const TOKEN_REFUSALS = new Set([
  'ERR_JWT_EXPIRED', 'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWT_INVALID', 'ERR_JWS_INVALID', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JOSE_ALG_NOT_ALLOWED', 'ERR_JOSE_NOT_SUPPORTED', 'ERR_JWKS_NO_MATCHING_KEY', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
]);

export function signInAgain(message = 'Sign in to Madar again in your AI app.', reason?: string): ApiError {
  return new ApiError('unauthenticated', message, reason ? { reason } : {});
}

function accountOff(): ApiError {
  return new ApiError('unauthenticated', 'This account or this agent is turned off in Madar.', { reason: 'account_off' });
}

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

export function agentTokenChecker(o: { issuer: string; audience: string; jwks: JWTVerifyGetKey }): AgentTokenChecker {
  return async (header) => {
    const match = header === null ? null : BEARER.exec(header.trim());
    if (!match) throw signInAgain('Send the Madar access token in the Authorization header.');
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(match[1], o.jwks, { issuer: o.issuer, audience: o.audience, algorithms: ['ES256'], clockTolerance: CLOCK_TOLERANCE_S }));
    } catch (error) {
      if (error instanceof errors.JWTExpired) throw signInAgain('The access token expired. Refresh it.', 'token_expired');
      if (error instanceof errors.JOSEError && TOKEN_REFUSALS.has(error.code)) throw signInAgain('This access token is not for Madar\'s MCP server.');
      throw new Error(`The agent token check did not run: ${error instanceof errors.JOSEError ? error.code : error instanceof Error ? error.message : String(error)}`);
    }
    if (!text(payload.client_id)) throw signInAgain('This access token is not for Madar\'s MCP server.');
    if (!text(payload.session_id) || !text(payload.sub) || payload.role !== 'authenticated') throw signInAgain();
    return {
      token: match[1], authUserId: payload.sub, clientId: payload.client_id, sessionId: payload.session_id,
      ...(typeof payload.exp === 'number' ? { expiresAt: payload.exp } : {}),
    };
  };
}

/** One checker for each set of addresses. jose keeps the key set in memory and loads it again after a new kid or 10 minutes. */
const checkers = new Map<string, AgentTokenChecker>();

/**
 * The checker of a project: the JWKS of ${SUPABASE_URL}/auth/v1, the issuer AUTH_ISSUER or that address (a local function sees
 * SUPABASE_URL http://kong:8000, its tokens name http://127.0.0.1:54321/auth/v1), and the audience MCP_URL. With the secret
 * MADAR_AUTH_PRIVATE_JWK (the own sign-in, Supabase exit wave 2), the own key and the own issuer (MCP_URL) in place of Supabase.
 */
export function agentTokenCheckerOf(o: { supabaseUrl: string; mcpUrl: string; issuer?: string }): AgentTokenChecker {
  const own = env(OWN_AUTH_SECRET);
  if (own !== undefined) return agentTokenChecker({ issuer: ownIssuer(o.mcpUrl), audience: o.mcpUrl, jwks: ownKeySet(own) });
  const auth = issuerOf(o.supabaseUrl);
  const issuer = o.issuer ?? env('AUTH_ISSUER') ?? auth;
  const id = `${auth}|${issuer}|${o.mcpUrl}`;
  let checker = checkers.get(id);
  if (!checker) {
    checker = agentTokenChecker({ issuer, audience: o.mcpUrl, jwks: createRemoteJWKSet(new URL(`${auth}/.well-known/jwks.json`)) });
    checkers.set(id, checker);
  }
  return checker;
}

/** The issuer that the metadata document names: the own issuer (MCP_URL) with the secret, else AUTH_ISSUER or ${SUPABASE_URL}/auth/v1. */
export function authIssuerOf(supabaseUrl: string, mcpUrl?: string): string {
  if (env(OWN_AUTH_SECRET) !== undefined && mcpUrl !== undefined) return ownIssuer(mcpUrl);
  return env('AUTH_ISSUER') ?? issuerOf(supabaseUrl);
}

export const AGENT_SQL = [
  'select l.agent_user_id, l.owner_user_id, l.revoked_at,',
  ' madar_private.agent_session_at($1::uuid, $2::uuid) as session_at,',
  ' madar_private.agent_session_ok($1::uuid, $2::uuid) as ok',
  ' from (values (1)) as one(x) left join agent_links l on l.client_id = $2::uuid',
].join('');

/**
 * The SQLite form (Supabase exit, wave 2). The session is a row of auth_sessions: ok checks the session, its client, the ban and the
 * person of the session; the resolver checks that the person and the agent are on, from the office in memory (no row read).
 */
export const AGENT_LITE = [
  'select l.agent_user_id as agent_user_id, l.owner_user_id as owner_user_id, l.revoked_at as revoked_at,',
  ' case when s.revoked_at is null and s.expires_at > ?3 then s.created_at end as session_at,',
  ' case when s.revoked_at is null and s.expires_at > ?3 and s.client_id = ?2 and a.banned = 0 and a.user_id = l.owner_user_id and l.revoked_at is null then 1 else 0 end as ok',
  ' from (select 1) as one left join auth_sessions s on s.id = ?1 left join auth_users a on a.id = s.auth_id left join agent_links l on l.client_id = ?2',
].join('');

export type AgentRow = { agent_user_id: string | null; owner_user_id: string | null; revoked_at: Date | string | null; session_at: Date | string | null; ok: boolean | number };
export type AgentQuery = <R>(text: string, values?: unknown[]) => Promise<R[]>;
export type EnsureAgent = (o: { ownerId: string; clientId: string }) => Promise<void>;
export type AgentPrincipal = { principal: Principal; ownerId: string; linked: boolean };

/** lite: the SQLite path (AGENT_LITE), with the clock that ends a session at expires_at. */
export function agentPrincipalResolver(o: { query: AgentQuery; office: () => Promise<OfficeSnapshot>; ensure: EnsureAgent; lite?: { now: () => Date } }) {
  const read = async (token: AgentToken): Promise<AgentRow> => {
    const [row] = o.lite
      ? await o.query<AgentRow>(AGENT_LITE, [token.sessionId, token.clientId, o.lite.now().toISOString()])
      : await o.query<AgentRow>(AGENT_SQL, [token.sessionId, token.clientId]);
    if (!row) throw new Error('The agent check gave no row.');
    // SQLite gives ok as 1 or 0.
    return { ...row, ok: Boolean(row.ok) };
  };
  const principalOf = (row: AgentRow, token: AgentToken, linked: boolean): AgentPrincipal => ({
    principal: { userId: row.agent_user_id!, agent: { clientId: token.clientId } }, ownerId: row.owner_user_id!, linked,
  });

  return async (token: AgentToken): Promise<AgentPrincipal> => {
    const row = await read(token);
    if (row.session_at === null) throw signInAgain('This sign-in ended. Connect Madar again in your AI app.');
    if (row.agent_user_id !== null) {
      if (row.revoked_at !== null) throw signInAgain('This agent was removed in Madar. Connect it again in your AI app.');
      // Postgres: agent_session_ok checked that the person and the agent are on. The path of today stays as it is.
      if (row.ok && !o.lite) return principalOf(row, token, false);
      const office = await o.office();
      const owner = office.lists.users[row.owner_user_id ?? ''];
      const agent = office.lists.users[row.agent_user_id ?? ''];
      // SQLite checks it here, on the office in memory, with no row read.
      if (row.ok && owner?.active && agent?.active) return principalOf(row, token, false);
      if (!owner?.active || !agent?.active) throw accountOff();
      throw signInAgain('This connection belongs to another Madar person.');
    }

    // The first call of a new approval: the person behind the sign-in must be an active Madar person.
    const office = await o.office();
    const ownerId = userIdOfAuth(office, token.authUserId);
    const owner = ownerId === undefined ? undefined : office.lists.users[ownerId];
    if (!owner || owner.kind !== 'human') throw signInAgain('This sign-in has no Madar account. Ask an Admin.');
    if (!owner.active) throw accountOff();
    await o.ensure({ ownerId: owner.id, clientId: token.clientId });
    const linked = await read(token);
    if (!linked.ok || linked.agent_user_id === null) throw signInAgain('Madar could not link this agent. Connect it again in your AI app.');
    return principalOf(linked, token, true);
  };
}
