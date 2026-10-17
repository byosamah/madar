import { z } from 'zod';
import { ApiError, invalid } from '../../src/api/errors';
import { principalOf as realPrincipalOf } from '../auth/principal';
import { verifyBrowserToken } from '../auth/verify';
import type { Deps, Query } from '../core/ports';
import type { OfficeSnapshot, Principal } from '../core/types';
import { isLite } from '../data/dialect';
import { readOffice as realReadOffice } from '../data/officeCache';
import { errorResponse, runErrorOf } from '../http/errors';
import { readBody } from '../http/limits';
import type { RouteDef } from '../http/routes';

/**
 * The approval that a person records in Madar for an AI app (plan 5.6; task G4; proof.md Z0a item 2 and section G4).
 *
 * Supabase Auth lets an agent token approve an OAuth client that the agent registered itself, so an approval at Auth alone proves
 * nothing about the person. The consent screen (src/features/oauth/ConsentScreen.tsx) first sends POST /agents/approve to the api
 * function with the person's browser token, and only then asks Auth to approve. ensureAgentUser (agentUser.ts) makes an agent
 * link only for a client with an approval of the same person.
 *
 * - The token: the browser token check of the api function, which refuses every agent token (403 agent_token). So an agent cannot
 *   record an approval, also not with a token of the same person.
 * - The person: principalOf, so a turned-off person or a sign-in with no Madar account records nothing.
 * - The client: never from the browser. The route reads it from Auth's pending authorization of this person
 *   (madar_private.agent_authorization, 20261004000402_platform_agent_approvals.sql). An authorization that Auth already approved,
 *   denied or let expire, or that belongs to someone else, gives invalid_input with the reason authorization_ended.
 * - A removed agent: when the person removed the link of this client (Settings, Agents, or agents.revokeAll), the route refuses
 *   with forbidden, reason agent_removed. A removed link never links again, so the AI app must register a new client.
 *
 * This module holds no MCP code, so the api bundle carries it. server/http/routes.ts mounts APPROVE_ROUTE (merge lead patch of G4).
 */

export const APPROVE_PATH = '/agents/approve';

export const AUTHORIZATION_SQL = 'select madar_private.agent_authorization($1::text, $2::uuid)::text as client_id';
/** A second approval of the same client by the same person keeps the first one. */
export const APPROVAL_INSERT_SQL = 'insert into agent_approvals (client_id, owner_user_id) values ($1::uuid, $2) on conflict (client_id, owner_user_id) do nothing';
/**
 * A removed link of this client and person (agent_links.revoked_at). A removed link never links again (G3), so an approval of the
 * same client would let Auth give tokens that Madar refuses with 401 on every call, and the AI app would loop through the consent
 * screen with no word to the person (review of G4).
 */
export const REMOVED_LINK_SQL = 'select 1 as removed from agent_links where client_id = $1::uuid and owner_user_id = $2 and revoked_at is not null';
/** The approval that ensureAgentUser needs before it links a client to the person. */
export const APPROVAL_SQL = 'select 1 as approved from agent_approvals where client_id = $1::uuid and owner_user_id = $2';

/** The SQLite forms (Supabase exit, wave 2): the pending authorization is a row of oauth_requests, bound to the person who opened it. */
export const AUTHORIZATION_LITE = "select client_id from oauth_requests where id = ?1 and auth_id = ?2 and status = 'pending' and expires_at > ?3";
export const APPROVAL_INSERT_LITE = 'insert into agent_approvals (client_id, owner_user_id, approved_at) values (?1, ?2, ?3) on conflict (client_id, owner_user_id) do nothing';
export const REMOVED_LINK_LITE = 'select 1 as removed from agent_links where client_id = ?1 and owner_user_id = ?2 and revoked_at is not null';
export const APPROVAL_LITE = 'select 1 as approved from agent_approvals where client_id = ?1 and owner_user_id = ?2';

const Body = z.object({ authorizationId: z.string().trim().min(1).max(200) });

export type ApproveOptions = {
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  principalOf: (authUserId: string, office: OfficeSnapshot) => Principal;
  readOffice: (deps: Deps) => Promise<OfficeSnapshot>;
};

/**
 * Records the approval of the client of one pending authorization for the signed-in person. now: the time of the check on SQLite
 * (an oauth_requests row ends at expires_at); Postgres asks Auth, which checks it itself.
 */
export async function recordApproval(q: Query, o: { authorizationId: string; authUserId: string; ownerId: string; now?: Date }): Promise<{ clientId: string }> {
  const lite = isLite(q);
  const now = (o.now ?? new Date()).toISOString();
  const [row] = lite
    ? await q<{ client_id: string | null }>(AUTHORIZATION_LITE, [o.authorizationId, o.authUserId, now])
    : await q<{ client_id: string | null }>(AUTHORIZATION_SQL, [o.authorizationId, o.authUserId]);
  const clientId = row?.client_id ?? null;
  if (clientId === null) {
    throw invalid('authorizationId', 'This approval request ended. Start the connection again in your AI app.', 'authorization_ended');
  }
  const [removed] = await q(lite ? REMOVED_LINK_LITE : REMOVED_LINK_SQL, [clientId, o.ownerId]);
  if (removed) {
    throw new ApiError('forbidden', 'You removed this AI app in Madar. In the AI app, remove the Madar connection and add it again.', { reason: 'agent_removed' });
  }
  if (lite) await q(APPROVAL_INSERT_LITE, [clientId, o.ownerId, now]);
  else await q(APPROVAL_INSERT_SQL, [clientId, o.ownerId]);
  return { clientId };
}

export async function handleApprove(request: Request, deps: Deps, o: ApproveOptions): Promise<Response> {
  try {
    const { authUserId } = await o.verifyToken(request.headers.get('Authorization'));
    let body: unknown;
    try {
      body = JSON.parse(await readBody(request));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw invalid('authorizationId', 'Send the approval as JSON.');
    }
    const parsed = Body.safeParse(body);
    if (!parsed.success) throw invalid('authorizationId', 'Send the authorization id of the consent screen.');
    const office = await o.readOffice(deps);
    const principal = o.principalOf(authUserId, office);
    await deps.db.tx('write', (q) => recordApproval(q, { authorizationId: parsed.data.authorizationId, authUserId, ownerId: principal.userId }));
    return Response.json({ approved: true });
  } catch (error) {
    if (!(error instanceof ApiError)) deps.log.error('The agent approval failed.', { error: error instanceof Error ? error.message : String(error) });
    return errorResponse(runErrorOf(error));
  }
}

export function approveRoute(o: Partial<ApproveOptions> = {}): RouteDef {
  const options: ApproveOptions = {
    verifyToken: o.verifyToken ?? verifyBrowserToken,
    principalOf: o.principalOf ?? realPrincipalOf,
    readOffice: o.readOffice ?? ((d) => realReadOffice(d)),
  };
  return { method: 'POST', path: APPROVE_PATH, handler: (request, deps) => handleApprove(request, deps, options) };
}

export const APPROVE_ROUTE: RouteDef = approveRoute();

/** The routes of the api app with this approval route once, also before and after server/http/routes.ts mounts it (tests). */
export function withApproveRoute(routes: readonly RouteDef[], route: RouteDef = APPROVE_ROUTE): RouteDef[] {
  return [...routes.filter((r) => !(r.method === route.method && r.path === route.path)), route];
}
