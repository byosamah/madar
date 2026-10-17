import { ApiError } from '../../src/api/errors';
import { principalOf } from '../auth/principal';
import type { OfficeSnapshot, Principal } from '../core/types';

/**
 * Who sends a batch to the office object (exit wave 3). The Worker checks the token and passes what the check gives; the office
 * object finds the person in its office lists, because only the object holds them. "browser" holds what verifyBrowserToken gives
 * today (server/auth/verify.ts). Wave 2 adds its kinds here (an agent of the MCP route, a sign-in route), each with its branch.
 */
export type OfficeWho = { kind: 'browser'; authUserId: string };

export function principalOfWho(who: OfficeWho, office: OfficeSnapshot): Principal {
  switch (who.kind) {
    case 'browser':
      return principalOf(who.authUserId, office);
    default:
      throw new ApiError('unauthenticated', 'This sign-in does not reach the office object.');
  }
}
