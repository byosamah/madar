import type { Event, FileRec, Project, ProjectFolder, User } from './contract/entities';
import { holdsRight } from './permissions';
import { ensureRights } from './rights';
import type { State } from './store';

/**
 * The rule of locked folders (fbk_074, owner 2026-10-29). A locked folder, and every file in it, shows only to the people who hold the switch
 * "Locked folders" (folder.locked). The Admin holds it. Everyone else gets the answer of a missing folder or file, on every read and write path.
 * This module has the pure parts of the rule, so the handlers, the views, the server and the signals all ask the same question.
 */

type Rights = Pick<State, 'settings'>;
type Places = Pick<State, 'settings' | 'projects'>;

export const LOCKED_RIGHT = 'folder.locked';

/** True when the person holds the switch "Locked folders". The person is the one whose rights apply (the person behind an agent). */
export function holdsLockedFolders(state: Rights, viewer: User): boolean {
  return holdsRight(ensureRights(state, viewer), LOCKED_RIGHT);
}

const isLocked = (folder: Pick<ProjectFolder, 'locked'> | undefined): boolean => folder?.locked === true;

/** The folders of a project that the person may see: all of them for a holder of the switch, the open ones for anyone else. */
export function foldersFor(state: Rights, viewer: User, folders: readonly ProjectFolder[] | undefined): ProjectFolder[] {
  const all = folders ?? [];
  if (!all.some(isLocked)) return [...all];
  return holdsLockedFolders(state, viewer) ? [...all] : all.filter((folder) => !isLocked(folder));
}

/** True when the folder is locked and the person does not hold the switch: the folder reads as missing. A missing folder is not hidden. */
export function folderHiddenFrom(state: Rights, viewer: User, folders: readonly ProjectFolder[] | undefined, folderId: string | null | undefined): boolean {
  if (!folderId) return false;
  const folder = folders?.find((item) => item.id === folderId);
  return isLocked(folder) && !holdsLockedFolders(state, viewer);
}

/** True when a file sits in a locked folder that the person may not see. A file of no project, and a file at the root, are never hidden here. */
export function fileHiddenByLock(state: Places, viewer: User, file: Pick<FileRec, 'projectId' | 'folderId'>): boolean {
  if (file.projectId === null || !file.folderId) return false;
  return folderHiddenFrom(state, viewer, state.projects[file.projectId]?.folders, file.folderId);
}

/** True when the file sits in a locked folder (for any person). */
export function fileInLockedFolder(state: Pick<State, 'projects'>, file: Pick<FileRec, 'projectId' | 'folderId'>): boolean {
  if (file.projectId === null || !file.folderId) return false;
  return isLocked(state.projects[file.projectId]?.folders?.find((item) => item.id === file.folderId));
}

type FolderSide = { folders?: unknown } | null | undefined;

const foldersOfSide = (side: unknown): ProjectFolder[] | undefined => {
  const folders = (side as FolderSide)?.folders;
  return Array.isArray(folders) ? (folders as ProjectFolder[]) : undefined;
};

/** The folders that differ between two lists, by id and by value: both forms of a changed folder, so an unlock counts as a change of a locked folder. */
function changedFolders(before: readonly ProjectFolder[], after: readonly ProjectFolder[]): ProjectFolder[] {
  const was = new Map(before.map((folder) => [folder.id, folder]));
  const now = new Map(after.map((folder) => [folder.id, folder]));
  const out: ProjectFolder[] = [];
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    if (JSON.stringify(was.get(id)) === JSON.stringify(now.get(id))) continue;
    for (const folder of [was.get(id), now.get(id)]) if (folder) out.push(folder);
  }
  return out;
}

/** The ids of the folders of a project that are locked now. */
const lockedNow = (state: Pick<State, 'projects'>, projectId: string | null): ReadonlySet<string> =>
  new Set((projectId ? state.projects[projectId]?.folders ?? [] : []).filter(isLocked).map((folder) => folder.id));

type EventFacts = Pick<Event, 'projectId' | 'verb' | 'targetType' | 'targetId' | 'before' | 'after'>;

