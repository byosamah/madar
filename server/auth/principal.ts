import { ApiError } from '../../src/api/errors';
import { resolveActor } from '../core/actor';
import type { OfficeSnapshot, Principal } from '../core/types';
import { userIdOfAuth } from '../data/officeCache';

/**
 * The person behind a checked browser token (plan 5.1): the users row with this auth_user_id in the office snapshot.
 * No such row gives ApiError('unauthenticated') (401). The batch route (E3) calls it after verifyBrowserToken.
 * A browser token is never an agent (verifyBrowserToken refuses client_id), so the principal has no agent part.
 * The person must act now (resolveActor, server/core/actor.ts), so the whole batch stops before any call: a turned-off
 * person, or a link to a users row that is gone, gives unauthenticated with the reason account_off (403, plan 4.10), and a
 * link to an agent row gives forbidden (403). runCall checks the actor again on every call.
 */
export function principalOf(authUserId: string, office: OfficeSnapshot): Principal {
  const userId = authUserId === '' ? undefined : userIdOfAuth(office, authUserId);
  if (userId === undefined) throw new ApiError('unauthenticated', 'This sign-in has no Madar account. Ask an Admin.');
  const principal: Principal = { userId };
  resolveActor(office, principal);
  return principal;
}
