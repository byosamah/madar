import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { FOLDER_NAME_MAX, FileId, FolderId, MAX_FOLDERS, ResourceFolder, type Event, type FileRec, type FileVersion as Version } from '../contract/entities';
import { FileView, ResourcesView } from '../contract/views';
import { ApiError, invalid, notFound } from '../errors';
import { applyPatch, recordCreate, recordDelete, writeEvent } from '../events';
import { holdsLockedFolders } from '../folderLock';
import { can } from '../permissions';
import { RESOURCE_FOLDERS_VERB, RESOURCES_TARGET_ID, resourceFileHidden, resourceFoldersFor, resourceFoldersOf } from '../resourceLock';
import { nextId } from '../store';
import { fileViewOf } from '../views';
import { assertCan } from './shared';
import { nextLetter, type UploadPrepared } from './files';

/**
 * The Resources page (fbk_078, owner 2026-11-05): the files of the whole office, such as building codes and office policies. Every person reads
 * and downloads them. The switch "Manage office resources" (resources.manage) adds, renames, moves and deletes files and folders. A folder can
 * be locked: a locked folder, and every file in it, shows only to the holders of the switch "Locked folders" (folder.locked), and reads as a
 * missing folder or file for everyone else, on every path (src/api/resourceLock.ts).
 */

const nameKey = (name: string): string => name.trim().toLowerCase();
const FolderName = z.string().trim().min(1).max(FOLDER_NAME_MAX);
const FileName = z.string().trim().min(1).max(200);

/** A folder by id that the person may see. A locked folder reads as a missing folder for a person without the switch "Locked folders". */
export function requireResourceFolder(ctx: Ctx, id: string): ResourceFolder {
  const folder = resourceFoldersFor(ctx.state, ctx.authority).find((item) => item.id === id);
  if (!folder) throw notFound('Folder', id);
  return folder;
}

/** A resource file by id that the person may see. Any other file, and a file in a locked folder that the person may not see, reads as missing. */
export function requireResourceFile(ctx: Ctx, id: string): FileRec {
  const file = ctx.state.files[id];
  if (!file || file.resource !== true || resourceFileHidden(ctx.state, ctx.authority, file)) throw notFound('File', id);
  return file;
}

/** The place of a file: a folder that the person sees, or none (the root of Resources). A folder that is missing or hidden gives one answer. */
export function checkResourceFolder(ctx: Ctx, folderId: string | null): void {
  if (folderId === null) return;
  if (!resourceFoldersFor(ctx.state, ctx.authority).some((item) => item.id === folderId)) {
    throw invalid('folderId', 'This folder is not in Resources.', 'resource_folder_missing');
  }
}

/** Writes the folder list and one event. The event keeps the whole list on both sides, so the Undo and the locked-folder rules read it. */
function saveFolders(ctx: Ctx, folders: ResourceFolder[]): void {
  const before = structuredClone([...resourceFoldersOf(ctx.state)]);
  ctx.state.settings.resourceFolders = folders;
  writeEvent(ctx, {
    projectId: null, verb: RESOURCE_FOLDERS_VERB, targetType: 'settings', targetId: RESOURCES_TARGET_ID,
    before: { resourceFolders: before }, after: { resourceFolders: structuredClone(folders) },
  });
}

/** A name is taken inside Resources when a folder that the person sees has it. */
function assertFolderNameFree(ctx: Ctx, name: string, exceptId?: string): void {
  const taken = resourceFoldersFor(ctx.state, ctx.authority).some((item) => item.id !== exceptId && nameKey(item.name) === nameKey(name));
  if (taken) throw invalid('name', 'Resources has a folder with this name.', 'folder_name_taken');
}

