import { z } from 'zod';
import { User } from '../../src/api/contract/entities';
import { forbidden, notFound } from '../../src/api/errors';
import { applyPatch } from '../../src/api/events';
import { executeParsed } from '../../src/api/execute';
import { defineCall } from '../../src/api/registry';
import { nowStamp } from '../../src/lib/dates';
import { resolveActor } from '../core/actor';
import { writeOutbox } from '../core/effects';
import { digestOf, replay, sqlKeys, type StoredResult } from '../core/idempotency';
import { takeOfficeLock } from '../core/lock';
import type { CallData } from '../core/runCall';
import type { Deps } from '../core/ports';
import { resolveStory, sqlStories } from '../core/story';
import { isLite, sqlFor } from '../data/dialect';
import type { ChangeSignal, ServerCall, ServerCallCtx } from '../core/types';
import { readOffice } from '../data/officeCache';
import { loadFor, sqlSource } from '../data/loaders/index';
import { save } from '../data/save';
// Registers agents.revokeAll after a turn-off (plan 4.12) in every entry that builds the call map.
import '../mcp/revokeAll';

/**
 * agents.list and agents.remove (plan 5.6; task G4): Settings, Agents. Both work for the person behind the token: the api
 * function refuses agent tokens, and the MCP tool list denies agents.*, so an agent never lists or removes agents.
 *
 * - agents.list: the agent users of the person (users rows, kind agent, ownerId = the person), with their agent_links: the live
 *   clients (the screen revokes each one at Auth after a Remove), the host and time of the newest approval, and the last use.
 * - agents.remove: a server write under the office lock in one transaction, as a shared write: the idempotency key replay, the
 *   story, every live link of the agent removed (agent_links.revoked_at, so the next MCP call gets 401 at once, server/mcp/auth.ts),
 *   and the agent user turned off with the user.deactivated event by the person, through the save step. An agent that is already
 *   off loses its links and gets no second event. The screen then revokes each client at Auth (revokeGrant); a failure there
 *   leaves the agent off in Madar.
 */

export const AGENT_LINKS_SQL =
  'select client_id::text as client_id, agent_user_id, redirect_host, approved_at, last_used_at, revoked_at from agent_links where owner_user_id = $1 order by approved_at, client_id';
export const REVOKE_AGENT_SQL = 'update agent_links set revoked_at = now() where agent_user_id = $1 and revoked_at is null';
/** The SQLite forms (Supabase exit, wave 2). No order by: agentsList sorts in JavaScript. The agent sessions end with the links. */
export const AGENT_LINKS_LITE = 'select client_id, agent_user_id, redirect_host, approved_at, last_used_at, revoked_at from agent_links where owner_user_id = ?1';
export const REVOKE_AGENT_LITE = 'update agent_links set revoked_at = ?2 where agent_user_id = ?1 and revoked_at is null';
export const END_AGENT_SESSIONS_LITE =
  'update auth_sessions set revoked_at = ?2 where revoked_at is null and client_id in (select client_id from agent_links where agent_user_id = ?1)';

type LinkRow = { client_id: string; agent_user_id: string; redirect_host: string; approved_at: Date | string; last_used_at: Date | string | null; revoked_at: Date | string | null };

const time = (value: Date | string) => new Date(value).getTime();

/** The person whose agents these are: the actor, or for an agent the person it acts for. */
function authorityOf(ctx: ServerCallCtx): User {
  const actor = resolveActor(ctx.office, ctx.principal);
  return actor.kind === 'agent' ? ctx.office.lists.users[actor.ownerId!] : actor;
}

export const agentsList: ServerCall<'agents.list'> = async (_input, ctx) => {
  const owner = authorityOf(ctx);
  const agents = Object.values(ctx.office.lists.users)
    .filter((user) => user.kind === 'agent' && user.ownerId === owner.id)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const rows = agents.length === 0 ? [] : (await ctx.deps.db.tx('read', (q) => q<LinkRow>(sqlFor(q, AGENT_LINKS_SQL, AGENT_LINKS_LITE), [owner.id])))
    .sort((a, b) => time(a.approved_at) - time(b.approved_at) || a.client_id.localeCompare(b.client_id));
  const output = agents.map((agent) => {
    const live = rows.filter((row) => row.agent_user_id === agent.id && row.revoked_at === null);
    const newest = live.reduce<LinkRow | undefined>((best, row) => (!best || time(row.approved_at) >= time(best.approved_at) ? row : best), undefined);
    const used = live.flatMap((row) => (row.last_used_at === null ? [] : [time(row.last_used_at)]));
    return {
      agentId: agent.id,
      clientIds: live.map((row) => row.client_id),
      name: agent.name,
      redirectHost: newest?.redirect_host ?? null,
      approvedAt: newest ? nowStamp(new Date(newest.approved_at)) : null,
      lastUsedAt: used.length > 0 ? nowStamp(new Date(Math.max(...used))) : null,
      active: agent.active,
    };
  });
  return { output, changed: false };
};

