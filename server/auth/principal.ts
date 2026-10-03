import { notBuilt } from '../core/notBuilt';
import type { OfficeSnapshot, Principal } from '../core/types';

/**
 * The person behind a checked browser token (plan 5.1): the users row with this auth_user_id in the office snapshot.
 * No such row gives ApiError('unauthenticated') (401). The batch route (E3) calls it after verifyBrowserToken. Track P replaces this stub.
 */
export function principalOf(_authUserId: string, _office: OfficeSnapshot): Principal {
  return notBuilt('The person lookup');
}
