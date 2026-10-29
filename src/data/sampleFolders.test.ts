import { describe, expect, it } from 'vitest';
import { buildSeed } from './seed';
import { addSampleFolders } from './sampleFolders';
import { addSampleInternalProject } from './sampleInternalProject';

describe('the standard folders of the sample office (fbk_074)', () => {
  it('gives every client project Client documents and a locked Contract, and an internal project none', async () => {
    const state = await buildSeed('2026-10-04', async () => undefined);
    addSampleInternalProject(state, '2026-10-04');
    expect(Object.values(state.projects).every((project) => project.folders === undefined)).toBe(true);
    addSampleFolders(state);
    for (const project of Object.values(state.projects)) {
      if (project.kind === 'internal') {
        expect(project.folders).toBeUndefined();
        continue;
      }
      expect(project.folders).toHaveLength(2);
      expect(project.folders![0]).toMatchObject({ stageId: null, name: 'Client documents', preset: 'client_documents' });
      expect(project.folders![1]).toMatchObject({ stageId: null, name: 'Contract', preset: 'contract', locked: true });
    }
    const ids = Object.values(state.projects).flatMap((project) => (project.folders ?? []).map((folder) => folder.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts one sample file in each of the two folders of the first project that has files, and none that a to-do or the cover uses', async () => {
    const state = await buildSeed('2026-10-04', async () => undefined);
    addSampleFolders(state);
    const placed = Object.values(state.files).filter((file) => file.folderId);
    expect(placed).toHaveLength(2);
    const project = state.projects[placed[0].projectId!];
    expect(placed.map((file) => file.folderId)).toEqual(project.folders!.map((folder) => folder.id));
    for (const file of placed) {
      expect(file).toMatchObject({ stageId: null, taskId: null });
      expect(file.id).not.toBe(project.coverFileId);
    }
  });

  it('adds nothing to a project that has folders already', async () => {
    const state = await buildSeed('2026-10-04', async () => undefined);
    const project = Object.values(state.projects)[0];
    project.folders = [{ id: 'fld_900', stageId: null, name: 'Mine', createdBy: project.createdBy, createdAt: project.createdAt }];
    addSampleFolders(state);
    expect(project.folders.map((folder) => folder.name)).toEqual(['Mine']);
  });
});
