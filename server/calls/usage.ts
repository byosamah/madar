import { forbidden } from '../../src/api/errors';
import { can } from '../../src/api/permissions';
import { resolveActor } from '../core/actor';
import type { ServerCall, ServerCallCtx } from '../core/types';
import { readUsage } from '../usage/meters';

/**
 * Only the Admin, in person. Plan 5.6 puts usage.get and every Admin call on the MCP deny list, so an agent gets forbidden here
 * too, also the agent of an Admin: the call is the second guard behind the tool list of track G.
 */
function assertAdmin(ctx: ServerCallCtx): void {
  const actor = resolveActor(ctx.office, ctx.principal);
  if (actor.kind === 'agent') throw forbidden('An agent does not read the usage of the free plans.', { action: 'admin.manage' });
  if (!can(actor, 'admin.manage')) throw forbidden('Only the Admin sees the usage of the free plans.', { action: 'admin.manage' });
}

/**
 * usage.get (plan 4.11, 5.8; task M1): the free plan meters for the Admin, with the failed effects and the last job run.
 * Everyone else gets forbidden, before any read.
 */
export const usageGet: ServerCall<'usage.get'> = async (_input, ctx) => {
  assertAdmin(ctx);
  const output = await ctx.deps.db.tx('read', (q) => readUsage(q, ctx.deps.config, ctx.now));
  return { output, changed: false };
};
