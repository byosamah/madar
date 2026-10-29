import { FOLDER_PRESET_NAMES, type ProjectFolder } from '../api/contract/entities';
import { nextId, type State } from '../api/store';

/**
 * The two standard folders of the sample client projects (fbk_074, owner 2026-10-29): Client documents, and Contract, which is locked. A new project
 * gets them from projects.create; the sample office had its projects before that, so the prototype adds them on its first start and on "Reset sample
 * data" (bootstrap.ts, sampleOffice.ts). buildSeed does not add them: the screen tests count the folders of the plain sample office. A saved office
 * keeps what it had (no STATE_VERSION step). An internal project has none. One sample file of the first project that has files sits in each of the
 * two folders, so the prototype shows a folder with a file in it and a locked folder at the first look.
 */
export function addSampleFolders(state: State): void {
  for (const project of Object.values(state.projects)) {
    if (project.kind === 'internal' || (project.folders ?? []).length > 0) continue;
    const made = (['client_documents', 'contract'] as const).map((preset): ProjectFolder => ({
      id: nextId(state, 'fld'), stageId: null, name: FOLDER_PRESET_NAMES[preset], createdBy: project.leaderId ?? project.createdBy, createdAt: project.createdAt, preset,
      ...(preset === 'contract' ? { locked: true } : {}),
    }));
    project.folders = made;
  }
  const usable = (project: State['projects'][string]) => Object.values(state.files).filter((file) => file.projectId === project.id && !file.taskId && file.id !== project.coverFileId);
  const first = Object.values(state.projects).find((project) => project.folders?.some((folder) => folder.preset === 'client_documents')
    && project.folders.some((folder) => folder.preset === 'contract') && usable(project).length >= 2);
  if (!first) return;
  const targets = [first.folders!.find((folder) => folder.preset === 'client_documents')!, first.folders!.find((folder) => folder.preset === 'contract')!];
  usable(first).slice(0, 2).forEach((file, at) => {
    state.files[file.id] = { ...file, stageId: null, folderId: targets[at].id };
  });
}
