import { z } from 'zod';
import { defaultPreferences, User } from '../../src/api/contract/entities';
import { ApiError } from '../../src/api/errors';
import { recordCreate } from '../../src/api/events';
import { executeParsed } from '../../src/api/execute';
import { defineCall } from '../../src/api/registry';
import { nextId } from '../../src/api/store';
import { agentNamesOf } from '../../src/lib/agentName';
import type { Deps } from '../core/ports';
import { sqlData, type CallData } from '../core/runCall';
import { resolveStory } from '../core/story';
import { loadFor } from '../data/loaders/index';
import { APPROVAL_SQL } from './approval';
import { signInAgain } from './auth';

/**
 * The agent user of an approval (plan 5.6; task G3). Only the first MCP call of a client_id with no agent link runs ensureAgentUser,
 * under the office lock, in one transaction. A removed link stays removed: the AI app must register a new client (a new DCR
 * client_id) to connect again.
 *
 * - The approval: the person must have approved this client on the Madar consent screen (agent_approvals, approval.ts; task G4).
 *   Else forbidden with the reason agent_not_approved, and no link: Auth lets an agent token approve a client that the agent
 *   registered itself (proof.md G4), but the api function refuses agent tokens, so only the person records an approval.
 * - The AI app: its name and the host of its first redirect address, from Auth (madar_private.agent_client,
 *   20261004000401_platform_agents.sql).
 * - The agent user of (person, app name, set of redirect addresses): an active agent of the person that an earlier link of the
 *   same app names. A reconnect of the same app reuses it, because Supabase makes a new client for each reconnect (supabase/auth
 *   2850). The whole set of redirect addresses must match (redirectSetOf), not only the first host, so a client that adds an
 *   address of its own never takes over an agent user, its name and its History (security review of G3). The earlier clients'
 *   addresses come from Auth; a client that Auth no longer has matches nothing. A removed agent stays off: its app gets a new one.
 * - A link that exists stays as it is: a removed link never links again here (server/mcp/auth.ts).
 * - None: a new users row (kind agent, the person as owner, the name "<first name> <app name> Agent" and its Arabic twin
 *   (agentNamesOf, owner 2026-10-12), the address <agentId>@agents.madar.invalid, which no mail reaches) and the user.created event with the person as the actor, through the save step, so the History, the change
 *   signal and the office cache see it as any other new person.
 * - The new agent link (agent_links).
 */

const NAME_MAX = 80;
const FALLBACK_NAME = 'AI agent';
export const AGENT_DISCIPLINE = 'AI agent';

