import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeStage, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Folders of the Files & Links tab (fbk_066, owner 2026-10-26). prj_001 is led by Faisal (usr_002) with Sara (usr_003) on the team. Omar (usr_004)
 * is outside the team and cannot upload. The stages are stg_001 (Concept) and stg_002 (Schematic Design).
 */
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

async function world() {
  const t = testApi(calls);
  t.as('usr_003');
  const a = await t.api.call('files.upload', { projectId: 'prj_001', name: 'Mood A.pdf', blob: pdf('a'), stageId: 'stg_001' });
  const b = await t.api.call('files.upload', { projectId: 'prj_001', name: 'Sketch B.pdf', blob: pdf('b'), stageId: 'stg_002' });
  return { t, a: a.file.id, b: b.file.id };
}

describe('folders.create', () => {
  it('makes a folder in a real stage and trims the name', async () => {
    const { t } = await world();
    const folder = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: '  Mood boarding ' });
    expect(folder).toMatchObject({ id: 'fld_001', stageId: 'stg_001', name: 'Mood boarding', createdBy: 'usr_003' });
    expect(t.store.state.projects.prj_001.folders).toEqual([folder]);
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'project.folders_changed');
    expect(event).toMatchObject({ projectId: 'prj_001', targetType: 'project', targetId: 'prj_001' });
  });

  it('puts the folders on the project detail and keeps them out of a list row', async () => {
    const { t } = await world();
    await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.folders.map((f) => f.name)).toEqual(['Mood boarding']);
    expect(detail.project.folders).toBeUndefined();
    const rows = await t.api.call('projects.list', {});
    expect(JSON.stringify(rows)).not.toContain('Mood boarding');
  });

  it('refuses an empty name, a name over 60 letters, and a stage of another project', async () => {
    const { t } = await world();
    await expect(t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: '   ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'x'.repeat(61) })).rejects.toMatchObject({ code: 'invalid_input' });
    t.store.state.stages.stg_009 = makeStage({ id: 'stg_009', projectId: 'prj_009', name: 'Other' });
    await expect(t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_009', name: 'Plans' })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['stageId'] } });
  });

  it('refuses a name that the stage already has, but accepts it in another stage', async () => {
    const { t } = await world();
    await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await expect(t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: ' mood BOARDING' })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'folder_name_taken' },
    });
    const other = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_002', name: 'Mood boarding' });
    expect(other.stageId).toBe('stg_002');
  });

  it('stops at 100 folders', async () => {
    const { t } = await world();
    t.store.state.projects.prj_001.folders = Array.from({ length: 100 }, (_, n) => ({
      id: `fld_${String(n + 1).padStart(3, '0')}`, stageId: 'stg_001', name: `F${n}`, createdBy: 'usr_003', createdAt: '2026-09-30T09:00:00.000+03:00',
    }));
    t.store.state.counters.fld = 100;
    await expect(t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_002', name: 'One more' })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'folder_limit' },
    });
  });

  it('asks the upload right, and a person outside the team has none', async () => {
    const { t } = await world();
    t.as('usr_004');
    await expect(t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Plans' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await expect(t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Plans' })).resolves.toMatchObject({ name: 'Plans' });
  });

  it('takes the folder back with one Undo', async () => {
    const { t } = await world();
    const { storyId } = await t.api.run('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await t.api.call('events.undoStory', { correlationId: storyId });
    expect(t.store.state.projects.prj_001.folders ?? []).toEqual([]);
  });
});

