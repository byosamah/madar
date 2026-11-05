import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { RoleSettings } from '../contract/entities';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The Resources page (fbk_078, owner 2026-11-05): the files of the whole office. Every person reads them. The switch "Manage office resources"
 * (resources.manage) adds, renames, moves and deletes files and folders; only the Admin holds it by default. A locked folder (the switch "Locked
 * folders", folder.locked) and every file in it shows only to the holders of that switch; for everyone else it is a missing folder and a missing file,
 * on every path.
 *
 * People: the Admin (usr_001) holds both switches. Sara (usr_003) and Omar (usr_004) hold neither. Lina (usr_006, role Keeper) holds only the lock switch.
 * Hadi (usr_007, role Curator) holds only the manage switch. Usr_008 is the agent of Sara, usr_009 the agent of Hadi, usr_010 the agent of Lina.
 */
const ADMIN = 'usr_001';
const SARA = 'usr_003';
const OMAR = 'usr_004';
const LINA = 'usr_006';
const HADI = 'usr_007';
const AGENT_OF_SARA = 'usr_008';
const AGENT_OF_HADI = 'usr_009';
const AGENT_OF_LINA = 'usr_010';
const WITHOUT_LOCK = [SARA, OMAR, HADI, AGENT_OF_SARA, AGENT_OF_HADI];
const WITH_LOCK = [ADMIN, LINA, AGENT_OF_LINA];
const ROLES: RoleSettings = {
  custom: [
    { id: 'rol_001', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] },
    { id: 'rol_002', name: 'Curator', nameAr: 'مسؤول', rights: ['resources.manage'] },
  ],
};
const SECRET = 'secret-policy.pdf';
const SECRET_FOLDER = 'Private papers';
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = ROLES;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Keeper', roleId: 'rol_001' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Hadi Curator', roleId: 'rol_002' });
  state.users.usr_008 = makeUser('usr_008', { name: 'Sara Assistant', kind: 'agent', discipline: 'Agent', ownerId: SARA });
  state.users.usr_009 = makeUser('usr_009', { name: 'Hadi Assistant', kind: 'agent', discipline: 'Agent', ownerId: HADI });
  state.users.usr_010 = makeUser('usr_010', { name: 'Lina Assistant', kind: 'agent', discipline: 'Agent', ownerId: LINA });
  state.counters.usr = 10;
  t.as(ADMIN);
  const open = await t.api.call('resources.saveFolder', { name: 'Office codes' });
  const locked = await t.api.call('resources.saveFolder', { name: SECRET_FOLDER, locked: true });
  const root = await t.api.call('files.upload', { resources: true, name: 'handbook.pdf', blob: pdf('root') });
  const codes = await t.api.call('files.upload', { resources: true, name: 'building-code.pdf', blob: pdf('codes'), folderId: open.id });
  const secret = await t.api.call('files.upload', { resources: true, name: SECRET, blob: pdf('secret'), folderId: locked.id });
  const events = Object.values(state.events);
  const secretAdded = events.find((event) => event.verb === 'file.added' && event.targetId === secret.file.id)!;
  const lockedMade = events.find((event) => event.verb === 'resources.folders_changed' && JSON.stringify(event.after).includes(SECRET_FOLDER))!;
  return {
    t,
    ids: { open: open.id, locked: locked.id, root: root.file.id, codes: codes.file.id, secret: secret.file.id, secretAdded: secretAdded.id, lockedMade: lockedMade.id },
  };
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
const NAMES = (w: World) => new RegExp(`${SECRET_FOLDER}|${SECRET}|secret-policy|${w.ids.locked}|${w.ids.secret}`);
const namesOf = (view: { folders: { name: string }[]; files: { file: { name: string } }[] }) => ({ folders: view.folders.map((f) => f.name), files: view.files.map((v) => v.file.name) });

