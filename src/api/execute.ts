import type { User } from './contract/entities';
import { ApiError } from './errors';
import type { Actor } from './permissions';
import type { AnyCall } from './registry';
import { withOfficeRights } from './rights';
import type { State } from './store';
import { nowStamp, todayISO } from '../lib/dates';

/**
 * The step that the fake API and the server share (plan 4.5, step 5.8): who acts with whose rights, the run, and the output check.
 * The server calls it inside its transaction on the records it loaded; the fake API calls it inside Store.run.
 */

/**
 * "actor" is who acts. "authority" is whose rights apply: the person, or the active person an agent acts for (spec 17).
 * Both carry the office rights of the office settings (rights.ts), so can() reads them.
 */
export function resolveAuthority(state: State, actorId: string, def: AnyCall): { actor: Actor; authority: Actor } {
  const who = whoActs(state, actorId, def);
  return { actor: withRightsOf(state, who.actor), authority: withRightsOf(state, who.authority) };
}

/** The person who acts, and the person whose rights apply, before the office rights are attached. */
function whoActs(state: State, actorId: string, def: AnyCall): { actor: User; authority: User } {
  const actor = state.users[actorId];
  if (!actor) throw new ApiError('forbidden', 'There is no current user.');
  if (actor.kind !== 'agent') return { actor, authority: actor };
  const owner = actor.ownerId ? state.users[actor.ownerId] : undefined;
  if (owner !== undefined && owner.kind === 'human' && owner.active) return { actor, authority: owner };
  // Prototype controls still run, so the viewer can always switch away from an agent that cannot act.
  if (def.prototypeOnly) return { actor, authority: actor };
  throw new ApiError('forbidden', 'This agent has no active person to act for.');
}

/** A person with the office rights of the office settings attached. A missing person stays missing. */
function withRightsOf(state: State, user: User): Actor {
  return user ? withOfficeRights(user, state.settings.roles) : user;
}

/**
 * wireOutput: the server checks the output in its wire form (def.wire.output), for a call whose answer differs on the wire.
 * limits: the server's limits of the active file store (plan 2b, point 1). session.get returns them; the prototype has none.
 */
export type ExecuteBase = {
  actorId: string; authorityId: string; correlationId: string; now: Date; persistent: boolean; wireOutput?: boolean; limits?: { maxFileBytes: number };
};

/** Runs a call on input that already passed its input check. The output is checked inside the change, so a wrong shape rolls it back. */
export function executeParsed(def: AnyCall, name: string, parsed: unknown, state: State, base: ExecuteBase, prepared: unknown): unknown {
  const result = def.run(parsed, {
    state, actor: withRightsOf(state, state.users[base.actorId]), authority: withRightsOf(state, state.users[base.authorityId]),
    correlationId: base.correlationId,
    stamp: nowStamp(base.now), today: todayISO(base.now), now: base.now, persistent: base.persistent,
    ...(base.limits ? { limits: base.limits } : {}),
  }, prepared);
  const output = (base.wireOutput ? (def.wire?.output ?? def.output) : def.output).safeParse(result);
  if (!output.success) throw new ApiError('failed', `The call ${name} returned data in the wrong shape.`, { issues: output.error.issues.length });
  return output.data;
}
