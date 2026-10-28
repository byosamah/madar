import { z } from 'zod';
import { ApiError, invalid } from '../../src/api/errors';
import { needsWarning } from '../../src/features/oauth/knownHosts';
import { principalOf as realPrincipalOf } from '../auth/principal';
import { verifyBrowserToken } from '../auth/verify';
import type { Deps, Query } from '../core/ports';
import type { OfficeSnapshot, Principal } from '../core/types';
import { isLite } from '../data/dialect';
import { readOffice as realReadOffice } from '../data/officeCache';
import { errorResponse, runErrorOf } from '../http/errors';
import { readBody } from '../http/limits';
import type { RouteDef } from '../http/routes';
import { assertMayConnect } from './aiSwitches';

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
 *   (madar_private.agent_pending, 20261028000100_platform_agent_redirect.sql). An authorization that Auth already approved,
 *   denied or let expire, or that belongs to someone else, gives invalid_input with the reason authorization_ended.
 * - The addresses (CWE-863): the consent screen shows ONE redirect address, the one of the pending authorization, but Auth (and the
 *   own OAuth server) gives a code at once for a known (person, client) pair on ANY address that the client registered. So an AI
 *   app that registers [a known address, an address of its own] could win the approval through the known one and then take the
 *   code on its own address. hiddenAddresses names the addresses that the person did not see: a warned address (not loopback, not
 *   a known AI app) on another scheme or host than the seen one. The route refuses with forbidden, reason agent_redirect_hidden,
 *   and writes nothing. Else it stores the seen address (agent_approvals.redirect_uri). ensureAgentUser and the per-call check of
 *   auth.ts run the same rule on the current addresses of the client, with null for an approval from before this fix (the strict
 *   form), so a link of a hidden-address client stops on its next call.
 * - The switch ai.connect: a person whose role lacks it records no approval (forbidden, reason ai_off; aiSwitches.ts).
 * - A removed agent: when the person removed the link of this client (Settings, Agents, or agents.revokeAll), the route refuses
 *   with forbidden, reason agent_removed. A removed link never links again, so the AI app must register a new client.
 *
 * This module holds no MCP code, so the api bundle carries it. server/http/routes.ts mounts APPROVE_ROUTE (merge lead patch of G4).
 */

export const APPROVE_PATH = '/agents/approve';

/**
 * The pending authorization of this person: the client, the redirect address that the screen showed, and every address that the
 * client registered (one text, commas). Zero rows: an unknown, ended or foreign authorization. madar_private.agent_authorization
 * (the older function) stays in the database for the deploy window and no code calls it.
 */
export const PENDING_SQL = 'select client_id::text as client_id, redirect_uri, redirect_uris from madar_private.agent_pending($1::text, $2::uuid)';
/**
 * A second approval of the same client by the same person keeps its time and takes the address of the new one: an approval from
 * before this fix has none, and the person must be able to approve again (the strict form refuses it until then).
 */
export const APPROVAL_INSERT_SQL =
  'insert into agent_approvals (client_id, owner_user_id, redirect_uri) values ($1::uuid, $2, $3) on conflict (client_id, owner_user_id) do update set redirect_uri = excluded.redirect_uri';
/**
 * A removed link of this client and person (agent_links.revoked_at). A removed link never links again (G3), so an approval of the
 * same client would let Auth give tokens that Madar refuses with 401 on every call, and the AI app would loop through the consent
 * screen with no word to the person (review of G4).
 */
export const REMOVED_LINK_SQL = 'select 1 as removed from agent_links where client_id = $1::uuid and owner_user_id = $2 and revoked_at is not null';
/** The approval that ensureAgentUser needs before it links a client to the person, with the address that the person saw (null: before the fix). */
export const APPROVAL_SQL = 'select 1 as approved, redirect_uri from agent_approvals where client_id = $1::uuid and owner_user_id = $2';

/** The SQLite forms (Supabase exit, wave 2): the pending authorization is a row of oauth_requests, bound to the person who opened it. */
export const PENDING_LITE =
  'select r.client_id as client_id, r.redirect_uri as redirect_uri, c.redirect_uris as redirect_uris from oauth_requests r left join oauth_clients c on c.id = r.client_id ' +
  "where r.id = ?1 and r.auth_id = ?2 and r.status = 'pending' and r.expires_at > ?3";
export const APPROVAL_INSERT_LITE =
  'insert into agent_approvals (client_id, owner_user_id, approved_at, redirect_uri) values (?1, ?2, ?3, ?4) on conflict (client_id, owner_user_id) do update set redirect_uri = excluded.redirect_uri';
