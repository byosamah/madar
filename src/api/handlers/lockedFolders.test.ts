import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { RoleSettings } from '../contract/entities';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * Folders for the whole project, the two standard folders and locked folders (fbk_074, owner 2026-10-29). The project "Villa Noor" is made by
 * Faisal (usr_002, the leader) with Sara (usr_003) and Lina (usr_006) on the team. The Admin (usr_001) holds the switch "Locked folders". Lina
 * holds it through a custom role. Usr_008 is the agent of Sara, usr_009 the agent of Lina. Omar (usr_004) is outside the team.
 */
const ADMIN = 'usr_001';
const LEADER = 'usr_002';
const SARA = 'usr_003';
const OMAR = 'usr_004';
const LINA = 'usr_006';
const AGENT_OF_SARA = 'usr_008';
const AGENT_OF_LINA = 'usr_009';
const ROLES: RoleSettings = { custom: [{ id: 'rol_001', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] }] };
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = ROLES;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Keeper', roleId: 'rol_001' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Sara Assistant', kind: 'agent', discipline: 'Agent', ownerId: SARA });
  state.users.usr_009 = makeUser('usr_009', { name: 'Lina Assistant', kind: 'agent', discipline: 'Agent', ownerId: LINA });
  state.counters.usr = 9;
  t.as(LEADER);
  const made = await t.api.call('projects.create', { name: 'Villa Noor', teamIds: [SARA, LINA] });
  const project = made.project.id;
  const stages = Object.values(state.stages).filter((stage) => stage.projectId === project).map((stage) => stage.id);
  const folders = state.projects[project].folders!;
  const documents = folders.find((folder) => folder.preset === 'client_documents')!.id;
  const contract = folders.find((folder) => folder.preset === 'contract')!.id;
  t.as(ADMIN);
  const upload = await t.api.call('files.upload', { projectId: project, name: 'contract.pdf', blob: pdf('c'), folderId: contract });
  return { t, project, stages, documents, contract, file: upload.file.id };
}
type World = Awaited<ReturnType<typeof world>>;
const as = async <T>(w: World, userId: string, run: () => Promise<T>): Promise<T> => {
  w.t.as(userId);
  return run();
};

describe('the two standard folders of a new project', () => {
  it('start for the whole project: Client documents is open and Contract is locked', async () => {
    const w = await world();
    const folders = w.t.store.state.projects[w.project].folders!;
    expect(folders).toHaveLength(2);
    expect(folders[0]).toMatchObject({ stageId: null, name: 'Client documents', preset: 'client_documents' });
    expect(folders[0].locked).toBeUndefined();
    expect(folders[1]).toMatchObject({ stageId: null, name: 'Contract', preset: 'contract', locked: true });
  });

  it('are not made for an internal project, which has no client and no contract', async () => {
    const w = await world();
    w.t.as(LEADER);
    const internal = await w.t.api.call('projects.create', { name: 'Portfolio', kind: 'internal', teamIds: [] });
    expect(w.t.store.state.projects[internal.project.id].folders).toBeUndefined();
  });

  it('keep the English name in the record, and a rename ends the preset', async () => {
    const w = await world();
    w.t.as(SARA);
    const same = await w.t.api.call('folders.rename', { id: w.documents, name: 'Client documents' });
    expect(same.preset).toBe('client_documents');
    const renamed = await w.t.api.call('folders.rename', { id: w.documents, name: 'From the client' });
    expect(renamed).toMatchObject({ name: 'From the client' });
    expect(renamed.preset).toBeUndefined();
  });

  it('can be added to an older project once: the preset call refuses a second folder with the same preset', async () => {
    const w = await world();
    w.t.as(ADMIN);
    delete w.t.store.state.projects[w.project].folders;
    const documents = await w.t.api.call('folders.create', { projectId: w.project, preset: 'client_documents' });
    const contract = await w.t.api.call('folders.create', { projectId: w.project, preset: 'contract' });
    expect(documents).toMatchObject({ stageId: null, name: 'Client documents', preset: 'client_documents' });
    expect(contract).toMatchObject({ name: 'Contract', preset: 'contract', locked: true });
    for (const preset of ['client_documents', 'contract'] as const) {
      await expect(w.t.api.call('folders.create', { projectId: w.project, preset })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'folder_preset_taken' } });
    }
    await expect(w.t.api.call('folders.create', { projectId: w.project, preset: 'contract', name: 'Other' })).rejects.toMatchObject({ details: { reason: 'folder_preset_name' } });
    await expect(w.t.api.call('folders.create', { projectId: w.project, stageId: w.stages[0], preset: 'contract' })).rejects.toMatchObject({ details: { reason: 'folder_preset_stage' } });
  });

  it('need the switch for the Contract preset, and tell a person without it nothing about an existing Contract folder', async () => {
    const w = await world();
    w.t.as(SARA);
    await expect(w.t.api.call('folders.create', { projectId: w.project, preset: 'contract' })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
    delete w.t.store.state.projects[w.project].folders;
    await expect(w.t.api.call('folders.create', { projectId: w.project, preset: 'contract' })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
  });
});

