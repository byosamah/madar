import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { FOLDER_NAME_MAX, FOLDER_PRESET_NAMES, FolderId, FolderPreset, MAX_FOLDERS, ProjectFolder, ProjectId, StageId, type FileRec, type Project } from '../contract/entities';
import { invalid, notFound } from '../errors';
import { applyPatch } from '../events';
import { folderHiddenFrom, foldersFor } from '../folderLock';
import { nextId } from '../store';
import { assertCan, requireProject, requireStage, roleIn, seesProject } from './shared';

/** The folder name as the folders compare it: trimmed, and with no difference of capital letters. */
const nameKey = (name: string): string => name.trim().toLowerCase();

const FolderName = z.string().trim().min(1).max(FOLDER_NAME_MAX);

/**
 * A folder by id with the project that holds it (fbk_066). A folder of a project that the person does not see reads as a missing folder:
 * the same code, text and details as an unknown id, so no call tells that a hidden folder exists. A locked folder reads the same for a
 * person without the switch "Locked folders" (fbk_074).
 */
export function requireFolder(ctx: Ctx, id: string): { project: Project; folder: ProjectFolder } {
  for (const project of Object.values(ctx.state.projects)) {
    const folder = project.folders?.find((item) => item.id === id);
    if (folder && seesProject(ctx, project.id) && !folderHiddenFrom(ctx.state, ctx.authority, project.folders, id)) return { project, folder };
  }
  throw notFound('Folder', id);
}

/** The person may change folders and move files where the upload is allowed (the same gate as the upload, fbk_066). */
function assertMayOrganize(ctx: Ctx, project: Project): void {
  assertCan(ctx, 'file.upload', { projectRole: roleIn(ctx, project.id) });
}

/**
 * The place of a file in a project: a stage of the project (or none) and a folder of that place (or none). A folder sits in one real stage, or
 * in no stage (a folder of the whole project, fbk_074). A folder of another place is refused (reason folder_other_stage). A locked folder that the
 * person may not see is a missing folder, with the answer of an unknown id.
 */
export function checkPlace(ctx: Ctx, project: Project, stageId: string | null, folderId: string | null): void {
  if (stageId) requireStage(ctx, project.id, stageId);
  if (folderId === null) return;
  const folder = foldersFor(ctx.state, ctx.authority, project.folders).find((item) => item.id === folderId);
  if (!folder) throw invalid('folderId', 'This folder is not in the project.', 'folder_missing');
  if ((folder.stageId ?? null) !== (stageId ?? null)) throw invalid('folderId', 'This folder is in another stage.', 'folder_other_stage');
}

/**
 * What a locked folder holds (fbk_074): no file of a to-do (the to-do would still count and list it), no cover (the cover shows to everyone), and no
 * file that the Tracker names (its line shows the file name). The check runs for the file that an upload or a move puts in the folder.
 */
export function assertFitsLockedFolder(ctx: Ctx, project: Project, file: Pick<FileRec, 'id' | 'taskId'>, folderId: string | null): void {
  if (!folderId || project.folders?.find((item) => item.id === folderId)?.locked !== true) return;
  if (file.taskId) throw invalid('folderId', 'A file of a to-do cannot go in a locked folder.', 'folder_locked_task_file');
  if (project.coverFileId === file.id) throw invalid('folderId', 'The cover of the project cannot go in a locked folder.', 'folder_locked_cover');
}

/** Organizing is no news: the change leaves the "last update" of the project as it is (no touch). */
function saveFolders(ctx: Ctx, project: Project, folders: ProjectFolder[]): void {
  applyPatch(ctx, project, { folders }, { projectId: project.id, verb: 'project.folders_changed', targetType: 'project', targetId: project.id });
}

/** A name is taken inside one place: one stage, or the whole project. The person compares only the folders that the person may see. */
function assertNameFree(ctx: Ctx, project: Project, stageId: string | null, name: string, exceptId?: string): void {
  const taken = foldersFor(ctx.state, ctx.authority, project.folders)
    .some((item) => (item.stageId ?? null) === stageId && item.id !== exceptId && nameKey(item.name) === nameKey(name));
  if (taken) throw invalid('name', stageId === null ? 'The project has a folder with this name.' : 'This stage has a folder with this name.', 'folder_name_taken');
}

/**
 * The two folders that a new client project starts with (fbk_074, owner 2026-10-29): both for the whole project. The Contract folder starts
 * locked. An internal project has no client and no contract, so it gets none.
 */
export function presetFoldersOf(ctx: Ctx): ProjectFolder[] {
  return (['client_documents', 'contract'] as const).map((preset) => ({
    id: nextId(ctx.state, 'fld'), stageId: null, name: FOLDER_PRESET_NAMES[preset], createdBy: ctx.actor.id, createdAt: ctx.stamp, preset,
    ...(preset === 'contract' ? { locked: true } : {}),
  }));
}

/** The name for a folder that joins the whole project: the same name when it is free there, else the name with a number (a locked folder of a removed stage). */
export function freeProjectFolderName(folders: readonly ProjectFolder[], name: string): string {
  const taken = new Set(folders.filter((item) => item.stageId === null).map((item) => nameKey(item.name)));
  if (!taken.has(nameKey(name))) return name;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const next = name.slice(0, FOLDER_NAME_MAX - suffix.length) + suffix;
    if (!taken.has(nameKey(next))) return next;
  }
}

