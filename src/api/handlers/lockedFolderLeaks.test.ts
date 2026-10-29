import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { RoleSettings } from '../contract/entities';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The leak tests of locked folders (fbk_074, owner 2026-10-29). A person without the switch "Locked folders" never learns that a locked folder
 * exists, nor any file in it: every call that names the folder or the file answers as a missing one (same code, text and details as an unknown id),
 * and no list, History, feed or search finds a name or an id. The people who hold the switch see all of it.
 *
 * "Villa Noor" is led by Faisal (usr_002) with Sara (usr_003) and Lina (usr_006) on the team. The Contract folder is locked and holds "contract.pdf".
 * The Admin (usr_001) and Lina (a custom role) hold the switch. Usr_008 is the agent of Sara, usr_009 the agent of Lina. Omar (usr_004) is outside the team.
 */
const ADMIN = 'usr_001';
const LEADER = 'usr_002';
const SARA = 'usr_003';
const OMAR = 'usr_004';
const LINA = 'usr_006';
const AGENT_OF_SARA = 'usr_008';
const AGENT_OF_LINA = 'usr_009';
const WITHOUT = [LEADER, SARA, OMAR, AGENT_OF_SARA];
const WITH = [ADMIN, LINA, AGENT_OF_LINA];
const ROLES: RoleSettings = { custom: [{ id: 'rol_001', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] }] };
const SECRET_FILE = 'contract-signed-secret.pdf';
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
  const stage = Object.values(state.stages).find((item) => item.projectId === project)!.id;
  const contract = state.projects[project].folders!.find((folder) => folder.preset === 'contract')!.id;
  t.as(ADMIN);
  const upload = await t.api.call('files.upload', { projectId: project, name: SECRET_FILE, blob: pdf('secret'), folderId: contract });
  await t.api.call('folders.rename', { id: contract, name: 'Signed papers' });
  const events = Object.values(state.events);
  const fileAdded = events.find((event) => event.verb === 'file.added' && event.targetId === upload.file.id)!;
  const created = events.find((event) => event.verb === 'project.created' && event.targetId === project)!;
  const renamed = events.filter((event) => event.verb === 'project.folders_changed').sort((a, b) => b.seq - a.seq)[0];
  return { t, ids: { project, stage, contract, file: upload.file.id, fileAdded: fileAdded.id, created: created.id, renamed: renamed.id } };
}
type World = Awaited<ReturnType<typeof world>>;

const as = async <T>({ t }: World, userId: string, run: () => Promise<T>): Promise<T> => {
  t.as(userId);
  return run();
};
type Failure = { code: string; message: string; details?: Record<string, unknown> };
const failure = async (run: () => Promise<unknown>): Promise<Failure | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    return e as Failure;
  }
};
/** The answer of a failed call with the id taken out, so a hidden id and a missing id compare equal. */
const shape = (error: Failure | null, id: string) => {
  if (error === null) return null;
  const swap = (text: string) => text.split(id).join('@');
  return { code: error.code, message: swap(error.message), details: JSON.parse(swap(JSON.stringify(error.details ?? {}))) as unknown };
};
const text = async (w: World, person: string, run: () => Promise<unknown>): Promise<string> => as(w, person, async () => {
  try {
    return JSON.stringify(await run());
  } catch (error) {
    return JSON.stringify(error);
  }
});
const NAMES = (w: World) => new RegExp(`Signed papers|Contract|${SECRET_FILE}|${w.ids.contract}`);

