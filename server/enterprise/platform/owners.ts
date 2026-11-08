import type { Logger } from '../../core/ports';
import type { OfficeStub } from '../../entries/officeWorker';
import type { EnterpriseId } from '../ids';
import type { PlatformStub } from './stub';

/**
 * Writes the owner list (Madar enterprises, design 5.6): the platform object keeps the master list, and each enterprise object keeps a
 * copy of its own owners (enterprise_use.owners), so session.get can show platformOwner with no call to the platform. Only the ops route
 * with the ops secret calls this. The list is replaced as a whole; an enterprise with no owner gets an empty list.
 */
export async function writeOwners(
  o: { platform: PlatformStub; office(ent: EnterpriseId): Pick<OfficeStub, 'setPlatformOwners'>; log?: Logger },
  owners: { ent: EnterpriseId; userId: string }[],
): Promise<void> {
  await o.platform.setOwners({ owners });
  for (const ent of await o.platform.listed()) {
    const userIds = owners.filter((one) => one.ent === ent).map((one) => one.userId);
    try {
      await o.office(ent).setPlatformOwners({ ent, userIds });
    } catch (error) {
      // A paused object refuses the copy. It holds no owner (the platform never pauses an enterprise with an owner), so the copy stays right.
      o.log?.warn('The owner copy of an enterprise was not written.', { ent, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