export const REMOVED_LINK_LITE = 'select 1 as removed from agent_links where client_id = ?1 and owner_user_id = ?2 and revoked_at is not null';
export const APPROVAL_LITE = 'select 1 as approved, redirect_uri from agent_approvals where client_id = ?1 and owner_user_id = ?2';
/** A remove of the AI app in Settings, Agents ends its approval too, so the next connection asks the person again. */
export const APPROVAL_DELETE_LITE = 'delete from agent_approvals where client_id = ?1 and owner_user_id = ?2';

export function agentRemoved(): ApiError {
  return new ApiError('forbidden', 'You removed this AI app in Madar. In the AI app, remove the Madar connection and add it again.', { reason: 'agent_removed' });
}

export function redirectHidden(): ApiError {
  return new ApiError('forbidden', 'Madar does not approve this AI app. It can send you back to an address that the Madar screen did not show. Ask its maker to use one address.', { reason: 'agent_redirect_hidden' });
}

/** The scheme and the host of an address, lower case, or null when it does not parse. The port and the path never count. */
function placeOf(address: string): string | null {
  try {
    const url = new URL(address);
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** The redirect addresses of a client as a list: the text of Auth (commas) or the JSON list of SQLite. A missing client has none. */
export function addressListOf(value: string | null | undefined, lite: boolean): string[] {
  if (value === null || value === undefined) return [];
  const list = lite ? (JSON.parse(value) as string[]) : value.split(',');
  return list.map((uri) => uri.trim()).filter(Boolean);
}

/**
 * The registered addresses that the person did not see (CWE-863; the file comment). seen: the address that the consent screen
 * showed, or null for an approval from before this fix.
 * - An address is hidden when the screen would warn for it (needsWarning: not loopback, not a known AI app, or it does not parse)
 *   and its scheme and host differ from the seen address. A loopback address, a known AI app and the scheme and host of the seen
 *   address never count, so an app that shows myapp.example and also lists localhost stays approved.
 * - With seen null, the strict form: any warned address beside an address on another scheme or host counts. A client of one place
 *   only counts nothing.
 */
export function hiddenAddresses(uris: readonly string[], seen: string | null): string[] {
  const seenPlace = seen === null ? null : placeOf(seen);
  return uris.filter((address) => {
    if (!needsWarning(address)) return false;
    const place = placeOf(address);
    if (place === null) return true;
    if (seen !== null) return place !== seenPlace;
    return uris.some((other) => placeOf(other) !== place);
  });
}

/** Throws agent_redirect_hidden when the client holds an address that the person did not see. */
export function assertAddressesSeen(uris: readonly string[], seen: string | null): void {
  if (hiddenAddresses(uris, seen).length > 0) throw redirectHidden();
}

const Body = z.object({ authorizationId: z.string().trim().min(1).max(200) });

export type ApproveOptions = {
  verifyToken: (header: string | null) => Promise<{ authUserId: string }>;
  principalOf: (authUserId: string, office: OfficeSnapshot) => Principal;
  readOffice: (deps: Deps) => Promise<OfficeSnapshot>;
};

type PendingRow = { client_id: string | null; redirect_uri: string | null; redirect_uris: string | null };

/**
 * Records the approval of the client of one pending authorization for the signed-in person. now: the time of the check on SQLite
 * (an oauth_requests row ends at expires_at); Postgres asks Auth, which checks it itself.
 */
export async function recordApproval(q: Query, o: { authorizationId: string; authUserId: string; ownerId: string; now?: Date }): Promise<{ clientId: string }> {
  const lite = isLite(q);
  const now = (o.now ?? new Date()).toISOString();
  const [row] = lite
    ? await q<PendingRow>(PENDING_LITE, [o.authorizationId, o.authUserId, now])
    : await q<PendingRow>(PENDING_SQL, [o.authorizationId, o.authUserId]);
  const clientId = row?.client_id ?? null;
  if (row === undefined || clientId === null) {
    throw invalid('authorizationId', 'This approval request ended. Start the connection again in your AI app.', 'authorization_ended');
  }
  const [removed] = await q(lite ? REMOVED_LINK_LITE : REMOVED_LINK_SQL, [clientId, o.ownerId]);
  if (removed) throw agentRemoved();
  // The person saw row.redirect_uri. An address of the client that the screen did not show refuses the approval, and nothing is written.
  const seen = row.redirect_uri ?? null;
  assertAddressesSeen(addressListOf(row.redirect_uris, lite), seen);
  if (lite) await q(APPROVAL_INSERT_LITE, [clientId, o.ownerId, now, seen]);
  else await q(APPROVAL_INSERT_SQL, [clientId, o.ownerId, seen]);
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
    // Connect AI assistants off: the approval of a new connection is refused (role rights version 2).
    assertMayConnect(office, principal.userId);
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
