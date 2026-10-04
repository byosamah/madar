import { ApiError } from '../../src/api/errors';
import type { OfficeSnapshot, Principal } from '../core/types';
import { userIdOfAuth } from '../data/officeCache';

/**
 * The person behind a checked browser token (plan 5.1): the users row with this auth_user_id in the office snapshot.
 * No such row gives ApiError('unauthenticated') (401). The batch route (E3) calls it after verifyBrowserToken.
 * A browser token is never an agent (verifyBrowserToken refuses client_id), so the principal has no agent part.
 * A turned-off person still gets a principal: runCall refuses that person with account_off (server/core/actor.ts).
 */
export function principalOf(authUserId: string, office: OfficeSnapshot): Principal {
  const userId = authUserId === '' ? undefined : userIdOfAuth(office, authUserId);
  if (userId === undefined) throw new ApiError('unauthenticated', 'This sign-in has no Madar account. Ask an Admin.');
  return { userId };
}