export const foldersCreate = defineCall({
  /** stageId null or absent: a folder of the whole project. preset: one of the two standard folders (the name is then its English name). */
  input: z.object({ projectId: ProjectId, stageId: StageId.nullable().optional(), name: FolderName.optional(), preset: FolderPreset.optional() })
    .refine((value) => value.name !== undefined || value.preset !== undefined, { path: ['name'], message: 'Name the folder.' }),
  output: ProjectFolder,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertMayOrganize(ctx, project);
    const stageId = input.stageId ?? null;
    if (stageId) requireStage(ctx, project.id, stageId);
    const preset = input.preset;
    if (preset) {
      if (stageId) throw invalid('stageId', 'A standard folder is a folder of the whole project.', 'folder_preset_stage');
      if (input.name !== undefined && input.name !== FOLDER_PRESET_NAMES[preset]) throw invalid('name', 'A standard folder has its own name.', 'folder_preset_name');
      // The Contract folder starts locked, so only a holder of the switch makes it. The right comes before any check of the other folders,
      // so a person without it learns nothing about a Contract folder that exists.
      if (preset === 'contract') assertCan(ctx, 'folder.locked');
    }
    const folders = project.folders ?? [];
    if (folders.length >= MAX_FOLDERS) throw invalid('name', `A project holds up to ${MAX_FOLDERS} folders.`, 'folder_limit');
    if (preset && foldersFor(ctx.state, ctx.authority, folders).some((item) => item.preset === preset)) {
      throw invalid('preset', 'This project has this standard folder already.', 'folder_preset_taken');
    }
    const name = preset ? FOLDER_PRESET_NAMES[preset] : input.name!;
    assertNameFree(ctx, project, stageId, name);
    const folder: ProjectFolder = {
      id: nextId(ctx.state, 'fld'), stageId, name, createdBy: ctx.actor.id, createdAt: ctx.stamp,
      ...(preset ? { preset } : {}), ...(preset === 'contract' ? { locked: true } : {}),
    };
    saveFolders(ctx, project, [...folders, folder]);
    return folder;
  },
});

export const foldersRename = defineCall({
  input: z.object({ id: FolderId, name: FolderName }),
  output: ProjectFolder,
  run(input, ctx) {
    const { project, folder } = requireFolder(ctx, input.id);
    assertMayOrganize(ctx, project);
    if (folder.name === input.name) return folder;
    assertNameFree(ctx, project, folder.stageId ?? null, input.name, folder.id);
    // A rename ends the standard name: the folder keeps the new name in every language.
    const { preset: _preset, ...rest } = folder;
    const next: ProjectFolder = { ...rest, name: input.name };
    saveFolders(ctx, project, (project.folders ?? []).map((item) => (item.id === folder.id ? next : item)));
    return next;
  },
});

export const foldersSetLock = defineCall({
  input: z.object({ id: FolderId, locked: z.boolean() }),
  output: ProjectFolder,
  run(input, ctx) {
    const { project, folder } = requireFolder(ctx, input.id);
    // A folder that the person sees is not locked, or the person holds the switch. The switch comes first, then the upload right of the project.
    assertCan(ctx, 'folder.locked');
    assertMayOrganize(ctx, project);
    if ((folder.locked === true) === input.locked) return folder;
    if (input.locked) {
      const inside = Object.values(ctx.state.files).filter((file) => file.projectId === project.id && file.folderId === folder.id);
      if (inside.some((file) => file.taskId)) throw invalid('id', 'A folder that holds a file of a to-do cannot be locked.', 'folder_lock_task_file');
      if (inside.some((file) => file.id === project.coverFileId)) throw invalid('id', 'A folder that holds the cover of the project cannot be locked.', 'folder_lock_cover');
    }
    const { locked: _locked, ...rest } = folder;
    const next: ProjectFolder = input.locked ? { ...rest, locked: true } : rest;
    saveFolders(ctx, project, (project.folders ?? []).map((item) => (item.id === folder.id ? next : item)));
    return next;
  },
});

export const foldersDelete = defineCall({
  input: z.object({ id: FolderId }),
  output: z.object({ deleted: z.literal(true) }),
  run(input, ctx) {
    const { project, folder } = requireFolder(ctx, input.id);
    assertMayOrganize(ctx, project);
    const inside = Object.values(ctx.state.files).filter((file) => file.projectId === project.id && file.folderId === folder.id);
    // The files of a deleted folder go back to the root, where everyone sees them. So a locked folder with files is not deleted: the person
    // moves the files out, or unlocks the folder, on purpose.
    if (folder.locked === true && inside.length > 0) throw invalid('id', 'Move the files out of a locked folder first, or unlock it.', 'folder_locked_has_files');
    // No file is deleted: each file goes back to the root of its place (its stage, or no stage). The file changes come first and the folder list
    // last, so one Undo of the story brings the folder back before it puts the files in it again.
    for (const file of inside) {
      applyPatch(ctx, file, { folderId: null }, { projectId: project.id, verb: 'file.moved', targetType: 'file', targetId: file.id });
    }
    saveFolders(ctx, project, (project.folders ?? []).filter((item) => item.id !== folder.id));
    return { deleted: true as const };
  },
});

export const folderCalls = {
  'folders.create': foldersCreate,
  'folders.rename': foldersRename,
  'folders.setLock': foldersSetLock,
  'folders.delete': foldersDelete,
};
