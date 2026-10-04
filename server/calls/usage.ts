import { forbidden } from '../../src/api/errors';
import { can } from '../../src/api/permissions';
import { resolveActor } from '../core/actor';
import type { ServerCall } from '../core/types';
import { readUsage } from '../usage/meters';

/**
 * usage.get (plan 4.11, 5.8; task M1): the free plan meters for the Admin, with the failed effects and the last job run.
 * An agent reads with the rights of its person. Everyone else gets forbidden, before any read.
 */
export const usageGet: ServerCall<'usage.get'> = async (_input, ctx) => {
  const actor = resolveActor(ctx.office, ctx.principal);
  const authority = actor.kind === 'agent' ? ctx.office.lists.users[actor.ownerId!] : actor;
  if (!authority || !can(authority, 'admin.manage')) throw forbidden('Only the Admin sees the usage of the free plans.', { action: 'admin.manage' });
  const output = await ctx.deps.db.tx('read', (q) => readUsage(q, ctx.deps.config, ctx.now));
  return { output, changed: false };
};
