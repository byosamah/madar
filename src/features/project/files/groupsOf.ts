import type { ProjectFolder } from '../../../api/contract/entities';
import type { FileView, ProjectDetail } from '../../../api/contract/views';
import { foldersOf } from './fileDragSlots';

/** One folder of a stage group with its files, in the order the folder was made. */
export type FolderData = { folder: ProjectFolder; files: FileView[] };
/** One group of the list: a stage (or "No stage") with the files that sit at its root, and its folders. `total` counts all of its files. */
export type GroupData = { stageId: string | null; name: string; loose: FileView[]; folders: FolderData[]; total: number };

/** True for a group with a file or a folder. A group with nothing in it shows only for a person who may upload. */
export const hasContent = (group: GroupData): boolean => group.total > 0 || group.folders.length > 0;

/** The folders of the whole project (no stage), with their files, in the order the folders were made (fbk_074). */
export function projectFoldersOf(detail: ProjectDetail, views: FileView[]): FolderData[] {
  return foldersOf(detail)
    .filter((folder) => folder.stageId === null)
    .map((folder) => ({ folder, files: views.filter((view) => view.file.folderId === folder.id) }));
}

/**
 * The groups of the list (fbk_066). A file sits in a folder only when that folder is in the place of the file: any other folderId reads as the
 * root of the stage, so no file is hidden. A file in a folder of the whole project (fbk_074) has no stage, and it counts for that folder, not for
 * "No stage". A group shows when it has files or folders. A person who may upload also sees the stages with nothing, because "+ Folder" sits in the
 * heading row of its stage. "No stage" shows only with files.
 */
export function groupsOf(detail: ProjectDetail, views: FileView[], showEmptyStages: boolean, noStageName: string): GroupData[] {
  const stages = detail.stages.map((stage) => ({ stageId: stage.id as string | null, name: stage.name }));
  const projectFolderIds = new Set(foldersOf(detail).filter((folder) => folder.stageId === null).map((folder) => folder.id));
  return [...stages, { stageId: null, name: noStageName }]
    .map(({ stageId, name }) => {
      const mine = views.filter((view) => view.file.stageId === stageId && !(stageId === null && view.file.folderId && projectFolderIds.has(view.file.folderId)));
      const folders = stageId === null ? [] : foldersOf(detail).filter((folder) => folder.stageId === stageId);
      const inFolder = (view: FileView, folder: ProjectFolder) => view.file.folderId === folder.id;
      return {
        stageId,
        name,
        loose: mine.filter((view) => !folders.some((folder) => inFolder(view, folder))),
        folders: folders.map((folder) => ({ folder, files: mine.filter((view) => inFolder(view, folder)) })),
        total: mine.length,
      };
    })
    .filter((group) => hasContent(group) || (showEmptyStages && group.stageId !== null));
}