describe('a folder for the whole project', () => {
  it('is made with stageId null or no stageId, and a stage folder still works with the old input', async () => {
    const w = await world();
    w.t.as(SARA);
    const none = await w.t.api.call('folders.create', { projectId: w.project, name: 'Site photos' });
    const nullStage = await w.t.api.call('folders.create', { projectId: w.project, stageId: null, name: 'Reports' });
    const inStage = await w.t.api.call('folders.create', { projectId: w.project, stageId: w.stages[0], name: 'Mood' });
    expect([none.stageId, nullStage.stageId, inStage.stageId]).toEqual([null, null, w.stages[0]]);
  });

  it('keeps a name once in the whole project, and the same name in a stage is another place', async () => {
    const w = await world();
    w.t.as(SARA);
    await w.t.api.call('folders.create', { projectId: w.project, name: 'Site photos' });
    await expect(w.t.api.call('folders.create', { projectId: w.project, name: 'site PHOTOS' })).rejects.toMatchObject({ details: { reason: 'folder_name_taken' } });
    await expect(w.t.api.call('folders.create', { projectId: w.project, stageId: w.stages[0], name: 'Site photos' })).resolves.toMatchObject({ stageId: w.stages[0] });
    await expect(w.t.api.call('folders.create', { projectId: w.project, name: 'Client documents' })).rejects.toMatchObject({ details: { reason: 'folder_name_taken' } });
  });

  it('takes a file with no stage, and refuses a stage that is not the place of the folder', async () => {
    const w = await world();
    w.t.as(SARA);
    const folder = await w.t.api.call('folders.create', { projectId: w.project, name: 'Site photos' });
    const upload = await w.t.api.call('files.upload', { projectId: w.project, name: 'a.pdf', blob: pdf('a'), folderId: folder.id });
    expect(upload.file).toMatchObject({ stageId: null, folderId: folder.id });
    await expect(w.t.api.call('files.upload', { projectId: w.project, name: 'b.pdf', blob: pdf('b'), folderId: folder.id, stageId: w.stages[0] })).rejects.toMatchObject({ details: { reason: 'folder_other_stage' } });
    const staged = await w.t.api.call('files.upload', { projectId: w.project, name: 'c.pdf', blob: pdf('c'), stageId: w.stages[0] });
    const moved = await w.t.api.call('files.move', { id: staged.file.id, stageId: null, folderId: folder.id });
    expect(moved.file).toMatchObject({ stageId: null, folderId: folder.id });
    await expect(w.t.api.call('files.move', { id: staged.file.id, stageId: w.stages[0], folderId: folder.id })).rejects.toMatchObject({ details: { reason: 'folder_other_stage' } });
  });

  it('stays when a stage is removed, and so does a locked stage folder, as a folder of the whole project with its files', async () => {
    const w = await world();
    w.t.as(ADMIN);
    const open = await w.t.api.call('folders.create', { projectId: w.project, stageId: w.stages[1], name: 'Stage mood' });
    const secret = await w.t.api.call('folders.create', { projectId: w.project, stageId: w.stages[1], name: 'Contract' });
    const inside = await w.t.api.call('files.upload', { projectId: w.project, name: 'inside.pdf', blob: pdf('i'), folderId: secret.id });
    await w.t.api.call('folders.setLock', { id: secret.id, locked: true });
    const stages = w.stages.filter((id) => id !== w.stages[1]).map((id) => ({ id, name: w.t.store.state.stages[id].name }));
    await w.t.api.call('stages.replace', { projectId: w.project, stages });
    const folders = w.t.store.state.projects[w.project].folders!;
    expect(folders.find((folder) => folder.id === open.id)).toBeUndefined();
    expect(folders.find((folder) => folder.id === w.contract)).toBeDefined();
    // The locked folder of the removed stage joins the whole project. "Contract" is taken there, so it takes a number.
    expect(folders.find((folder) => folder.id === secret.id)).toMatchObject({ stageId: null, name: 'Contract (2)', locked: true });
    expect(w.t.store.state.files[inside.file.id]).toMatchObject({ stageId: null, folderId: secret.id });
    // A person without the switch still sees none of it.
    w.t.as(SARA);
    const list = await w.t.api.call('files.list', { projectId: w.project });
    expect(list.map((view) => view.file.name)).not.toContain('inside.pdf');
  });
});

