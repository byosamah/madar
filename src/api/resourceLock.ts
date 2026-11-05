import type { Event, FileRec, ResourceFolder, User } from './contract/entities';
import { changedFolders, holdsLockedFolders, lockedFolderChange } from './folderLock';
import type { State } from './store';

/**
 * The rule of the Resources page (fbk_078, owner 2026-11-05). The folders live in Settings.resourceFolders, and a resource file is a FileRec
 * with `resource: true`. A locked folder, and every file in it, shows only to the people who hold the switch "Locked folders" (folder.locked,
 * the switch of the locked project folders). Everyone else gets the answer of a missing folder or file on every read and write path.
 * This module holds the pure parts, so the handlers, the views, the server and the signals all ask the same question.
 */

type Rights = Pick<State, 'settings'>;

/** The verb of a change of the folder list. The event is about the settings record, with the id "resources". */
export const RESOURCE_FOLDERS_VERB = 'resources.folders_changed';
export const RESOURCES_TARGET_ID = 'resources';

const isLocked = (folder: Pick<ResourceFolder, 'locked'> | undefined): boolean => folder?.locked === true;

/** All the folders of Resources, locked ones too. Only a place that already checked the person reads this. */
export function resourceFoldersOf(state: Rights): readonly ResourceFolder[] {
  return state.settings?.resourceFolders ?? [];
}

/** The folders of Resources that the person may see: all of them for a holder of the switch, the open ones for anyone else. */
export function resourceFoldersFor(state: Rights, viewer: User): ResourceFolder[] {
  const all = resourceFoldersOf(state);
  if (!all.some(isLocked)) return [...all];
  return holdsLockedFolders(state, viewer) ? [...all] : all.filter((folder) => !isLocked(folder));
}

/** The ids of the folders that are locked now. */
export function lockedResourceIds(state: Rights): ReadonlySet<string> {
  return new Set(resourceFoldersOf(state).filter(isLocked).map((folder) => folder.id));
}

/** True when the folder is locked and the person does not hold the switch: the folder reads as missing. A missing folder is not hidden. */
export function resourceFolderHidden(state: Rights, viewer: User, folderId: string | null | undefined): boolean {
  if (!folderId) return false;
  return isLocked(resourceFoldersOf(state).find((folder) => folder.id === folderId)) && !holdsLockedFolders(state, viewer);
}

/** True when the file is a file of Resources. */
export const isResourceFile = (file: Pick<FileRec, 'resource'>): boolean => file.resource === true;

/** True when a resource file sits in a locked folder that the person may not see. Any other file is never hidden here. */
export function resourceFileHidden(state: Rights, viewer: User, file: Pick<FileRec, 'resource' | 'folderId'>): boolean {
  return file.resource === true && resourceFolderHidden(state, viewer, file.folderId);
}

/** True when a resource file sits in a locked folder (for any person). */
export function resourceFileLocked(state: Rights, file: Pick<FileRec, 'resource' | 'folderId'>): boolean {
  return file.resource === true && typeof file.folderId === 'string' && lockedResourceIds(state).has(file.folderId);
}

type Facts = Pick<Event, 'projectId' | 'verb' | 'targetType' | 'targetId' | 'before' | 'after'>;
type EventState = Pick<State, 'settings' | 'files'>;

const listOf = (side: unknown): ResourceFolder[] | undefined => {
  const folders = (side as { resourceFolders?: unknown } | null | undefined)?.resourceFolders;
  return Array.isArray(folders) ? (folders as ResourceFolder[]) : undefined;
};

/** True when the event is a change of the folder list: the change itself, or the Undo of it (the Undo keeps both lists). */
export function isResourceFoldersEvent(event: Pick<Event, 'verb' | 'targetType' | 'targetId' | 'before' | 'after'>): boolean {
  if (event.targetType !== 'settings') return false;
  if (event.verb === RESOURCE_FOLDERS_VERB) return true;
  return event.verb === 'undo' && event.targetId === RESOURCES_TARGET_ID && listOf(event.before) !== undefined && listOf(event.after) !== undefined;
}

/** True when the event is about a file of Resources: the live record tells, else the whole record that a create or a delete keeps. */
export function isResourceFileEvent(state: Pick<State, 'files'>, event: Pick<Event, 'targetType' | 'targetId' | 'before' | 'after'>): boolean {
  if (event.targetType !== 'file') return false;
  if (state.files[event.targetId]?.resource === true) return true;
  return [event.before, event.after].some((side) => (side as { resource?: unknown } | null)?.resource === true);
}

/**
 * True when the change touches a locked folder, whatever the person is: a change of the folder list that adds, removes, renames, locks or unlocks a
 * folder that is locked now or was locked then, and a change of a resource file that sits in, or came from, or went into a folder that is locked
 * now. A folder that is locked now hides its whole past, also the days when it was open: the name in an old event is a name to hide.
 */
export function eventTouchesLockedResources(state: EventState, event: Facts): boolean {
  const locked = lockedResourceIds(state);
  if (isResourceFoldersEvent(event)) {
    return changedFolders(listOf(event.before) ?? [], listOf(event.after) ?? []).some((folder) => isLocked(folder) || locked.has(folder.id));
  }
  if (locked.size === 0 || !isResourceFileEvent(state, event)) return false;
  const named = [
    state.files[event.targetId]?.folderId,
    (event.before as { folderId?: unknown } | null)?.folderId,
    (event.after as { folderId?: unknown } | null)?.folderId,
  ];
  return named.some((id) => typeof id === 'string' && locked.has(id));
}

/** True when the person may not see the change because it touches a locked folder of Resources. */
export function eventHiddenByResourceLock(state: EventState, viewer: User, event: Facts): boolean {
  return eventTouchesLockedResources(state, event) && !holdsLockedFolders(state, viewer);
}

/**
 * The event as a person without the switch may read it: the locked folders are taken out of the folder lists that the event keeps. A change that
 * touches a locked folder is hidden from that person anyway (eventHiddenByResourceLock), so this only guards a list that mixes both kinds.
 */
export function resourceEventForViewer<T extends Pick<Event, 'verb' | 'targetType' | 'targetId' | 'before' | 'after'>>(state: Rights, viewer: User, event: T): T {
  if (!isResourceFoldersEvent(event) || holdsLockedFolders(state, viewer)) return event;
  const locked = lockedResourceIds(state);
  const strip = (side: unknown): unknown => {
    const folders = listOf(side);
    return folders ? { ...(side as object), resourceFolders: folders.filter((folder) => !isLocked(folder) && !locked.has(folder.id)) } : side;
  };
  return { ...event, before: strip(event.before), after: strip(event.after) };
}

/** What a change of the folder list does to the locked folders, for the change signals: the same answer as for the folders of a project. */
export function lockedResourceChange(before: readonly ResourceFolder[] | undefined, after: readonly ResourceFolder[] | undefined): 'none' | 'inside' | 'toggle' {
  return lockedFolderChange(before as never, after as never);
}
