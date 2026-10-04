import { z } from 'zod';
import { defaultPreferences, User } from '../../src/api/contract/entities';
import { ApiError } from '../../src/api/errors';
import { recordCreate } from '../../src/api/events';
import { executeParsed } from '../../src/api/execute';
import { defineCall } from '../../src/api/registry';
import { nextId } from '../../src/api/store';
import type { Deps } from '../core/ports';
import { sqlData, type CallData } from '../core/runCall';
import { resolveStory } from '../core/story';
import { loadFor } from '../data/loaders/index';
import { signInAgain } from './auth';

/**
 * The agent user of an approval (plan 5.6; task G3). The first MCP call of a new approval (a client_id with no agent link, or a
 * removed link and a newer session) runs ensureAgentUser, under the office lock, in one transaction:
 *
 * - The AI app: its name and the host of its first redirect address, from Auth (madar_private.agent_client,
 *   20261004000401_platform_agents.sql).
 * - The agent user of (person, app name, redirect host): an active agent of the person that an earlier link of the same app
 *   names. A reconnect of the same app reuses it, because Supabase makes a new client for each reconnect (supabase/auth 2850).
 *   A removed agent (Settings, Agents) stays off: its app gets a new agent user.
 * - None: a new users row (kind agent, the person as owner, the app name, the address <agentId>@agents.madar.invalid, which no
 *   mail reaches) and the user.created event with the person as the actor, through the save step, so the History, the change
 *   signal and the office cache see it as any other new person.
 * - The agent link (agent_links), new or linked again.
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

/** The new agent user, as users.create makes a person, without the people.manage check: a person approves an agent for themself. */
export const AGENT_USER_CREATE = defineCall({
  input: z.object({ name: z.string().trim().min(1).max(NAME_MAX) }),
  output: User,
  run(input, ctx) {
    const id = nextId(ctx.state, 'usr');
    const user: User = {
      id, name: input.name, email: `${id}@agents.madar.invalid`, kind: 'agent', systemRole: 'member', discipline: AGENT_DISCIPLINE,
      ownerId: ctx.authority.id, avatarUrl: null, active: true,
      preferences: { ...defaultPreferences(), language: ctx.authority.preferences.language },
    };
    ctx.state.users[id] = user;
    recordCreate(ctx, { projectId: null, verb: 'user.created', targetType: 'user', targetId: id, entity: user });
    return user;
  },
});

export const LINK_SQL = 'select agent_user_id, revoked_at from agent_links where client_id = $1::uuid';
export const CLIENT_SQL = 'select client_name, redirect_uris from madar_private.agent_client($1::uuid)';
export const SAME_APP_SQL =
  'select agent_user_id from agent_links where owner_user_id = $1 and client_name = $2 and redirect_host = $3 order by approved_at desc';
export const LINK_UPSERT_SQL = [
  'insert into agent_links (client_id, owner_user_id, agent_user_id, client_name, redirect_host, approved_at)',
  ' values ($1::uuid, $2, $3, $4, $5, now())',
  ' on conflict (client_id) do update set owner_user_id = excluded.owner_user_id, agent_user_id = excluded.agent_user_id,',
  ' client_name = excluded.client_name, redirect_host = excluded.redirect_host, approved_at = excluded.approved_at,',
  ' last_used_at = null, revoked_at = null',
].join('');

export async function ensureAgentUser(deps: Deps, o: { ownerId: string; clientId: string; data?: CallData }): Promise<{ agentUserId: string; created: boolean }> {
  const data = o.data ?? sqlData(deps);
  return data.tx('write', async (t) => {
    await t.lock(deps.config.lockKey);
    const [link] = await t.q<{ agent_user_id: string; revoked_at: Date | string | null }>(LINK_SQL, [o.clientId]);
    // Another request of the same approval made the link while this one waited for the lock.
    if (link && link.revoked_at === null) return { agentUserId: link.agent_user_id, created: false };

    const [client] = await t.q<{ client_name: string | null; redirect_uris: string }>(CLIENT_SQL, [o.clientId]);
    if (!client) throw signInAgain('Madar does not know this AI app. Connect it again in your AI app.');
    const name = agentNameOf(client.client_name);
    const host = redirectHostOf(client.redirect_uris);

    const office = await t.office();
    const owner = office.lists.users[o.ownerId];
    if (!owner || owner.kind !== 'human' || !owner.active) {
      throw new ApiError('unauthenticated', 'This account is turned off in Madar.', { reason: 'account_off' });
    }

    const earlier = await t.q<{ agent_user_id: string }>(SAME_APP_SQL, [owner.id, name, host]);
    let agentUserId = earlier.map((row) => row.agent_user_id).find((id) => {
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
      const user = executeParsed(AGENT_USER_CREATE, 'agents.connect', { name }, state, {
        actorId: owner.id, authorityId: owner.id, correlationId: story.storyId, now, persistent: true,
      }, undefined) as User;
      const saved = await t.save(before, state, { story: { storyId: story.storyId, actorId: owner.id } });
      if (saved.signals.length > 0) await deps.signal.send(t.q, saved.signals);
      agentUserId = user.id;
    }
    await t.q(LINK_UPSERT_SQL, [o.clientId, owner.id, agentUserId, name, host]);
    return { agentUserId, created };
  });
}