/** The agent user turned off, as the prototype's agents.remove does it (src/api/handlers/serverFakes.ts). */
export const AGENT_USER_OFF = defineCall({
  input: z.object({ agentId: z.string().min(1) }),
  output: User,
  run(input, ctx) {
    const agent = ctx.state.users[input.agentId];
    applyPatch(ctx, agent, { active: false }, { projectId: null, verb: 'user.deactivated', targetType: 'user', targetId: agent.id });
    return agent;
  },
});

/**
 * The data of agents.remove on the database: the same parts as sqlData of server/core/runCall.ts. This file cannot import
 * runCall at run time, because runCall builds the call map from the registry that imports this file.
 */
export function sqlAgentsData(deps: Deps): CallData {
  return {
    tx: (mode, work) =>
      deps.db.tx(mode, (q) =>
        work({
          q,
          lock: (key) => takeOfficeLock(q, key),
          office: () => readOffice(deps, q),
          source: () => sqlSource(q, { bytes: (n) => deps.meter.addBytes(n) }),
          save: (before, after, o) => save(q, before, after, o),
          stories: sqlStories(q),
          keys: sqlKeys(q),
          outbox: (rows) => writeOutbox(q, rows),
        }),
      ),
    office: () => readOffice(deps),
  };
}

export function createAgentsRemove(o: { data?: (deps: Deps) => CallData } = {}): ServerCall<'agents.remove'> {
  return async (input, ctx) => {
    const owner = authorityOf(ctx);
    const agent = ctx.office.lists.users[input.agentId];
    if (!agent || agent.kind !== 'agent') throw notFound('Agent', input.agentId);
    if (agent.ownerId !== owner.id) throw forbidden('Only the person an agent acts for can remove it.', { action: 'agents.remove' });

    const { deps } = ctx;
    const actorId = ctx.principal.userId;
    const digest = ctx.key !== undefined ? await digestOf('agents.remove', input) : undefined;
    // The data of the test, else the data of the runCall that runs the call (liteData on SQLite), else the database of deps.
    const data = o.data ? o.data(deps) : ctx.data ?? sqlAgentsData(deps);
    const done = await data.tx('write', async (t) => {
      await t.lock(deps.config.lockKey);
      const now = deps.clock.now();
      const ref = ctx.story && 'ref' in ctx.story && !ctx.batch.storyRefs.has(ctx.story.ref) ? ctx.story.ref : undefined;
      if (ctx.key !== undefined && digest !== undefined) {
        const stored = replay(await t.keys.get(actorId, ctx.key), digest);
        if (stored) return { result: stored, ref, signals: [] as ChangeSignal[] };
      }
      const story = await resolveStory(t.stories, ctx.story, ctx.batch.storyRefs, actorId, now);
      if (isLite(t.q)) {
        // The sessions of the clients of the agent end with its links, so no refresh token of the agent works after the remove.
        await t.q(END_AGENT_SESSIONS_LITE, [agent.id, now.toISOString()]);
        await t.q(REVOKE_AGENT_LITE, [agent.id, now.toISOString()]);
      } else {
        await t.q(REVOKE_AGENT_SQL, [agent.id]);
      }

      let signals: ChangeSignal[] = [];
      const office = await t.office();
      const turnOff = office.lists.users[agent.id]?.active === true;
      if (turnOff) {
        const state = await loadFor('users.deactivate', { id: agent.id }, { src: t.source(), office, actorId, write: true });
        const before = structuredClone(state);
        executeParsed(AGENT_USER_OFF, 'agents.remove', { agentId: agent.id }, state, {
          actorId, authorityId: owner.id, correlationId: story.storyId, now, persistent: true,
        }, undefined);
        const saved = await t.save(before, state, { story: { storyId: story.storyId, actorId } });
        if (saved.signals.length > 0) await deps.signal.send(t.q, saved.signals);
        signals = saved.signals;
      }
      const result: StoredResult = { output: { removed: true }, storyId: story.storyId, changed: turnOff };
      if (ctx.key !== undefined && digest !== undefined) await t.keys.put({ actorId, key: ctx.key, name: 'agents.remove', digest, result, at: now });
      return { result, ref: story.ref, signals };
    });

    if (done.ref !== undefined && done.result.storyId !== undefined) ctx.batch.storyRefs.set(done.ref, done.result.storyId);
    const own = done.signals.filter((signal) => signal.channel === 'office' || signal.channel === `person:${actorId}`);
    return {
      output: { removed: true as const },
      ...(done.result.storyId !== undefined ? { storyId: done.result.storyId } : {}),
      changed: done.result.changed ?? false,
      ...(own.length > 0 ? { signals: own } : {}),
    };
  };
}

export const agentsRemove: ServerCall<'agents.remove'> = createAgentsRemove();