/** The files of Resources that the person may see, with the folder of each, by name. */
export function resourceViewsOf(ctx: Ctx): FileView[] {
  const folders = new Map(resourceFoldersFor(ctx.state, ctx.authority).map((folder) => [folder.id, folder]));
  return Object.values(ctx.state.files)
    .filter((file) => file.resource === true && !resourceFileHidden(ctx.state, ctx.authority, file))
    .map((file) => {
      const folder = file.folderId ? folders.get(file.folderId) : undefined;
      return { ...fileViewOf(ctx.state, file, ctx.authority), ...(folder ? { folder: { id: folder.id, name: folder.name, ...(folder.locked === true ? { locked: true } : {}) } } : {}) };
    })
    .sort((a, b) => a.file.name.localeCompare(b.file.name));
}

export const resourcesList = defineCall({
  input: z.object({}),
  output: ResourcesView,
  readOnly: true,
  run(_input, ctx) {
    const folders = resourceFoldersFor(ctx.state, ctx.authority);
    const files = resourceViewsOf(ctx);
    return {
      folders: [...folders].sort((a, b) => a.name.localeCompare(b.name)),
      files,
      viewerCan: { manage: can(ctx.authority, 'resources.manage'), lock: can(ctx.authority, 'resources.manage') && holdsLockedFolders(ctx.state, ctx.authority) },
    };
  },
});

/** No id: makes a folder (name needed). An id: renames it (name), locks or unlocks it (locked), or both. The one door of the screens and the folder tools. */
export function saveResourceFolder(ctx: Ctx, input: { id?: string; name?: string; locked?: boolean }): ResourceFolder {
  const folders = [...resourceFoldersOf(ctx.state)];
  if (input.id === undefined) {
    assertCan(ctx, 'resources.manage');
    // A new locked folder needs the lock switch too, as the lock of a folder does.
    if (input.locked === true) assertCan(ctx, 'folder.locked');
    if (folders.length >= MAX_FOLDERS) throw invalid('name', `Resources holds up to ${MAX_FOLDERS} folders.`, 'resource_folder_limit');
    assertFolderNameFree(ctx, input.name!);
    const folder: ResourceFolder = {
      id: nextId(ctx.state, 'fld'), name: input.name!, createdBy: ctx.actor.id, createdAt: ctx.stamp, ...(input.locked === true ? { locked: true } : {}),
    };
    saveFolders(ctx, [...folders, folder]);
    return folder;
  }
  // The view check comes first, so a locked folder reads as missing for a person without the switch "Locked folders".
  const folder = requireResourceFolder(ctx, input.id);
  assertCan(ctx, 'resources.manage');
  const lockChanges = input.locked !== undefined && (folder.locked === true) !== input.locked;
  if (lockChanges) assertCan(ctx, 'folder.locked');
  const renames = input.name !== undefined && input.name !== folder.name;
  if (renames) assertFolderNameFree(ctx, input.name!, folder.id);
  if (!renames && !lockChanges) return folder;
  const { locked: _locked, ...rest } = folder;
  const next: ResourceFolder = {
    ...rest, ...(renames ? { name: input.name! } : {}),
    ...((lockChanges ? input.locked === true : folder.locked === true) ? { locked: true } : {}),
  };
  saveFolders(ctx, folders.map((item) => (item.id === folder.id ? next : item)));
  return next;
}

export const resourcesSaveFolder = defineCall({
  /** No id: a new folder (name needed). An id: a rename (name), a lock or an unlock (locked), or both. */
  input: z.object({ id: FolderId.optional(), name: FolderName.optional(), locked: z.boolean().optional() })
    .refine((value) => value.id !== undefined || value.name !== undefined, { path: ['name'], message: 'Name the folder.' })
    .refine((value) => value.id === undefined || value.name !== undefined || value.locked !== undefined, { path: ['name'], message: 'Change the name or the lock.' }),
  output: ResourceFolder,
  run: (input, ctx) => saveResourceFolder(ctx, input),
});