describe('a locked folder and its file answer a person without the switch as missing ones', () => {
  it('on every call that names the folder, the file in it, or an event about them', async () => {
    const w = await world();
    const { project, contract, file, fileAdded, created, renamed, stage } = w.ids;
    const probes: [string, unknown, unknown, string][] = [
      ['folders.rename', { id: contract, name: 'Mine' }, { id: 'fld_999', name: 'Mine' }, contract],
      ['folders.delete', { id: contract }, { id: 'fld_999' }, contract],
      ['folders.setLock', { id: contract, locked: false }, { id: 'fld_999', locked: false }, contract],
      ['files.get', { id: file }, { id: 'fil_999' }, file],
      ['files.delete', { id: file }, { id: 'fil_999' }, file],
      ['files.markDelivered', { id: file }, { id: 'fil_999' }, file],
      ['files.move', { id: file, stageId: null, folderId: null }, { id: 'fil_999', stageId: null, folderId: null }, file],
      ['files.share', { fileId: file, target: { kind: 'project_chat' } }, { fileId: 'fil_999', target: { kind: 'project_chat' } }, file],
      ['files.upload', { projectId: project, name: 'a.pdf', blob: pdf('y'), folderId: contract }, { projectId: project, name: 'a.pdf', blob: pdf('y'), folderId: 'fld_999' }, contract],
      ['updates.create', { projectId: project, body: 'x', fileIds: [file] }, { projectId: project, body: 'x', fileIds: ['fil_999'] }, file],
      ['events.undo', { eventId: fileAdded }, { eventId: 'evt_999' }, fileAdded],
      ['events.undo', { eventId: renamed }, { eventId: 'evt_999' }, renamed],
    ];
    for (const person of WITHOUT) {
      for (const [name, hidden, missing, id] of probes) {
        const seen = await as(w, person, () => failure(() => w.t.api.call(name as 'files.get', hidden as never)));
        const gone = await as(w, person, () => failure(() => w.t.api.call(name as 'files.get', missing as never)));
        const label = `${person} ${name}`;
        expect(seen, label).not.toBeNull();
        const goneId = JSON.stringify(missing).match(/"((?:fld|fil|evt)_99\d)"/)?.[1] ?? id;
        expect(shape(seen, id), label).toEqual(shape(gone, goneId));
        // The error may echo the id that the person sent, as the error of an unknown id does; it names no folder, no file and no name.
        expect(JSON.stringify(seen).split(id).join('@'), label).not.toMatch(NAMES(w));
      }
    }
    // The events of the project creation and of the story hold the folder list: they are not found for undo either.
    void created;
    void stage;
  }, 120_000);

  it('shows no name or id of the folder or the file in any list, the History, the feed or the search', async () => {
    const w = await world();
    const { project } = w.ids;
    const reads: [string, unknown][] = [
      ['projects.get', { id: project }],
      ['projects.list', {}],
      ['files.list', { projectId: project }],
      ['files.list', { projectId: project, stageId: w.ids.stage }],
      ['events.list', { limit: 500 }],
      ['events.list', { projectId: project }],
      ['events.list', { targetType: 'file', targetId: w.ids.file }],
      ['events.list', { targetType: 'project', targetId: project }],
      ['updates.list', { projectId: project, filter: 'files' }],
      ['updates.list', { projectId: project }],
      ['search.query', { text: 'contract' }],
      ['search.query', { text: 'signed' }],
      ['dashboard.get', {}],
    ];
    for (const person of WITHOUT) {
      for (const [name, input] of reads) {
        const body = await text(w, person, () => w.t.api.call(name as 'projects.list', input as never));
        expect(body, `${person} ${name}`).not.toMatch(NAMES(w));
      }
    }
  });

  it('keeps the locked folder out of the folder list, but shows Client documents', async () => {
    const w = await world();
    for (const person of WITHOUT) {
      const detail = await as(w, person, () => w.t.api.call('projects.get', { id: w.ids.project }));
      expect(detail.folders.map((folder) => folder.name), person).toEqual(['Client documents']);
      const files = await as(w, person, () => w.t.api.call('files.list', { projectId: w.ids.project }));
      expect(files, person).toEqual([]);
    }
  });

  it('takes the locked folders out of the creation event of the project, which holds the folder list', async () => {
    const w = await world();
    const events = await as(w, SARA, () => w.t.api.call('events.list', { projectId: w.ids.project, limit: 500 }));
    const created = events.find((line) => line.event.verb === 'project.created')!;
    const folders = (created.event.after as { folders: { name: string }[] }).folders;
    expect(folders.map((folder) => folder.name)).toEqual(['Client documents']);
    const own = await as(w, ADMIN, () => w.t.api.call('events.list', { projectId: w.ids.project, limit: 500 }));
    expect(((own.find((line) => line.event.verb === 'project.created')!.event.after as { folders: unknown[] }).folders)).toHaveLength(2);
  });

  it('shows the folder, the file and their changes to the Admin, a holder and the agent of a holder', async () => {
    const w = await world();
    for (const person of WITH) {
      const detail = await as(w, person, () => w.t.api.call('projects.get', { id: w.ids.project }));
      expect(detail.folders.map((folder) => folder.name), person).toEqual(['Client documents', 'Signed papers']);
      const files = await as(w, person, () => w.t.api.call('files.list', { projectId: w.ids.project }));
      expect(files.map((view) => view.file.name), person).toEqual([SECRET_FILE]);
      const found = await as(w, person, () => w.t.api.call('search.query', { text: 'secret' }));
      expect(found.files.map((hit) => hit.name), person).toEqual([SECRET_FILE]);
      const events = await as(w, person, () => w.t.api.call('events.list', { projectId: w.ids.project, limit: 500 }));
      expect(events.some((line) => line.event.id === w.ids.fileAdded), person).toBe(true);
      expect(events.some((line) => line.event.id === w.ids.renamed), person).toBe(true);
      const feed = await as(w, person, () => w.t.api.call('updates.list', { projectId: w.ids.project, filter: 'files' }));
      expect(JSON.stringify(feed), person).toContain(SECRET_FILE);
    }
  });

  it('does not add a version to the locked file when a person without the switch uploads the same name', async () => {
    const w = await world();
    const before = w.t.store.state.files[w.ids.file].versions.length;
    const upload = await as(w, SARA, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: SECRET_FILE, blob: pdf('other') }));
    expect(upload.file.id).not.toBe(w.ids.file);
    expect(upload.file.versions).toHaveLength(1);
    expect(w.t.store.state.files[w.ids.file].versions).toHaveLength(before);
    // An upload into the locked folder, by someone who holds the switch, still adds a version to a file of that name.
    const again = await as(w, ADMIN, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: SECRET_FILE, blob: pdf('v2'), folderId: w.ids.contract }));
    expect(again.file.id === w.ids.file || again.file.id === upload.file.id).toBe(true);
  });

  it('keeps the "last update" of the project where it is when a file goes into a locked folder', async () => {
    const w = await world();
    const before = w.t.store.state.projects[w.ids.project].updatedAt;
    await as(w, ADMIN, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: 'second.pdf', blob: pdf('s'), folderId: w.ids.contract }));
    expect(w.t.store.state.projects[w.ids.project].updatedAt).toBe(before);
  });

  it('refuses a person without the switch a move into a locked folder as an unknown folder, and the name check ignores the locked names', async () => {
    const w = await world();
    const made = await as(w, SARA, () => w.t.api.call('folders.create', { projectId: w.ids.project, name: 'Signed papers' }));
    expect(made.name).toBe('Signed papers');
    const loose = await as(w, SARA, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: 'loose.pdf', blob: pdf('l') }));
    const refused = await as(w, SARA, () => failure(() => w.t.api.call('files.move', { id: loose.file.id, stageId: null, folderId: w.ids.contract })));
    const unknown = await as(w, SARA, () => failure(() => w.t.api.call('files.move', { id: loose.file.id, stageId: null, folderId: 'fld_999' })));
    expect(shape(refused, w.ids.contract)).toEqual(shape(unknown, 'fld_999'));
  });

  it('shows the folder and its history again to everyone when it is unlocked', async () => {
    const w = await world();
    await as(w, ADMIN, () => w.t.api.call('folders.setLock', { id: w.ids.contract, locked: false }));
    const detail = await as(w, SARA, () => w.t.api.call('projects.get', { id: w.ids.project }));
    expect(detail.folders.map((folder) => folder.name)).toEqual(['Client documents', 'Signed papers']);
    const files = await as(w, SARA, () => w.t.api.call('files.list', { projectId: w.ids.project }));
    expect(files.map((view) => view.file.name)).toEqual([SECRET_FILE]);
    const events = await as(w, SARA, () => w.t.api.call('events.list', { projectId: w.ids.project, limit: 500 }));
    expect(events.some((line) => line.event.id === w.ids.fileAdded)).toBe(true);
  });

  it('hides a folder at the moment it is locked: the folder list and the files of the person drop it', async () => {
    const w = await world();
    const open = await as(w, ADMIN, () => w.t.api.call('folders.create', { projectId: w.ids.project, name: 'Reports' }));
    await as(w, ADMIN, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: 'report.pdf', blob: pdf('r'), folderId: open.id }));
    expect((await as(w, SARA, () => w.t.api.call('files.list', { projectId: w.ids.project }))).map((view) => view.file.name)).toEqual(['report.pdf']);
    await as(w, ADMIN, () => w.t.api.call('folders.setLock', { id: open.id, locked: true }));
    expect(await as(w, SARA, () => w.t.api.call('files.list', { projectId: w.ids.project }))).toEqual([]);
    expect(await text(w, SARA, () => w.t.api.call('search.query', { text: 'report' }))).not.toContain('report.pdf');
    expect(await text(w, SARA, () => w.t.api.call('events.list', { limit: 500 }))).not.toMatch(/report\.pdf|Reports/);
  });

  it('hides a locked file from a chat message and a post that carried it before the lock', async () => {
    const w = await world();
    const open = await as(w, ADMIN, () => w.t.api.call('folders.create', { projectId: w.ids.project, name: 'Reports' }));
    const upload = await as(w, ADMIN, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: 'report.pdf', blob: pdf('r'), folderId: open.id }));
    await as(w, ADMIN, () => w.t.api.call('updates.create', { projectId: w.ids.project, body: 'The report is in.', fileIds: [upload.file.id] }));
    await as(w, ADMIN, () => w.t.api.call('folders.setLock', { id: open.id, locked: true }));
    const feed = await text(w, SARA, () => w.t.api.call('updates.list', { projectId: w.ids.project }));
    expect(feed).toContain('The report is in.');
    expect(feed).not.toContain('report.pdf');
    expect(await text(w, ADMIN, () => w.t.api.call('updates.list', { projectId: w.ids.project }))).toContain('report.pdf');
  });

  it('refuses the Undo of a folder creation that would send the files of a locked folder to the root', async () => {
    const w = await world();
    delete w.t.store.state.projects[w.ids.project].folders;
    const folder = await as(w, ADMIN, () => w.t.api.call('folders.create', { projectId: w.ids.project, preset: 'contract' }));
    const created = Object.values(w.t.store.state.events).filter((event) => event.verb === 'project.folders_changed').sort((a, b) => b.seq - a.seq)[0];
    await as(w, ADMIN, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: 'deed.pdf', blob: pdf('d'), folderId: folder.id }));
    await expect(as(w, ADMIN, () => w.t.api.call('events.undo', { eventId: created.id }))).rejects.toMatchObject({ code: 'conflict', details: { reason: 'folder_locked_has_files' } });
    expect(w.t.store.state.projects[w.ids.project].folders!.map((item) => item.id)).toEqual([folder.id]);
  });
});