describe('folders.rename', () => {
  it('renames, refuses a name that the stage has, and writes nothing for the same name', async () => {
    const { t } = await world();
    const first = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'First sketching' });
    const renamed = await t.api.call('folders.rename', { id: first.id, name: ' Mood board ' });
    expect(renamed.name).toBe('Mood board');
    await expect(t.api.call('folders.rename', { id: first.id, name: 'first SKETCHING' })).rejects.toMatchObject({ details: { reason: 'folder_name_taken' } });
    const events = Object.keys(t.store.state.events).length;
    await t.api.call('folders.rename', { id: first.id, name: 'Mood board' });
    expect(Object.keys(t.store.state.events)).toHaveLength(events);
  });

  it('answers not_found for an unknown folder, and forbidden without the upload right', async () => {
    const { t } = await world();
    const folder = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await expect(t.api.call('folders.rename', { id: 'fld_099', name: 'X' })).rejects.toMatchObject({ code: 'not_found' });
    t.as('usr_004');
    await expect(t.api.call('folders.rename', { id: folder.id, name: 'Other' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is taken back with one Undo', async () => {
    const { t } = await world();
    const folder = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    const { storyId } = await t.api.run('folders.rename', { id: folder.id, name: 'Moods' });
    await t.api.call('events.undoStory', { correlationId: storyId });
    expect(t.store.state.projects.prj_001.folders?.[0].name).toBe('Mood boarding');
  });
});

describe('files.move', () => {
  it('moves a file into a folder of its stage, and then to another stage and folder', async () => {
    const { t, a } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    const sketch = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_002', name: 'First sketching' });
    const into = await t.api.call('files.move', { id: a, stageId: 'stg_001', folderId: mood.id });
    expect(into.file).toMatchObject({ stageId: 'stg_001', folderId: mood.id });
    const across = await t.api.call('files.move', { id: a, stageId: 'stg_002', folderId: sketch.id });
    expect(across.file).toMatchObject({ stageId: 'stg_002', folderId: sketch.id });
    const out = await t.api.call('files.move', { id: a, stageId: null, folderId: null });
    expect(out.file).toMatchObject({ stageId: null, folderId: null });
  });

  it('moves a file out of "No stage" and keeps the task of the file', async () => {
    const { t } = await world();
    t.store.state.tasks.tsk_001 = { id: 'tsk_001', projectId: 'prj_001', stageId: 'stg_002', title: 'T', description: '', ownerId: 'usr_003', status: 'todo', dueDate: null, flagged: false, needsReview: true, checklist: [], createdBy: 'usr_002' } as never;
    const up = await t.api.call('files.upload', { projectId: 'prj_001', name: 'Loose.pdf', blob: pdf('l'), taskId: 'tsk_001' });
    expect(up.file.stageId).toBeNull();
    const moved = await t.api.call('files.move', { id: up.file.id, stageId: 'stg_001', folderId: null });
    expect(moved.file).toMatchObject({ stageId: 'stg_001', taskId: 'tsk_001' });
  });

  it('refuses a folder that is not in the stage, a folder with no stage, and an unknown folder', async () => {
    const { t, a } = await world();
    const sketch = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_002', name: 'First sketching' });
    await expect(t.api.call('files.move', { id: a, stageId: 'stg_001', folderId: sketch.id })).rejects.toMatchObject({ details: { reason: 'folder_other_stage' } });
    await expect(t.api.call('files.move', { id: a, stageId: null, folderId: sketch.id })).rejects.toMatchObject({ details: { reason: 'folder_other_stage' } });
    await expect(t.api.call('files.move', { id: a, stageId: 'stg_001', folderId: 'fld_099' })).rejects.toMatchObject({ details: { reason: 'folder_missing' } });
  });

  it('refuses a stage of another project, and a person without the upload right', async () => {
    const { t, a } = await world();
    t.store.state.stages.stg_009 = makeStage({ id: 'stg_009', projectId: 'prj_009', name: 'Other' });
    await expect(t.api.call('files.move', { id: a, stageId: 'stg_009', folderId: null })).rejects.toMatchObject({ code: 'invalid_input', details: { fields: ['stageId'] } });
    t.as('usr_004');
    await expect(t.api.call('files.move', { id: a, stageId: 'stg_002', folderId: null })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a file of a chat, and answers not_found for an unknown file', async () => {
    const { t } = await world();
    t.store.state.files.fil_800 = {
      id: 'fil_800', projectId: null, stageId: null, taskId: null, conversationId: 'cnv_001', name: 'chat.pdf',
      versions: [{ letter: 'A', blobKey: 'b', mimeType: 'application/pdf', size: 1, uploadedBy: 'usr_003', uploadedAt: '2026-09-30T09:00:00.000+03:00' }],
    };
    await expect(t.api.call('files.move', { id: 'fil_800', stageId: 'stg_001', folderId: null })).rejects.toBeDefined();
    await expect(t.api.call('files.move', { id: 'fil_099', stageId: 'stg_001', folderId: null })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('writes nothing when the file already sits there', async () => {
    const { t, a } = await world();
    const before = Object.keys(t.store.state.events).length;
    const result = await t.api.run('files.move', { id: a, stageId: 'stg_001', folderId: null });
    expect(result.changed).toBe(false);
    expect(Object.keys(t.store.state.events)).toHaveLength(before);
  });

  it('is taken back with one Undo, stage and folder together', async () => {
    const { t, a } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await t.api.call('files.move', { id: a, stageId: 'stg_001', folderId: mood.id });
    const { storyId } = await t.api.run('files.move', { id: a, stageId: 'stg_002', folderId: null });
    await t.api.call('events.undoStory', { correlationId: storyId });
    expect(t.store.state.files[a]).toMatchObject({ stageId: 'stg_001', folderId: mood.id });
  });
});

describe('folders.delete', () => {
  it('sends the files back to the root of the stage and deletes no file', async () => {
    const { t, a } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await t.api.call('files.move', { id: a, stageId: 'stg_001', folderId: mood.id });
    await expect(t.api.call('folders.delete', { id: mood.id })).resolves.toEqual({ deleted: true });
    expect(t.store.state.projects.prj_001.folders ?? []).toEqual([]);
    expect(t.store.state.files[a]).toMatchObject({ stageId: 'stg_001', folderId: null });
    expect(await t.api.call('files.list', { projectId: 'prj_001' })).toHaveLength(2);
  });

  it('brings back the folder and the folder of its files with one Undo', async () => {
    const { t, a } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await t.api.call('files.move', { id: a, stageId: 'stg_001', folderId: mood.id });
    const { storyId } = await t.api.run('folders.delete', { id: mood.id });
    await t.api.call('events.undoStory', { correlationId: storyId });
    expect(t.store.state.projects.prj_001.folders).toEqual([mood]);
    expect(t.store.state.files[a]).toMatchObject({ stageId: 'stg_001', folderId: mood.id });
  });

  it('asks the upload right', async () => {
    const { t } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    t.as('usr_004');
    await expect(t.api.call('folders.delete', { id: mood.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('files.upload into a folder', () => {
  it('puts a new file into the folder and its stage', async () => {
    const { t } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    const view = await t.api.call('files.upload', { projectId: 'prj_001', name: 'Board.pdf', blob: pdf('x'), folderId: mood.id });
    expect(view.file).toMatchObject({ stageId: 'stg_001', folderId: mood.id });
  });

  it('refuses a stage that differs from the stage of the folder, and an unknown folder', async () => {
    const { t } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'Board.pdf', blob: pdf('x'), stageId: 'stg_002', folderId: mood.id })).rejects.toMatchObject({ details: { reason: 'folder_other_stage' } });
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'Board.pdf', blob: pdf('x'), folderId: 'fld_099' })).rejects.toMatchObject({ details: { reason: 'folder_missing' } });
  });
});

describe('a removed stage', () => {
  it('drops its folders and sends their files to No stage, as it does for the files of the stage', async () => {
    const { t, a } = await world();
    const mood = await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_001', name: 'Mood boarding' });
    await t.api.call('files.move', { id: a, stageId: 'stg_001', folderId: mood.id });
    await t.api.call('folders.create', { projectId: 'prj_001', stageId: 'stg_002', name: 'Keep me' });
    t.as('usr_002');
    await t.api.call('stages.replace', { projectId: 'prj_001', stages: [{ id: 'stg_002', name: 'Schematic Design', startDate: null, endDate: null }] });
    expect(t.store.state.projects.prj_001.folders?.map((f) => f.name)).toEqual(['Keep me']);
    expect(t.store.state.files[a]).toMatchObject({ stageId: null, folderId: null });
  });
});