/** Renames a file (name) or moves it (folderId, null: the root). The one door of the screens and the file tools. */
export function updateResourceFile(ctx: Ctx, input: { id: string; name?: string; folderId?: string | null }): FileView {
  const file = requireResourceFile(ctx, input.id);
  assertCan(ctx, 'resources.manage');
  const name = input.name ?? file.name;
  const folderId = input.folderId === undefined ? (file.folderId ?? null) : input.folderId;
  checkResourceFolder(ctx, folderId);
  const renames = name !== file.name;
  const moves = folderId !== (file.folderId ?? null);
  // A file saved before folders has no folderId. The event keeps the old value, so the Undo can put it back.
  if (moves && file.folderId === undefined) file.folderId = null;
  if (renames) applyPatch(ctx, file, { name }, { projectId: null, verb: 'file.renamed', targetType: 'file', targetId: file.id });
  if (moves) applyPatch(ctx, file, { folderId }, { projectId: null, verb: 'file.moved', targetType: 'file', targetId: file.id });
  return fileViewOf(ctx.state, file, ctx.authority);
}

export const resourcesUpdateFile = defineCall({
  /** name: a new name. folderId: a new place (a folder, or null for the root of Resources). */
  input: z.object({ id: FileId, name: FileName.optional(), folderId: FolderId.nullable().optional() })
    .refine((value) => value.name !== undefined || value.folderId !== undefined, { path: ['name'], message: 'Change the name or the folder.' }),
  output: FileView,
  run: (input, ctx) => updateResourceFile(ctx, input),
});

/**
 * Deletes a folder (id fld_...) or a file (id fil_...) of Resources. One call, so the list of tools stays small. A folder delete deletes no file: its files
 * go back to the root. A locked folder is not deleted at all.
 */
export const resourcesDelete = defineCall({
  input: z.object({ id: z.union([FolderId, FileId]) }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    if (input.id.startsWith('fld_')) return deleteResourceFolder(ctx, input.id);
    return deleteResourceFile(ctx, input.id);
  },
});

export function deleteResourceFolder(ctx: Ctx, id: string): { deleted: true } {
  const folder = requireResourceFolder(ctx, id);
  assertCan(ctx, 'resources.manage');
  // The files of a deleted folder go back to the root, where everyone sees them, and the History would show their names. So a locked folder is
  // not deleted at all: the holder unlocks it first, which is the deliberate act that shows its files.
  if (folder.locked === true) throw invalid('id', 'Unlock a locked folder before you delete it.', 'folder_locked');
  // No file is deleted. The file changes come first and the folder list last, so one Undo of the story brings the folder back before it puts the files in it.
  for (const file of Object.values(ctx.state.files)) {
    if (file.resource === true && file.folderId === folder.id) {
      applyPatch(ctx, file, { folderId: null }, { projectId: null, verb: 'file.moved', targetType: 'file', targetId: file.id });
    }
  }
  saveFolders(ctx, resourceFoldersOf(ctx.state).filter((item) => item.id !== folder.id));
  return { deleted: true as const };
}

export function deleteResourceFile(ctx: Ctx, id: string): { deleted: true } {
  const file = requireResourceFile(ctx, id);
  assertCan(ctx, 'resources.manage');
  recordDelete(ctx, { projectId: null, verb: 'file.deleted', targetType: 'file', targetId: file.id, entity: file });
  delete ctx.state.files[file.id];
  return { deleted: true as const };
}

/**
 * An upload into Resources (files.upload with `resources: true`): a person with the switch adds a file to a folder, or to the root. A second file with
 * the same name in the same place is the next version of the first. It has no project, stage, task or cover, and no Tracker line.
 */
