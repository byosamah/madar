import { ApiError, forbidden } from '../../src/api/errors';
import { resolveActor } from '../core/actor';
import type { ServerCall } from '../core/types';

/**
 * live.ticket (exit wave 3): the ticket of the live socket of the person. The office object makes it (server/office/live.ts,
 * LiveTickets) inside the batch that the Worker handed over after its token check, and the socket open takes it. Only a person
 * opens a socket: an agent gets forbidden. Outside the office object (the Supabase functions, the Postgres path of the Worker)
 * there is no ticket, so the call answers not_found.
 */
export const liveTicket: ServerCall<'live.ticket'> = async (_input, ctx) => {
  const actor = resolveActor(ctx.office, ctx.principal);
  if (actor.kind === 'agent') throw forbidden('An agent does not open live updates.', { action: 'live.open' });
  if (!ctx.deps.live) throw new ApiError('not_found', 'Live updates on a socket are not on this server yet.');
  return { output: ctx.deps.live.mint(ctx.principal.userId, ctx.now), changed: false };
};
