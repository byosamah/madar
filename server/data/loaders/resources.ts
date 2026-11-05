import { holdsLockedFolders } from '../../../src/api/folderLock';
import { lockedResourceIds } from '../../../src/api/resourceLock';
import type { Cond } from './query';
import type { Load } from './build';
import { officeState } from './steps';

/**
 * The loaders of the Resources page (fbk_078). The folders live in the office settings, which every call holds. The files are the rows with the
 * marker `resource` (no column: a read of the doc field). The handlers drop a file of a locked folder for a person without the switch, so the
 * limited read of the search leaves those files out in SQL, and the cut of the scoped load equals the cut of the whole office.
 */

type Input = Record<string, unknown>;
const str = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const RESOURCE: Cond = { field: 'resource', in: ['true'] };

/** resources.list, resources.saveFolder, resources.deleteFolder and the upload into Resources: every file of Resources. */
export async function resourceFiles(L: Load): Promise<void> {
  await L.select({ c: 'files', where: [RESOURCE] });
}

/** resources.updateFile and resources.deleteFile: the file by id. */
export async function resourceFileCall(L: Load, input: Input): Promise<void> {
  await L.byKey('files', [str(input.id)]);
}

/** The first files of Resources whose name holds the query (search.query): a person without the switch "Locked folders" never reads a locked folder. */
export async function resourceHits(L: Load, query: string): Promise<void> {
  if (!L.authority) return;
  const office = officeState(L);
  const locked = [...lockedResourceIds(office)];
  const where: Cond[] = [RESOURCE, { col: 'search_text', contains: query }];
  if (locked.length > 0 && !holdsLockedFolders(office, L.authority)) where.push({ field: 'folderId', notIn: locked });
  await L.select({ c: 'files', where, limit: 5 });
}