export function uploadResourceFile(ctx: Ctx, input: { name: string; folderId?: string | null; stageId: string | null; taskId: string | null; asCover: boolean; receivedFromClient: boolean }, prepared: UploadPrepared): FileView {
  assertCan(ctx, 'resources.manage');
  const misuse = input.stageId ? 'stageId' : input.taskId ? 'taskId' : input.asCover ? 'asCover' : input.receivedFromClient ? 'receivedFromClient' : null;
  if (misuse) throw invalid(misuse, 'A file of Resources belongs to no stage, no task and no cover.', 'file_resource');
  const folderId = input.folderId ?? null;
  checkResourceFolder(ctx, folderId);
  const version: Version = {
    letter: 'A', blobKey: prepared.blobKey, mimeType: prepared.mimeType, size: prepared.size,
    uploadedBy: ctx.actor.id, uploadedAt: ctx.stamp, ...(prepared.thumbKey ? { thumbKey: prepared.thumbKey } : {}),
  };
  const same = Object.values(ctx.state.files).find((file) => file.resource === true && (file.folderId ?? null) === folderId && nameKey(file.name) === nameKey(input.name)
    && !resourceFileHidden(ctx.state, ctx.authority, file));
  if (same) {
    version.letter = nextLetter(same.versions[same.versions.length - 1].letter);
    const before = { versions: structuredClone(same.versions) };
    same.versions.push(version);
    writeEvent(ctx, { projectId: null, verb: 'file.version_added', targetType: 'file', targetId: same.id, before, after: { versions: structuredClone(same.versions) } });
    return fileViewOf(ctx.state, same, ctx.authority);
  }
  const id = nextId(ctx.state, 'fil');
  const file: FileRec = { id, projectId: null, stageId: null, taskId: null, resource: true, ...(folderId ? { folderId } : {}), name: input.name, versions: [version] };
  ctx.state.files[id] = file;
  recordCreate(ctx, { projectId: null, verb: 'file.added', targetType: 'file', targetId: id, entity: file });
  return fileViewOf(ctx.state, file, ctx.authority);
}

/**
 * The Undo of a change of the folder list (the event lives in the settings, so the generic Undo has no collection for it). A later change of the
 * list that stands blocks the Undo. The list must be as the change left it. A locked folder that this takes away and that still holds files refuses
 * the Undo, as for the folders of a project. A file that points at a folder that is gone goes back to the root.
 */
export function undoResourceFolders(ctx: Ctx, event: Event): Event {
  const conflict = (message = 'This item changed after that edit. Undo is not available.') => new ApiError('conflict', message);
  if (event.undoneBy) throw conflict('This change is already undone.');
  const later = Object.values(ctx.state.events).filter(
    (e) => e.seq > event.seq && e.targetType === 'settings' && e.targetId === RESOURCES_TARGET_ID && e.undoneBy === null && e.verb !== 'undo',
  );
  const now = [...resourceFoldersOf(ctx.state)];
  const was = (event.after as { resourceFolders?: ResourceFolder[] } | null)?.resourceFolders ?? [];
  const back = structuredClone((event.before as { resourceFolders?: ResourceFolder[] } | null)?.resourceFolders ?? []);
  if (later.length > 0 || JSON.stringify(now) !== JSON.stringify(was)) throw conflict();
  for (const folder of now) {
    if (folder.locked !== true || back.some((item) => item.id === folder.id)) continue;
    if (Object.values(ctx.state.files).some((file) => file.resource === true && file.folderId === folder.id)) {
      throw new ApiError('conflict', 'A locked folder still holds files. Move them out first. Undo is not available.', { reason: 'folder_locked_has_files' });
    }
  }
  ctx.state.settings.resourceFolders = back;
  const undo = writeEvent(ctx, {
    projectId: null, verb: 'undo', targetType: 'settings', targetId: RESOURCES_TARGET_ID, undoes: event.id,
    before: { resourceFolders: structuredClone(now) }, after: { resourceFolders: structuredClone(back) },
  });
  event.undoneBy = undo.id;
  const alive = new Set(back.map((folder) => folder.id));
  for (const file of Object.values(ctx.state.files)) {
    if (file.resource === true && file.folderId && !alive.has(file.folderId)) file.folderId = null;
  }
  return undo;
}

export const resourceCalls = {
  'resources.list': resourcesList,
  'resources.saveFolder': resourcesSaveFolder,
  'resources.updateFile': resourcesUpdateFile,
  'resources.delete': resourcesDelete,
};