/**
 * True when the change touches a locked folder, whatever the person is: the change of a folder list that adds, removes, renames, locks or
 * unlocks a folder that is locked now or was locked then (it reads the folder lists in the event itself), and the change of a file that sits in,
 * or came from, or went into a folder that is locked now. The History, the feed and the Undo hide such a change from a person without the switch.
 * A folder that is locked now hides its whole past, also the days when it was open: the name in an old event is a name to hide.
 */
export function eventTouchesLocked(state: Pick<State, 'projects' | 'files'>, event: EventFacts): boolean {
  if (event.projectId === null) return false;
  const locked = lockedNow(state, event.projectId);
  // The Undo of a folder change keeps both folder lists, as the change did.
  const folderList = event.verb === 'project.folders_changed'
    || (event.verb === 'undo' && event.targetType === 'project' && foldersOfSide(event.before) !== undefined && foldersOfSide(event.after) !== undefined);
  if (folderList) {
    const was = foldersOfSide(event.before) ?? [];
    const now = foldersOfSide(event.after) ?? [];
    return changedFolders(was, now).some((folder) => isLocked(folder) || locked.has(folder.id));
  }
  if (event.targetType !== 'file' || locked.size === 0) return false;
  const named = [
    state.files[event.targetId]?.folderId,
    (event.before as { folderId?: unknown } | null)?.folderId,
    (event.after as { folderId?: unknown } | null)?.folderId,
  ];
  return named.some((id) => typeof id === 'string' && locked.has(id));
}

/** True when the person may not see the change because it touches a locked folder. */
export function eventHiddenByLock(state: Pick<State, 'settings' | 'projects' | 'files'>, viewer: User, event: EventFacts): boolean {
  return eventTouchesLocked(state, event) && !holdsLockedFolders(state, viewer);
}

/**
 * The event as a person without the switch may read it: the locked folders (locked in the event, or locked now) are taken out of a folder list that
 * the event keeps (a project creation holds its folders, and so does its delete, and a change of one folder holds the whole list). A holder of the
 * switch gets the event as it is.
 */
export function eventForViewer<T extends Pick<Event, 'projectId' | 'before' | 'after'>>(state: Pick<State, 'settings' | 'projects'>, viewer: User, event: T): T {
  const hasFolders = (side: unknown) => (foldersOfSide(side)?.length ?? 0) > 0;
  if (!hasFolders(event.before) && !hasFolders(event.after)) return event;
  const locked = lockedNow(state, event.projectId);
  const hidden = (folder: ProjectFolder) => isLocked(folder) || locked.has(folder.id);
  if (![event.before, event.after].some((side) => foldersOfSide(side)?.some(hidden))) return event;
  if (holdsLockedFolders(state, viewer)) return event;
  const strip = (side: unknown): unknown => {
    const folders = foldersOfSide(side);
    return folders ? { ...(side as object), folders: folders.filter((folder) => !hidden(folder)) } : side;
  };
  return { ...event, before: strip(event.before), after: strip(event.after) };
}

/** The project record as a person may read it: the locked folders are left out for a person without the switch. */
export function projectForViewer(state: Rights, viewer: User, project: Project): Project {
  if (!project.folders?.some(isLocked) || holdsLockedFolders(state, viewer)) return project;
  return { ...project, folders: foldersFor(state, viewer, project.folders) };
}

/**
 * What a change of a folder list does to the locked folders, for the change signals (fbk_074). "inside": only locked folders differ, and none gets
 * locked or unlocked (a locked folder is made, renamed or deleted): only the holders of the switch need to hear it. "toggle": a folder gets locked
 * or unlocked, so everyone must reload the folder list and the files. "none": no locked folder differs.
 */
export function lockedFolderChange(before: readonly ProjectFolder[] | undefined, after: readonly ProjectFolder[] | undefined): 'none' | 'inside' | 'toggle' {
  const was = new Map((before ?? []).map((folder) => [folder.id, folder]));
  const now = new Map((after ?? []).map((folder) => [folder.id, folder]));
  let inside = false;
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const w = was.get(id);
    const n = now.get(id);
    if (JSON.stringify(w) === JSON.stringify(n)) continue;
    const lockedWas = w ? isLocked(w) : isLocked(n);
    const lockedNow = n ? isLocked(n) : isLocked(w);
    if (lockedWas !== lockedNow) return 'toggle';
    if (lockedWas) inside = true;
  }
  return inside ? 'inside' : 'none';
}
