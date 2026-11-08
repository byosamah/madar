import type { Logger } from '../../core/ports';
import type { OfficeStub } from '../../entries/officeWorker';
import type { EnterpriseId } from '../ids';
import type { PlatformStub } from './stub';

/**
 * The owner check of the platform calls (Madar enterprises, design 5.6 and decision D4). A platform owner is an ACTIVE person of an
 * enterprise whose pair (enterprise id, person id) is in the owner list of the platform object. Every platform call checks both, so a
 * turned-off or removed owner loses the page at once, also with a token that is still valid. The token proves the enterprise and the sign-in;
 * the object finds the person; the platform object knows the pair.
 */
export async function ownerOf(o: {
  token: { authUserId: string; ent: EnterpriseId };
  office(ent: EnterpriseId): Pick<OfficeStub, 'person'>;
  platform: Pick<PlatformStub, 'isOwner'>;
  log?: Logger;
}): Promise<{ ent: EnterpriseId; userId: string } | null> {
  const { ent, authUserId } = o.token;
  let person: { userId: string } | null;
  try {
    person = await o.office(ent).person({ ent, authUserId });
  } catch (error) {
    // A paused object, an object that was never made or a failure: the caller is no owner for this call. The answer stays not_found.
    o.log?.warn('The owner check could not read the person.', { ent, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
  if (person === null) return null;
  return (await o.platform.isOwner({ ent, userId: person.userId })) ? { ent, userId: person.userId } : null;
}
