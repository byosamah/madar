import { ApiError } from '../../../src/api/errors';
import { accountOff } from '../../auth/own/ops';
import type { PlatformStub } from './stub';

/**
 * The guard of the platform calls (Madar enterprises, plan F, design D10). The token proves who signed in: a platform account id and a
 * session. The platform object says whether that account still exists and is on. Every call checks it, so an account that the Mac script
 * turned off loses the page at once, also with a token that is still valid. The guard calls no company object.
 */
export async function platformCaller(o: {
  token: { accountId: string; sessionId: string };
  platform: Pick<PlatformStub, 'platformAccount'>;
}): Promise<{ accountId: string; name: string; email: string }> {
  const account = await o.platform.platformAccount({ accountId: o.token.accountId });
  // An account that does not exist gets the answer of a bad token, so the answer tells nothing about the accounts.
  if (account === null) throw new ApiError('unauthenticated', 'Sign in to continue.');
  if (account.state !== 'active') throw accountOff();
  return { accountId: account.id, name: account.name, email: account.email };
}