export function agentNameOf(clientName: string | null): string {
  const name = (clientName ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  return name === '' ? FALLBACK_NAME : name;
}

/** The host of the first redirect address, without the port. Auth keeps the addresses as one text, separated by commas. */
export function redirectHostOf(redirectUris: string): string {
  const first = redirectUris.split(',').map((uri) => uri.trim()).find(Boolean);
  if (!first) return 'unknown';
  try {
    return new URL(first).hostname || 'unknown';
  } catch {
    return 'unknown';
  }
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The redirect addresses of a client as one key: each address exact (a loopback address without its port, which a native app
 * picks at random), sorted, without repeats. An address that does not parse stays as written.
 */
export function redirectSetOf(redirectUris: string): string {
  const keys = redirectUris.split(',').map((uri) => uri.trim()).filter(Boolean).map((uri) => {
    try {
      const url = new URL(uri);
      return LOOPBACK.has(url.hostname) ? `${url.protocol}//${url.hostname}${url.pathname}${url.search}` : url.href;
    } catch {
      return uri;
    }
  });
  return [...new Set(keys)].sort().join('\n');
}

/** The new agent user, as users.create makes a person, without the people.manage check: a person approves an agent for themself. */
export const AGENT_USER_CREATE = defineCall({
  // The names come from agentNamesOf (src/lib/agentName.ts): "Osama Claude Agent", and in Arabic "وكيل أسامة Claude".
  input: z.object({ name: z.string().trim().min(1).max(NAME_MAX), nameAr: z.string().trim().min(1).max(NAME_MAX).optional() }),
  output: User,
  run(input, ctx) {
    const id = nextId(ctx.state, 'usr');
    const user: User = {
      id, name: input.name, ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
      email: `${id}@agents.madar.invalid`, kind: 'agent', systemRole: 'member', discipline: AGENT_DISCIPLINE,
      ownerId: ctx.authority.id, avatarUrl: null, active: true,
      preferences: { ...defaultPreferences(), language: ctx.authority.preferences.language },
    };
    ctx.state.users[id] = user;
    recordCreate(ctx, { projectId: null, verb: 'user.created', targetType: 'user', targetId: id, entity: user });
    return user;
  },
});

export function notApproved(): ApiError {
  return new ApiError('forbidden', 'You did not approve this AI app in Madar. Remove it in Madar under Settings, Agents, then connect it again and approve it on the Madar screen.', { reason: 'agent_not_approved' });
}

export const LINK_SQL = 'select agent_user_id, revoked_at from agent_links where client_id = $1::uuid';
export const CLIENT_SQL = 'select client_name, redirect_uris from madar_private.agent_client($1::uuid)';
/** The earlier links of the same person, app name and host, with the redirect addresses of their clients in Auth. */
export const SAME_APP_SQL = [
  'select l.agent_user_id, c.redirect_uris from agent_links l cross join lateral madar_private.agent_client(l.client_id) c',
  ' where l.owner_user_id = $1 and l.client_name = $2 and l.redirect_host = $3 order by l.approved_at desc',
].join('');
/** A new link only: a client that has a link keeps it as it is (on conflict, nothing). */
export const LINK_INSERT_SQL =
  'insert into agent_links (client_id, owner_user_id, agent_user_id, client_name, redirect_host, approved_at) values ($1::uuid, $2, $3, $4, $5, now()) on conflict (client_id) do nothing';

export async function ensureAgentUser(deps: Deps, o: { ownerId: string; clientId: string; data?: CallData }): Promise<{ agentUserId: string; created: boolean }> {
  const data = o.data ?? sqlData(deps);
  return data.tx('write', async (t) => {
    await t.lock(deps.config.lockKey);
    const [link] = await t.q<{ agent_user_id: string; revoked_at: Date | string | null }>(LINK_SQL, [o.clientId]);
    // Another request of the same approval made the link while this one waited for the lock. A removed link stays removed.
    if (link) return { agentUserId: link.agent_user_id, created: false };
    // Only a client that the person approved on the Madar consent screen links (task G4, approval.ts). An agent token can
    // approve a client of its own at Auth (proof.md G4), but the api function refuses it, so it cannot record an approval.
    const [approval] = await t.q(APPROVAL_SQL, [o.clientId, o.ownerId]);
    if (!approval) throw notApproved();

    const [client] = await t.q<{ client_name: string | null; redirect_uris: string }>(CLIENT_SQL, [o.clientId]);
    if (!client) throw signInAgain('Madar does not know this AI app. Connect it again in your AI app.');
    const name = agentNameOf(client.client_name);
    const host = redirectHostOf(client.redirect_uris);

    const office = await t.office();
    const owner = office.lists.users[o.ownerId];
    if (!owner || owner.kind !== 'human' || !owner.active) {
      throw new ApiError('unauthenticated', 'This account is turned off in Madar.', { reason: 'account_off' });
    }

    const addresses = redirectSetOf(client.redirect_uris);
    const earlier = await t.q<{ agent_user_id: string; redirect_uris: string }>(SAME_APP_SQL, [owner.id, name, host]);
    let agentUserId = earlier.filter((row) => redirectSetOf(row.redirect_uris) === addresses).map((row) => row.agent_user_id).find((id) => {
      const user = office.lists.users[id];
      return user !== undefined && user.kind === 'agent' && user.active && user.ownerId === owner.id;
    });
    const created = agentUserId === undefined;
    if (agentUserId === undefined) {
      // The time is taken under the lock, as runCall does, so the stamps follow the commit order.
      const now = deps.clock.now();
      const story = await resolveStory(t.stories, undefined, new Map(), owner.id, now);
      const state = await loadFor('users.create', {}, { src: t.source(), office, actorId: owner.id, write: true });
      const before = structuredClone(state);
      // `name` stays the AI app, for the link and for the match of a reconnect. The agent user is named after its person and its app.
      const user = executeParsed(AGENT_USER_CREATE, 'agents.connect', agentNamesOf(owner, name), state, {
        actorId: owner.id, authorityId: owner.id, correlationId: story.storyId, now, persistent: true,
      }, undefined) as User;
      const saved = await t.save(before, state, { story: { storyId: story.storyId, actorId: owner.id } });
      if (saved.signals.length > 0) await deps.signal.send(t.q, saved.signals);
      agentUserId = user.id;
    }
    await t.q(LINK_INSERT_SQL, [o.clientId, owner.id, agentUserId, name, host]);
    return { agentUserId, created };
  });
}
