import type { DirectoryPort } from '../core/ports';
import type { EnterpriseId } from './ids';
import type { PlatformStub } from './platform/stub';

/**
 * The email directory as one enterprise sees it (Madar enterprises, design 5.4). The Worker builds one for each request, bound to the id of
 * that request (from the signed token claim), and gives it to the network port of the call. The object calls it back before a write of
 * an email, so it never names an enterprise: it cannot reserve or release an email for another enterprise.
 */
export function directoryOf(platform: Pick<PlatformStub, 'reserveEmail' | 'releaseEmail'>, ent: EnterpriseId): DirectoryPort {
  return {
    reserve: (email) => platform.reserveEmail({ ent, email }),
    release: (email) => platform.releaseEmail({ ent, email }),
  };
}