describe('reading the Resources', () => {
  it('shows every person the open folders and files, and the locked ones only to a holder of the lock switch', async () => {
    const w = await world();
    for (const person of WITHOUT_LOCK) {
      const view = await as(w, person, () => w.t.api.call('resources.list', {}));
      expect(namesOf(view), person).toEqual({ folders: ['Office codes'], files: ['building-code.pdf', 'handbook.pdf'] });
    }
    for (const person of WITH_LOCK) {
      const view = await as(w, person, () => w.t.api.call('resources.list', {}));
      expect(namesOf(view), person).toEqual({ folders: ['Office codes', SECRET_FOLDER], files: ['building-code.pdf', 'handbook.pdf', SECRET] });
    }
  });

  it('gives the flags of the controls: manage with the manage switch, lock with both', async () => {
    const w = await world();
    const flags = async (person: string) => (await as(w, person, () => w.t.api.call('resources.list', {}))).viewerCan;
    expect(await flags(ADMIN)).toEqual({ manage: true, lock: true });
    expect(await flags(HADI)).toEqual({ manage: true, lock: false });
    expect(await flags(LINA)).toEqual({ manage: false, lock: false });
    expect(await flags(SARA)).toEqual({ manage: false, lock: false });
    expect(await flags(AGENT_OF_HADI)).toEqual({ manage: true, lock: false });
  });

  it('gives canDelete from the manage switch', async () => {
    const w = await world();
    const hadi = await as(w, HADI, () => w.t.api.call('resources.list', {}));
    expect(hadi.files.every((view) => view.canDelete)).toBe(true);
    const sara = await as(w, SARA, () => w.t.api.call('resources.list', {}));
    expect(sara.files.every((view) => !view.canDelete)).toBe(true);
  });

  it('keeps the folder list out of settings.get, for every person', async () => {
    const w = await world();
    for (const person of [ADMIN, SARA, HADI]) {
      const body = await text(w, person, () => w.t.api.call('settings.get', {}));
      expect(body, person).not.toContain('resourceFolders');
      expect(body, person).not.toContain(SECRET_FOLDER);
    }
  });

  it('keeps Resources out of a project list of files and out of an office task', async () => {
    const w = await world();
    const made = await as(w, ADMIN, () => w.t.api.call('projects.create', { name: 'Villa Noor' }));
    expect(await as(w, ADMIN, () => w.t.api.call('files.list', { projectId: made.project.id }))).toEqual([]);
    await expect(as(w, ADMIN, () => w.t.api.call('files.list', {}))).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('who may change the Resources', () => {
  it('refuses a person without the manage switch every write, and the agent of that person', async () => {
    const w = await world();
    for (const person of [SARA, OMAR, LINA, AGENT_OF_SARA, AGENT_OF_LINA]) {
      const writes: [string, unknown][] = [
        ['resources.saveFolder', { name: 'Mine' }],
        ['resources.saveFolder', { id: w.ids.open, name: 'Mine' }],
        ['resources.updateFile', { id: w.ids.root, name: 'mine.pdf' }],
        ['resources.updateFile', { id: w.ids.root, folderId: w.ids.open }],
        ['resources.delete', { id: w.ids.root }],
        ['resources.delete', { id: w.ids.open }],
        ['files.upload', { resources: true, name: 'mine.pdf', blob: pdf('m') }],
      ];
      for (const [name, input] of writes) {
        // Lina holds the lock switch, so she sees the locked folder; the open ones are all these probes name.
        const refused = await as(w, person, () => failure(() => w.t.api.call(name as 'resources.delete', input as never)));
        expect(refused?.code, `${person} ${name}`).toBe('forbidden');
      }
    }
    const view = await as(w, ADMIN, () => w.t.api.call('resources.list', {}));
    expect(namesOf(view).files).toEqual(['building-code.pdf', 'handbook.pdf', SECRET]);
  });

  it('lets a holder of the manage switch make, rename, move, upload and delete', async () => {
    const w = await world();
    const folder = await as(w, HADI, () => w.t.api.call('resources.saveFolder', { name: 'Policies' }));
    await as(w, HADI, () => w.t.api.call('resources.saveFolder', { id: folder.id, name: 'Office policies' }));
    await as(w, HADI, () => w.t.api.call('resources.updateFile', { id: w.ids.root, name: 'staff-handbook.pdf', folderId: folder.id }));
    const fresh = await as(w, HADI, () => w.t.api.call('files.upload', { resources: true, name: 'leave.pdf', blob: pdf('leave'), folderId: folder.id }));
    let view = await as(w, SARA, () => w.t.api.call('resources.list', {}));
    expect(namesOf(view)).toEqual({ folders: ['Office codes', 'Office policies'], files: ['building-code.pdf', 'leave.pdf', 'staff-handbook.pdf'] });
    await as(w, HADI, () => w.t.api.call('resources.delete', { id: fresh.file.id }));
    await as(w, HADI, () => w.t.api.call('resources.delete', { id: folder.id }));
    view = await as(w, SARA, () => w.t.api.call('resources.list', {}));
    // The file of the deleted folder is back at the root: no file is deleted with a folder.
    expect(namesOf(view)).toEqual({ folders: ['Office codes'], files: ['building-code.pdf', 'staff-handbook.pdf'] });
    expect(w.t.store.state.files[w.ids.root].folderId ?? null).toBeNull();
  });

  it('lets the agent of a holder do the same, with the rights of the person', async () => {
    const w = await world();
    const folder = await as(w, AGENT_OF_HADI, () => w.t.api.call('resources.saveFolder', { name: 'Agent folder' }));
    expect(folder.name).toBe('Agent folder');
    const event = Object.values(w.t.store.state.events).find((item) => item.verb === 'resources.folders_changed' && JSON.stringify(item.after).includes('Agent folder'))!;
    expect(event.actorId).toBe(AGENT_OF_HADI);
    expect(event.actingForId).toBe(HADI);
  });

  it('needs the lock switch too to lock or unlock a folder, also when the person holds the manage switch', async () => {
    const w = await world();
    await expect(as(w, HADI, () => w.t.api.call('resources.saveFolder', { id: w.ids.open, locked: true }))).rejects.toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
    await expect(as(w, HADI, () => w.t.api.call('resources.saveFolder', { name: 'Born locked', locked: true }))).rejects.toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
    const locked = await as(w, ADMIN, () => w.t.api.call('resources.saveFolder', { id: w.ids.open, locked: true }));
    expect(locked.locked).toBe(true);
    const open = await as(w, ADMIN, () => w.t.api.call('resources.saveFolder', { id: w.ids.open, locked: false }));
    expect(open.locked).toBeUndefined();
  });

  it('refuses a name that another visible folder holds, and keeps two names apart that differ in case only', async () => {
    const w = await world();
    const refused = await as(w, ADMIN, () => failure(() => w.t.api.call('resources.saveFolder', { name: 'office CODES' })));
    expect(refused).toMatchObject({ code: 'invalid_input', details: { reason: 'folder_name_taken' } });
  });

  it('adds a version when a file of the same name is uploaded into the same place, and a new file for another place', async () => {
    const w = await world();
    const again = await as(w, ADMIN, () => w.t.api.call('files.upload', { resources: true, name: 'Building-Code.pdf', blob: pdf('v2'), folderId: w.ids.open }));
    expect(again.file.id).toBe(w.ids.codes);
    expect(again.latest.letter).toBe('B');
    const other = await as(w, ADMIN, () => w.t.api.call('files.upload', { resources: true, name: 'building-code.pdf', blob: pdf('root copy') }));
    expect(other.file.id).not.toBe(w.ids.codes);
    expect(other.latest.letter).toBe('A');
  });

  it('refuses an upload that names a project, a stage, a task or a cover, and a folder that does not exist', async () => {
    const w = await world();
    const made = await as(w, ADMIN, () => w.t.api.call('projects.create', { name: 'Villa Noor' }));
    const base = { resources: true as const, name: 'x.png', blob: new Blob(['x'], { type: 'image/png' }) };
    expect(await failure(() => w.t.api.call('files.upload', { ...base, projectId: made.project.id }))).toMatchObject({ code: 'invalid_input', details: { reason: 'file_resource' } });
    expect(await failure(() => w.t.api.call('files.upload', { ...base, asCover: true }))).toMatchObject({ code: 'invalid_input', details: { reason: 'file_resource' } });
    expect(await failure(() => w.t.api.call('files.upload', { ...base, receivedFromClient: true }))).toMatchObject({ code: 'invalid_input', details: { reason: 'file_resource' } });
    expect(await failure(() => w.t.api.call('files.upload', { ...base, folderId: 'fld_999' }))).toMatchObject({ code: 'invalid_input', details: { reason: 'folder_missing' } });
  });

  it('does not delete a locked folder, and does not delete a file with its folder', async () => {
    const w = await world();
    const refused = await as(w, ADMIN, () => failure(() => w.t.api.call('resources.delete', { id: w.ids.locked })));
    expect(refused).toMatchObject({ code: 'invalid_input', details: { reason: 'folder_locked' } });
    await as(w, ADMIN, () => w.t.api.call('resources.delete', { id: w.ids.open }));
    expect(w.t.store.state.files[w.ids.codes].name).toBe('building-code.pdf');
    expect(w.t.store.state.files[w.ids.codes].folderId ?? null).toBeNull();
  });
});

describe('a locked folder and its file answer a person without the switch as missing ones', () => {
  it('on every call that names the folder, the file in it, or an event about them', async () => {
    const w = await world();
    const { locked, secret, secretAdded, lockedMade } = w.ids;
    const probes: [string, unknown, unknown, string][] = [
      ['resources.saveFolder', { id: locked, name: 'Mine' }, { id: 'fld_999', name: 'Mine' }, locked],
      ['resources.saveFolder', { id: locked, locked: false }, { id: 'fld_999', locked: false }, locked],
      ['resources.delete', { id: locked }, { id: 'fld_999' }, locked],
      ['resources.delete', { id: secret }, { id: 'fil_999' }, secret],
      ['resources.updateFile', { id: secret, name: 'mine.pdf' }, { id: 'fil_999', name: 'mine.pdf' }, secret],
      ['resources.updateFile', { id: w.ids.root, folderId: locked }, { id: w.ids.root, folderId: 'fld_999' }, locked],
      ['files.get', { id: secret }, { id: 'fil_999' }, secret],
      ['files.delete', { id: secret }, { id: 'fil_999' }, secret],
      ['files.markDelivered', { id: secret }, { id: 'fil_999' }, secret],
      ['files.share', { fileId: secret, target: { kind: 'person', userId: ADMIN } }, { fileId: 'fil_999', target: { kind: 'person', userId: ADMIN } }, secret],
      ['files.upload', { resources: true, name: 'a.pdf', blob: pdf('y'), folderId: locked }, { resources: true, name: 'a.pdf', blob: pdf('y'), folderId: 'fld_999' }, locked],
      ['events.undo', { eventId: secretAdded }, { eventId: 'evt_999' }, secretAdded],
      ['events.undo', { eventId: lockedMade }, { eventId: 'evt_999' }, lockedMade],
    ];
    for (const person of WITHOUT_LOCK) {
      for (const [name, hidden, missing, id] of probes) {
        // Hadi holds the manage switch and Sara and Omar do not: a person without it is refused before the folder is read, so only a holder of the manage switch tells.
        if (!['usr_007', 'usr_009'].includes(person) && name.startsWith('resources.') || (!['usr_007', 'usr_009'].includes(person) && name === 'files.upload')) continue;
        const seen = await as(w, person, () => failure(() => w.t.api.call(name as 'files.get', hidden as never)));
        const gone = await as(w, person, () => failure(() => w.t.api.call(name as 'files.get', missing as never)));
        const label = `${person} ${name}`;
        expect(seen, label).not.toBeNull();
        const goneId = JSON.stringify(missing).match(/"((?:fld|fil|evt)_99\d)"/)?.[1] ?? id;
        expect(shape(seen, id), label).toEqual(shape(gone, goneId));
        expect(JSON.stringify(seen).split(id).join('@'), label).not.toMatch(NAMES(w));
      }
    }
  }, 120_000);

  it('shows no name or id of the folder or the file in any list, the History or the search', async () => {
    const w = await world();
    const reads: [string, unknown][] = [
      ['resources.list', {}],
      ['events.list', { limit: 500 }],
      ['events.list', { targetType: 'file', targetId: w.ids.secret }],
      ['events.list', { targetType: 'settings', targetId: 'resources' }],
      ['search.query', { text: 'secret' }],
      ['search.query', { text: 'policy' }],
      ['search.query', { text: 'private' }],
      ['settings.get', {}],
      ['dashboard.get', {}],
      ['projects.list', {}],
    ];
    for (const person of WITHOUT_LOCK) {
      for (const [name, input] of reads) {
        const body = await text(w, person, () => w.t.api.call(name as 'projects.list', input as never));
        expect(body, `${person} ${name}`).not.toMatch(NAMES(w));
      }
    }
  });

  it('takes the locked folders out of the folder list of an event that a person reads', async () => {
    const w = await world();
    const events = await as(w, SARA, () => w.t.api.call('events.list', { targetType: 'settings', targetId: 'resources', limit: 500 }));
    // Only the creation of the open folder shows; the locked folder's creation and every later list that holds it is hidden.
    const lists = events.map((line) => (line.event.after as { resourceFolders: { name: string }[] }).resourceFolders.map((f) => f.name));
    for (const names of lists) expect(names).not.toContain(SECRET_FOLDER);
    expect(lists.length).toBeGreaterThan(0);
    const own = await as(w, ADMIN, () => w.t.api.call('events.list', { targetType: 'settings', targetId: 'resources', limit: 500 }));
    expect(own.length).toBeGreaterThan(events.length);
  });

  it('shows the folder, the file and their changes to the Admin, a holder of the lock switch and the agent of a holder', async () => {
    const w = await world();
    for (const person of WITH_LOCK) {
      const found = await as(w, person, () => w.t.api.call('search.query', { text: 'secret' }));
      expect(found.files.map((hit) => hit.name), person).toEqual([SECRET]);
      expect(found.files[0].resource, person).toBe(true);
      const events = await as(w, person, () => w.t.api.call('events.list', { limit: 500 }));
      expect(events.some((line) => line.event.id === w.ids.secretAdded), person).toBe(true);
      expect(events.some((line) => line.event.id === w.ids.lockedMade), person).toBe(true);
    }
  });

  it('does not add a version to the locked file when a person without the switch uploads the same name', async () => {
    const w = await world();
    const upload = await as(w, HADI, () => w.t.api.call('files.upload', { resources: true, name: SECRET, blob: pdf('other') }));
    expect(upload.file.id).not.toBe(w.ids.secret);
    expect(upload.file.versions).toHaveLength(1);
    expect(w.t.store.state.files[w.ids.secret].versions).toHaveLength(1);
  });

  it('hides a folder at the moment it is locked, and shows it again when it is unlocked', async () => {
    const w = await world();
    expect(namesOf(await as(w, SARA, () => w.t.api.call('resources.list', {}))).files).toContain('building-code.pdf');
    await as(w, ADMIN, () => w.t.api.call('resources.saveFolder', { id: w.ids.open, locked: true }));
    const hidden = await as(w, SARA, () => w.t.api.call('resources.list', {}));
    expect(namesOf(hidden)).toEqual({ folders: [], files: ['handbook.pdf'] });
    expect(await text(w, SARA, () => w.t.api.call('search.query', { text: 'building' }))).not.toContain('building-code.pdf');
    expect(await text(w, SARA, () => w.t.api.call('events.list', { limit: 500 }))).not.toMatch(/building-code|Office codes/);
    await as(w, ADMIN, () => w.t.api.call('resources.saveFolder', { id: w.ids.open, locked: false }));
    expect(namesOf(await as(w, SARA, () => w.t.api.call('resources.list', {}))).folders).toEqual(['Office codes']);
    // The History of the folder shows again, also the days when it was locked.
    expect(await text(w, SARA, () => w.t.api.call('events.list', { limit: 500 }))).toContain('building-code.pdf');
  });

  it('refuses a locked file as a carrier in a post, a comment or a chat message: the same answer as for an unknown file', async () => {
    const w = await world();
    const made = await as(w, ADMIN, () => w.t.api.call('projects.create', { name: 'Villa Noor', teamIds: [SARA] }));
    const hidden = await as(w, SARA, () => failure(() => w.t.api.call('updates.create', { projectId: made.project.id, body: 'x', fileIds: [w.ids.secret] })));
    const missing = await as(w, SARA, () => failure(() => w.t.api.call('updates.create', { projectId: made.project.id, body: 'x', fileIds: ['fil_999'] })));
    expect(shape(hidden, w.ids.secret)).toEqual(shape(missing, 'fil_999'));
  });
});

describe('a file of Resources stays on the Resources page', () => {
  it('is refused by every carrier for a person who sees it', async () => {
    const w = await world();
    const made = await as(w, ADMIN, () => w.t.api.call('projects.create', { name: 'Villa Noor', teamIds: [SARA] }));
    const task = await as(w, ADMIN, () => w.t.api.call('tasks.create', { projectId: made.project.id, title: 'Read it' }));
    const reason = (error: Failure | null) => (error?.details as { reason?: string } | undefined)?.reason;
    const attempts: [string, unknown][] = [
      ['updates.create', { projectId: made.project.id, body: 'x', fileIds: [w.ids.root] }],
      ['comments.create', { targetType: 'task', targetId: task.task.id, body: 'x', fileIds: [w.ids.root] }],
      ['files.share', { fileId: w.ids.root, target: { kind: 'project_chat' } }],
      ['files.share', { fileId: w.ids.root, target: { kind: 'task', taskId: task.task.id } }],
      ['files.delete', { id: w.ids.root }],
      ['files.markDelivered', { id: w.ids.root }],
      ['files.move', { id: w.ids.root, stageId: null, folderId: null }],
    ];
    for (const [name, input] of attempts) {
      const refused = await as(w, ADMIN, () => failure(() => w.t.api.call(name as 'files.share', input as never)));
      expect(reason(refused), name).toBe('file_resource');
    }
  });
});

describe('the History and the Undo of the Resources', () => {
  it('writes one event for each change with the agent and the person, and takes each back', async () => {
    const w = await world();
    const folder = await as(w, AGENT_OF_HADI, () => w.t.api.call('resources.saveFolder', { name: 'Policies' }));
    const story = Object.values(w.t.store.state.events).filter((event) => event.actorId === AGENT_OF_HADI);
    expect(story).toHaveLength(1);
    expect(story[0]).toMatchObject({ verb: 'resources.folders_changed', actingForId: HADI, targetType: 'settings', targetId: 'resources' });
    await as(w, HADI, () => w.t.api.call('events.undo', { eventId: story[0].id }));
    expect(namesOf(await as(w, SARA, () => w.t.api.call('resources.list', {}))).folders).toEqual(['Office codes']);
    void folder;
  });

  it('takes a rename, a move, an upload and a delete back', async () => {
    const w = await world();
    const eventOf = (verb: string) => Object.values(w.t.store.state.events).filter((event) => event.verb === verb && !event.undoneBy).sort((a, b) => b.seq - a.seq)[0];
    await as(w, ADMIN, () => w.t.api.call('resources.updateFile', { id: w.ids.root, name: 'renamed.pdf' }));
    await as(w, ADMIN, () => w.t.api.call('events.undo', { eventId: eventOf('file.renamed').id }));
    expect(w.t.store.state.files[w.ids.root].name).toBe('handbook.pdf');
    await as(w, ADMIN, () => w.t.api.call('resources.updateFile', { id: w.ids.root, folderId: w.ids.open }));
    await as(w, ADMIN, () => w.t.api.call('events.undo', { eventId: eventOf('file.moved').id }));
    expect(w.t.store.state.files[w.ids.root].folderId ?? null).toBeNull();
    const fresh = await as(w, ADMIN, () => w.t.api.call('files.upload', { resources: true, name: 'new.pdf', blob: pdf('n') }));
    await as(w, ADMIN, () => w.t.api.call('events.undo', { eventId: eventOf('file.added').id }));
    expect(w.t.store.state.files[fresh.file.id]).toBeUndefined();
    await as(w, ADMIN, () => w.t.api.call('resources.delete', { id: w.ids.root }));
    await as(w, ADMIN, () => w.t.api.call('events.undo', { eventId: eventOf('file.deleted').id }));
    expect(w.t.store.state.files[w.ids.root].name).toBe('handbook.pdf');
  });

  it('brings a deleted folder back with its files in one Undo of the story', async () => {
    const w = await world();
    await as(w, ADMIN, () => w.t.api.call('resources.delete', { id: w.ids.open }));
    expect(w.t.store.state.files[w.ids.codes].folderId ?? null).toBeNull();
    const last = Object.values(w.t.store.state.events).sort((a, b) => b.seq - a.seq)[0];
    await as(w, ADMIN, () => w.t.api.call('events.undoStory', { correlationId: last.correlationId }));
    expect(w.t.store.state.files[w.ids.codes].folderId).toBe(w.ids.open);
    expect(namesOf(await as(w, SARA, () => w.t.api.call('resources.list', {}))).folders).toEqual(['Office codes']);
  });

  it('refuses the Undo to a person without the manage switch, and the Undo of a hidden change reads as a missing event', async () => {
    const w = await world();
    const added = Object.values(w.t.store.state.events).find((event) => event.verb === 'file.added' && event.targetId === w.ids.codes)!;
    const refused = await as(w, SARA, () => failure(() => w.t.api.call('events.undo', { eventId: added.id })));
    expect(refused?.code).toBe('forbidden');
    const hidden = await as(w, HADI, () => failure(() => w.t.api.call('events.undo', { eventId: w.ids.secretAdded })));
    const unknown = await as(w, HADI, () => failure(() => w.t.api.call('events.undo', { eventId: 'evt_999' })));
    expect(shape(hidden, w.ids.secretAdded)).toEqual(shape(unknown, 'evt_999'));
  });

  it('refuses the Undo of a folder creation that would send the files of a locked folder to the root', async () => {
    const w = await world();
    await expect(as(w, ADMIN, () => w.t.api.call('events.undo', { eventId: w.ids.lockedMade }))).rejects.toMatchObject({ code: 'conflict' });
    expect(w.t.store.state.settings.resourceFolders!.map((folder) => folder.id)).toContain(w.ids.locked);
  });
});
