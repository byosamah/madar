import { z } from 'zod';
import { defineCall, type Ctx } from '../registry';
import { FOLDER_NAME_MAX, FolderId, MAX_FOLDERS, ProjectFolder, ProjectId, StageId, type Project } from '../contract/entities';
import { invalid, notFound } from '../errors';
import { applyPatch } from '../events';
import { nextId } from '../store';
import { assertCan, requireProject, requireStage, roleIn, seesProject } from './shared';

/** The folder name as the folders compare it: trimmed, and with no difference of capital letters. */
const nameKey = (name: string): string => name.trim().toLowerCase();

const FolderName = z.string().trim().min(1).max(FOLDER_NAME_MAX);

/**
 * A folder by id with the project that holds it (fbk_066). A folder of a project that the person does not see reads as a missing folder:
 * the same code, text and details as an unknown id, so no call tells that a hidden folder exists.
 */
export function requireFolder(ctx: Ctx, id: string): { project: Project; folder: ProjectFolder } {
  for (const project of Object.values(ctx.state.projects)) {
    const folder = project.folders?.find((item) => item.id === id);
    if (folder && seesProject(ctx, project.id)) return { project, folder };
  }
  throw notFound('Folder', id);
}

/** The person may change folders and move files where the upload is allowed (the same gate as the upload, fbk_066). */
function assertMayOrganize(ctx: Ctx, project: Project): void {
  assertCan(ctx, 'file.upload', { projectRole: roleIn(ctx, project.id) });
}

/**
 * The place of a file in a project: a stage of the project (or none) and a folder of that stage (or none). A folder sits in one real stage, so
 * a folder with another stage, or with "No stage", is refused (reason folder_other_stage).
 */
export function checkPlace(ctx: Ctx, project: Project, stageId: string | null, folderId: string | null): void {
  if (stageId) requireStage(ctx, project.id, stageId);
  if (folderId === null) return;
  const folder = project.folders?.find((item) => item.id === folderId);
  if (!folder) throw invalid('folderId', 'This folder is not in the project.', 'folder_missing');
  if (folder.stageId !== stageId) throw invalid('folderId', 'This folder is in another stage.', 'folder_other_stage');
}

/** Organizing is no news: the change leaves the "last update" of the project as it is (no touch). */
function saveFolders(ctx: Ctx, project: Project, folders: ProjectFolder[]): void {
  applyPatch(ctx, project, { folders }, { projectId: project.id, verb: 'project.folders_changed', targetType: 'project', targetId: project.id });
}

function assertNameFree(project: Project, stageId: string, name: string, exceptId?: string): void {
  const taken = (project.folders ?? []).some((item) => item.stageId === stageId && item.id !== exceptId && nameKey(item.name) === nameKey(name));
  if (taken) throw invalid('name', 'This stage has a folder with this name.', 'folder_name_taken');
}

export const foldersCreate = defineCall({
  input: z.object({ projectId: ProjectId, stageId: StageId, name: FolderName }),
  output: ProjectFolder,
  run(input, ctx) {
    const project = requireProject(ctx, input.projectId);
    assertMayOrganize(ctx, project);
    requireStage(ctx, project.id, input.stageId);
    const folders = project.folders ?? [];
    if (folders.length >= MAX_FOLDERS) throw invalid('name', `A project holds up to ${MAX_FOLDERS} folders.`, 'folder_limit');
    assertNameFree(project, input.stageId, input.name);
    const folder: ProjectFolder = { id: nextId(ctx.state, 'fld'), stageId: input.stageId, name: input.name, createdBy: ctx.actor.id, createdAt: ctx.stamp };
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
    assertNameFree(project, folder.stageId, input.name, folder.id);
    const next: ProjectFolder = { ...folder, name: input.name };
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
    // No file is deleted: each file goes back to the root of its stage. The file changes come first and the folder list last, so one Undo of the story
    // brings the folder back before it puts the files in it again.
    for (const file of Object.values(ctx.state.files)) {
      if (file.projectId !== project.id || file.folderId !== folder.id) continue;
      applyPatch(ctx, file, { folderId: null }, { projectId: project.id, verb: 'file.moved', targetType: 'file', targetId: file.id });
    }
    saveFolders(ctx, project, (project.folders ?? []).filter((item) => item.id !== folder.id));
    return { deleted: true as const };
  },
});

export const folderCalls = {
  'folders.create': foldersCreate,
  'folders.rename': foldersRename,
  'folders.delete': foldersDelete,
};
