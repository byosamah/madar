import { forbidden, notFound } from '../../src/api/errors';
import { can } from '../../src/api/permissions';
import { resolveActor } from '../core/actor';
import { processOutbox } from '../core/effects';
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

/** $1 the outbox row id. Only a row that failed and is not done: the job and the Retry then claim it as a new row. */
export const RETRY_EFFECT_SQL =
  'update outbox set attempts = 0, error = null, claimed_until = null where id = $1 and done_at is null and error is not null returning id';

/**
 * usage.retryEffect (plan 4.12; task M1): the Retry of one failed effect in Admin, Usage. The job stops at 5 attempts, so without
 * it an invitation to a bad address would stay a failed line for good. The reset commits first, then the effect runs once, as
 * every server write runs its effects. A repeat is safe: the row is done, or it fails again with a new error and one try.
 */
export const usageRetryEffect: ServerCall<'usage.retryEffect'> = async (input, ctx) => {
  assertAdmin(ctx);
  const { deps } = ctx;
  const rows = await deps.db.tx('write', (q) => q<{ id: string | number }>(RETRY_EFFECT_SQL, [input.id]));
  if (rows.length === 0) throw notFound('Failed effect', input.id);
  const ids = rows.map((row) => String(row.id));
  try {
    await processOutbox(deps, ids);
  } catch (error) {
    deps.log.warn('The effect of a Retry did not run. The job tries it again.', { ids, error: error instanceof Error ? error.message : String(error) });
  }
  return { output: { retried: true }, changed: false };
};
