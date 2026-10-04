import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { ApiError } from '../../src/api/errors';
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
 * - No link: the first call of a new approval. ensureAgentUser (agentUser.ts) makes the link, then the statement runs again.
 * - A removed link: 401, also for a session that started after the removal. A new session alone does not prove that the person
 *   approved again (Auth can remember an earlier consent). G4 adds the approval that the person records in Madar; until then a
 *   removed client never links again (security review of G3, 2026-10-04).
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
 * SUPABASE_URL http://kong:8000, its tokens name http://127.0.0.1:54321/auth/v1), and the audience MCP_URL.
 */
export function agentTokenCheckerOf(o: { supabaseUrl: string; mcpUrl: string; issuer?: string }): AgentTokenChecker {
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

/** The issuer that the metadata document names: AUTH_ISSUER, or ${SUPABASE_URL}/auth/v1. */
export function authIssuerOf(supabaseUrl: string): string {
  return env('AUTH_ISSUER') ?? issuerOf(supabaseUrl);
}

export const AGENT_SQL = [
  'select l.agent_user_id, l.owner_user_id, l.revoked_at,',
  ' madar_private.agent_session_at($1::uuid, $2::uuid) as session_at,',
  ' madar_private.agent_session_ok($1::uuid, $2::uuid) as ok',
  ' from (values (1)) as one(x) left join agent_links l on l.client_id = $2::uuid',
].join('');

export type AgentRow = { agent_user_id: string | null; owner_user_id: string | null; revoked_at: Date | string | null; session_at: Date | string | null; ok: boolean };
export type AgentQuery = <R>(text: string, values?: unknown[]) => Promise<R[]>;
export type EnsureAgent = (o: { ownerId: string; clientId: string }) => Promise<void>;
export type AgentPrincipal = { principal: Principal; ownerId: string; linked: boolean };

export function agentPrincipalResolver(o: { query: AgentQuery; office: () => Promise<OfficeSnapshot>; ensure: EnsureAgent }) {
  const read = async (token: AgentToken): Promise<AgentRow> => {
    const [row] = await o.query<AgentRow>(AGENT_SQL, [token.sessionId, token.clientId]);
    if (!row) throw new Error('The agent check gave no row.');
    return row;
  };
  const principalOf = (row: AgentRow, token: AgentToken, linked: boolean): AgentPrincipal => ({
    principal: { userId: row.agent_user_id!, agent: { clientId: token.clientId } }, ownerId: row.owner_user_id!, linked,
  });

  return async (token: AgentToken): Promise<AgentPrincipal> => {
    const row = await read(token);
    if (row.session_at === null) throw signInAgain('This sign-in ended. Connect Madar again in your AI app.');
    if (row.agent_user_id !== null) {
      if (row.revoked_at !== null) throw signInAgain('This agent was removed in Madar. Connect it again in your AI app.');
      if (row.ok) return principalOf(row, token, false);
      const office = await o.office();
      const owner = office.lists.users[row.owner_user_id ?? ''];
      const agent = office.lists.users[row.agent_user_id ?? ''];
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