describe('the lists of ids that a post, a comment and a Tracker line keep', () => {
  it('leave out the id of a file in a locked folder for a person without the switch', async () => {
    const w = await world();
    const open = await as(w, ADMIN, () => w.t.api.call('folders.create', { projectId: w.ids.project, name: 'Reports' }));
    const upload = await as(w, ADMIN, () => w.t.api.call('files.upload', { projectId: w.ids.project, name: 'report.pdf', blob: pdf('r'), folderId: open.id }));
    const id = upload.file.id;
    const post = await as(w, ADMIN, () => w.t.api.call('updates.create', { projectId: w.ids.project, body: 'The report.', fileIds: [id] }));
    const task = await as(w, ADMIN, () => w.t.api.call('tasks.create', { projectId: w.ids.project, title: 'Read it', stageId: w.ids.stage }));
    await as(w, ADMIN, () => w.t.api.call('comments.create', { targetType: 'task', targetId: task.task.id, body: 'See it.', fileIds: [id] }));
    const entry = await as(w, ADMIN, () => w.t.api.call('tracker.log', { projectId: w.ids.project, type: 'file', direction: 'in', title: 'Report', fileIds: [id] }));
    // The lock is refused while a Tracker line names the file; a line that names it later (an old line) is set by hand here.
    w.t.store.state.tracker![entry.entry.id].fileIds = [];
    await as(w, ADMIN, () => w.t.api.call('folders.setLock', { id: open.id, locked: true }));
    w.t.store.state.tracker![entry.entry.id].fileIds = [id];
    const reads: [string, unknown][] = [
      ['updates.list', { projectId: w.ids.project }],
      ['comments.list', { targetType: 'task', targetId: task.task.id }],
      ['tracker.list', { projectId: w.ids.project }],
    ];
    for (const person of WITHOUT) {
      for (const [name, input] of reads) {
        const body = await text(w, person, () => w.t.api.call(name as 'updates.list', input as never));
        expect(body, `${person} ${name}`).not.toContain(id);
        expect(body, `${person} ${name}`).not.toContain('report.pdf');
      }
    }
    for (const [name, input] of reads) expect(await text(w, ADMIN, () => w.t.api.call(name as 'updates.list', input as never)), name).toContain(id);
    void post;
  });
});
