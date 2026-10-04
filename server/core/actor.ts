import type { User } from '../../src/api/contract/entities';
import { ApiError } from '../../src/api/errors';
import type { OfficeSnapshot, Principal } from './types';

/**
 * The actor of a call (plan 4.5, the actor; task C3). runCall checks it on every call, from the office snapshot (CM R-19).
 *
 * - A missing or turned-off person gives unauthenticated with the reason account_off. The batch route answers 403 to it.
 * - An agent acts only while its own row is on and its owner is an active person, as in src/api/client.ts. Otherwise the same
 *   refusal: the agent's person is off, so the agent is off too.
 * - The kind of the principal must match the user row: a browser sign-in never acts as an agent, and an agent token never acts
 *   as a person. The sign-in check (track P) makes the principal; this is the second guard.
 */

function accountOff(): ApiError {
  return new ApiError('unauthenticated', 'This account is turned off. Ask an Admin.', { reason: 'account_off' });
}

export function resolveActor(office: OfficeSnapshot, principal: Principal): User {
  const user = office.lists.users[principal.userId];
  if (!user || !user.active) throw accountOff();
  if ((user.kind === 'agent') !== (principal.agent !== undefined)) {
    throw new ApiError('forbidden', 'This sign-in cannot act as this user.');
  }
  if (user.kind === 'agent') {
    const owner = user.ownerId ? office.lists.users[user.ownerId] : undefined;
    if (!owner || owner.kind !== 'human' || !owner.active) throw accountOff();
  }
  return user;
}