describe('a file of the same name', () => {
  it('stays in its place: an upload into a locked folder never adds a version to an open file, and the other way round', async () => {
    const w = await world();
    w.t.as(ADMIN);
    const open = await w.t.api.call('files.upload', { projectId: w.project, name: 'plan.pdf', blob: pdf('1') });
    const locked = await w.t.api.call('files.upload', { projectId: w.project, name: 'plan.pdf', blob: pdf('2'), folderId: w.contract });
    expect(locked.file.id).not.toBe(open.file.id);
    expect(locked.file).toMatchObject({ folderId: w.contract });
    expect(w.t.store.state.files[open.file.id].versions).toHaveLength(1);
    // The same name outside the folder is a new file again, and a second upload into the folder adds a version to the locked one.
    const outside = await w.t.api.call('files.upload', { projectId: w.project, name: 'plan.pdf', blob: pdf('3') });
    expect(outside.file.id).toBe(open.file.id);
    const again = await w.t.api.call('files.upload', { projectId: w.project, name: 'plan.pdf', blob: pdf('4'), folderId: w.contract });
    expect(again.file.id).toBe(locked.file.id);
    expect(again.file.versions).toHaveLength(2);
  });
});

describe('the switch "Locked folders"', () => {
  it('lets the Admin and a holder lock and unlock any folder, and nobody else', async () => {
    const w = await world();
    for (const holder of [ADMIN, LINA, AGENT_OF_LINA]) {
      const locked = await as(w, holder, () => w.t.api.call('folders.setLock', { id: w.documents, locked: true }));
      expect(locked.locked).toBe(true);
      const open = await as(w, holder, () => w.t.api.call('folders.setLock', { id: w.documents, locked: false }));
      expect(open.locked).toBeUndefined();
    }
    for (const person of [LEADER, SARA, OMAR, AGENT_OF_SARA]) {
      await expect(as(w, person, () => w.t.api.call('folders.setLock', { id: w.documents, locked: true })), person).rejects.toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
    }
  });

  it('needs the upload right of the project too', async () => {
    const w = await world();
    // Omar holds the switch but is not on the team of the project, so he may not organize its folders.
    w.t.store.state.users.usr_004 = { ...w.t.store.state.users.usr_004, roleId: 'rol_001' };
    await expect(as(w, OMAR, () => w.t.api.call('folders.setLock', { id: w.documents, locked: true }))).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('writes a folder event that Undo takes back', async () => {
    const w = await world();
    w.t.as(ADMIN);
    await w.t.api.call('folders.setLock', { id: w.documents, locked: true });
    const event = Object.values(w.t.store.state.events).filter((e) => e.verb === 'project.folders_changed').sort((a, b) => b.seq - a.seq)[0];
    await w.t.api.call('events.undo', { eventId: event.id });
    expect(w.t.store.state.projects[w.project].folders!.find((folder) => folder.id === w.documents)!.locked).toBeUndefined();
  });

  it('refuses to lock a folder that holds a file of a to-do or the cover of the project', async () => {
    const w = await world();
    w.t.as(ADMIN);
    const folder = await w.t.api.call('folders.create', { projectId: w.project, name: 'Pictures' });
    const task = await w.t.api.call('tasks.create', { projectId: w.project, title: 'Draw', stageId: w.stages[0] });
    const upload = await w.t.api.call('files.upload', { projectId: w.project, name: 'draw.pdf', blob: pdf('d'), folderId: folder.id, taskId: task.task.id });
    await expect(w.t.api.call('folders.setLock', { id: folder.id, locked: true })).rejects.toMatchObject({ details: { reason: 'folder_lock_task_file' } });
    await w.t.api.call('files.move', { id: upload.file.id, stageId: null, folderId: null });
    const picture = await w.t.api.call('files.upload', { projectId: w.project, name: 'cover.png', blob: new Blob(['p'], { type: 'image/png' }), folderId: folder.id, asCover: true });
    expect(picture.file.id).toBeDefined();
    await expect(w.t.api.call('folders.setLock', { id: folder.id, locked: true })).rejects.toMatchObject({ details: { reason: 'folder_lock_cover' } });
  });

  it('keeps a locked folder free of to-do files, covers and Tracker lines', async () => {
    const w = await world();
    w.t.as(ADMIN);
    const task = await w.t.api.call('tasks.create', { projectId: w.project, title: 'Draw', stageId: w.stages[0] });
    const loose = await w.t.api.call('files.upload', { projectId: w.project, name: 'task.pdf', blob: pdf('t'), taskId: task.task.id });
    await expect(w.t.api.call('files.move', { id: loose.file.id, stageId: null, folderId: w.contract })).rejects.toMatchObject({ details: { reason: 'folder_locked_task_file' } });
    await expect(w.t.api.call('files.upload', { projectId: w.project, name: 'x.pdf', blob: pdf('x'), folderId: w.contract, receivedFromClient: true })).rejects.toMatchObject({ details: { reason: 'folder_locked_tracker' } });
    await expect(w.t.api.call('files.markDelivered', { id: w.file })).rejects.toMatchObject({ details: { reason: 'folder_locked_tracker' } });
    await expect(w.t.api.call('files.share', { fileId: w.file, target: { kind: 'project_chat' } })).rejects.toMatchObject({ details: { reason: 'file_locked' } });
    await expect(w.t.api.call('comments.create', { targetType: 'task', targetId: task.task.id, body: 'see it', fileIds: [w.file] })).rejects.toMatchObject({ details: { reason: 'file_locked' } });
  });

  it('does not delete a locked folder that still holds files, and does not let Undo do it', async () => {
    const w = await world();
    w.t.as(ADMIN);
    await expect(w.t.api.call('folders.delete', { id: w.contract })).rejects.toMatchObject({ details: { reason: 'folder_locked_has_files' } });
    await w.t.api.call('files.move', { id: w.file, stageId: null, folderId: null });
    await expect(w.t.api.call('folders.delete', { id: w.contract })).resolves.toEqual({ deleted: true });
  });
});
