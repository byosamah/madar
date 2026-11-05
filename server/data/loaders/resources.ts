import type { Event, FileRec } from '../../../src/api/contract/entities';
import { holdsLockedFolders } from '../../../src/api/folderLock';
import { eventTouchesLockedResources, lockedResourceIds, RESOURCE_FOLDERS_VERB, RESOURCES_TARGET_ID } from '../../../src/api/resourceLock';
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

/**
 * The files of Resources: no project (the index on project_id serves "is null", so a read touches the few files with no project and never the whole
 * table; the rows pins of test:office hold it) and the marker. The marker has no column, so it is a read of the doc field.
 */
const RESOURCE: readonly Cond[] = [{ col: 'project_id', eq: null }, { field: 'resource', in: ['true'] }];
export const RESOURCE_FILES: readonly Cond[] = RESOURCE;

/** resources.list, resources.saveFolder, resources.deleteFolder and the upload into Resources: every file of Resources. */
export async function resourceFiles(L: Load): Promise<void> {
  await L.select({ c: 'files', where: [...RESOURCE] });
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
  const where: Cond[] = [...RESOURCE, { col: 'search_text', contains: query }];
  if (locked.length > 0 && !holdsLockedFolders(office, L.authority)) where.push({ field: 'folderId', notIn: locked });
  await L.select({ c: 'files', where, limit: 5 });
}

/**
 * The ids of the events that a person without the switch "Locked folders" may not read, for the History (events.list): a change of the folder list that
 * touches a locked folder, and a change of a resource file that sits in, came from or went into one. The limit of events.list counts the events that
 * the SQL passes, so the loader leaves these out in SQL, and the cut of the scoped load equals the cut of the whole office. Nothing for a holder, and
 * nothing while no folder is locked. The files in locked folders come into the load, because the rule reads the folder of the file.
 */
export async function hiddenResourceEventIds(L: Load): Promise<string[]> {
  if (!L.authority) return [];
  const office = officeState(L);
  const locked = [...lockedResourceIds(office)];
  if (locked.length === 0 || holdsLockedFolders(office, L.authority)) return [];
  const inside = (await L.select({ c: 'files', where: [...RESOURCE, { field: 'folderId', in: locked }] })) as FileRec[];
  const facts = { settings: office.settings, files: Object.fromEntries(inside.map((file) => [file.id, file])) };
  const lists = (await L.select({ c: 'events', where: [{ col: 'target_type', eq: 'settings' }, { col: 'target_id', in: [RESOURCES_TARGET_ID] }] })) as Event[];
  const files = (await L.select({
    c: 'events',
    where: [{ col: 'target_type', eq: 'file' }, { or: [
      { field: 'after', key: 'folderId', in: locked }, { field: 'before', key: 'folderId', in: locked },
      { col: 'target_id', in: inside.map((file) => file.id) },
    ] }],
  })) as Event[];
  return [...lists, ...files].filter((event) => (event.verb === RESOURCE_FOLDERS_VERB || event.verb === 'undo' || event.targetType === 'file') && eventTouchesLockedResources(facts as never, event)).map((event) => event.id);
}
