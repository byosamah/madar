import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import type { RoleSettings } from '../contract/entities';
import { makeUser, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The existing file and folder calls take a Resources target (lead decision, 2026-11-05: no new MCP tools): files.list with `resources: true`,
 * folders.create with `resources: true`, folders.rename, folders.setLock and folders.delete with the id of a Resources folder, files.move and files.delete
 * with the id of a Resources file. Each rule lives in the shared handlers: the switch resources.manage, the lock switch, and not_found for a hidden id.
 * People as in resources.test.ts: the Admin holds both switches, Sara (usr_003) none, Hadi (usr_007) only the manage switch, Lina (usr_006) only the lock switch.
 */
const ADMIN = 'usr_001';
const SARA = 'usr_003';
const LINA = 'usr_006';
const HADI = 'usr_007';
const AT = '2026-10-04T10:00:00.000+03:00';
const ROLES: RoleSettings = {
  custom: [
    { id: 'rol_001', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] },
    { id: 'rol_002', name: 'Curator', nameAr: 'مسؤول', rights: ['resources.manage'] },
  ],
};
const pdf = (text: string) => new Blob([text], { type: 'application/pdf' });

async function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = ROLES;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Keeper', roleId: 'rol_001' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Hadi Curator', roleId: 'rol_002' });
  state.counters.usr = 7;
  t.as(ADMIN);
  const open = await t.api.call('resources.saveFolder', { name: 'Office codes' });
  const locked = await t.api.call('resources.saveFolder', { name: 'Private papers', locked: true });
  const root = await t.api.call('files.upload', { resources: true, name: 'handbook.pdf', blob: pdf('root') });
  const codes = await t.api.call('files.upload', { resources: true, name: 'code.pdf', blob: pdf('c'), folderId: open.id });
  const secret = await t.api.call('files.upload', { resources: true, name: 'secret-policy.pdf', blob: pdf('s'), folderId: locked.id });
  return { t, state, ids: { open: open.id, locked: locked.id, root: root.file.id, codes: codes.file.id, secret: secret.file.id } };
}
type World = Awaited<ReturnType<typeof world>>;
const as = async <T>(w: World, person: string, run: () => Promise<T>): Promise<T> => {
  w.t.as(person);
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
const shape = (error: Failure | null, id: string) => {
  if (error === null) return null;
  const swap = (text: string) => text.split(id).join('@');
  return { code: error.code, message: swap(error.message), details: JSON.parse(swap(JSON.stringify(error.details ?? {}))) as unknown };
};

describe('files.list with resources: true', () => {
  it('lists the files that the person may see, with the name of the folder, and no locked file for a person without the lock switch', async () => {
    const w = await world();
    const names = async (person: string) => (await as(w, person, () => w.t.api.call('files.list', { resources: true }))).map((view) => `${view.file.name}@${view.folder?.name ?? ''}`).sort();
    expect(await names(SARA)).toEqual(['code.pdf@Office codes', 'handbook.pdf@']);
    expect(await names(HADI)).toEqual(['code.pdf@Office codes', 'handbook.pdf@']);
    expect(await names(LINA)).toEqual(['code.pdf@Office codes', 'handbook.pdf@', 'secret-policy.pdf@Private papers']);
    expect(await names(ADMIN)).toEqual(['code.pdf@Office codes', 'handbook.pdf@', 'secret-policy.pdf@Private papers']);
    expect(JSON.stringify(await as(w, SARA, () => w.t.api.call('files.list', { resources: true })))).not.toMatch(/Private papers|secret-policy/);
  });

  it('refuses a project or a task next to resources', async () => {
    const w = await world();
    expect(await as(w, ADMIN, () => failure(() => w.t.api.call('files.list', { resources: true, projectId: 'prj_001' })))).toMatchObject({ code: 'invalid_input' });
  });
});

describe('folders.create, folders.rename, folders.setLock and folders.delete with a Resources target', () => {
  it('make, rename and delete a folder for a holder of the manage switch, and refuse a person without it', async () => {
    const w = await world();
    const made = await as(w, HADI, () => w.t.api.call('folders.create', { resources: true, name: 'Policies' }));
    expect(made).toMatchObject({ name: 'Policies', stageId: null });
    expect(w.t.store.state.settings.resourceFolders?.map((f) => f.name)).toContain('Policies');
    await as(w, HADI, () => w.t.api.call('folders.rename', { id: made.id, name: 'Office policies' }));
    expect(w.t.store.state.settings.resourceFolders?.find((f) => f.id === made.id)?.name).toBe('Office policies');
    expect(await as(w, SARA, () => failure(() => w.t.api.call('folders.create', { resources: true, name: 'Mine' })))).toMatchObject({ code: 'forbidden' });
    expect(await as(w, SARA, () => failure(() => w.t.api.call('folders.rename', { id: made.id, name: 'Mine' })))).toMatchObject({ code: 'forbidden' });
    await as(w, HADI, () => w.t.api.call('folders.delete', { id: made.id }));
    expect(w.t.store.state.settings.resourceFolders?.some((f) => f.id === made.id)).toBe(false);
  });

  it('lock and unlock need the lock switch too, also for a holder of the manage switch', async () => {
    const w = await world();
    expect(await as(w, HADI, () => failure(() => w.t.api.call('folders.setLock', { id: w.ids.open, locked: true })))).toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
    expect((await as(w, ADMIN, () => w.t.api.call('folders.setLock', { id: w.ids.open, locked: true }))).locked).toBe(true);
    expect((await as(w, ADMIN, () => w.t.api.call('folders.setLock', { id: w.ids.open, locked: false }))).locked).toBeUndefined();
  });

  it('answer a hidden folder as an unknown folder, for a person without the lock switch', async () => {
    const w = await world();
    for (const person of [SARA, HADI]) {
      for (const [name, hidden, missing] of [
        ['folders.rename', { id: w.ids.locked, name: 'Mine' }, { id: 'fld_998', name: 'Mine' }],
        ['folders.setLock', { id: w.ids.locked, locked: false }, { id: 'fld_998', locked: false }],
        ['folders.delete', { id: w.ids.locked }, { id: 'fld_998' }],
      ] as const) {
        const seen = await as(w, person, () => failure(() => w.t.api.call(name, hidden as never)));
        const gone = await as(w, person, () => failure(() => w.t.api.call(name, missing as never)));
        expect(seen, `${person} ${name}`).not.toBeNull();
        expect(shape(seen, w.ids.locked), `${person} ${name}`).toEqual(shape(gone, 'fld_998'));
        expect(JSON.stringify(seen)).not.toMatch(/Private papers/);
      }
    }
  });

  it('keep the project folder calls as they were', async () => {
    const w = await world();
    const made = await as(w, ADMIN, () => w.t.api.call('projects.create', { name: 'Villa Noor' }));
    const folder = await as(w, ADMIN, () => w.t.api.call('folders.create', { projectId: made.project.id, name: 'Reports' }));
    expect(w.t.store.state.projects[made.project.id].folders?.some((f) => f.id === folder.id)).toBe(true);
    expect(await as(w, ADMIN, () => failure(() => w.t.api.call('folders.create', { name: 'No place' })))).toMatchObject({ code: 'invalid_input' });
  });
});

describe('files.move, files.delete, files.markDelivered and files.share of a Resources file', () => {
  it('move and delete for a holder of the manage switch, with an Undo, and refuse a person without it', async () => {
    const w = await world();
    expect(await as(w, SARA, () => failure(() => w.t.api.call('files.delete', { id: w.ids.root })))).toMatchObject({ code: 'forbidden' });
    expect(await as(w, SARA, () => failure(() => w.t.api.call('files.move', { id: w.ids.root, stageId: null, folderId: w.ids.open })))).toMatchObject({ code: 'forbidden' });
    const moved = await as(w, HADI, () => w.t.api.call('files.move', { id: w.ids.root, stageId: null, folderId: w.ids.open }));
    expect(moved.file.folderId).toBe(w.ids.open);
    expect(await as(w, HADI, () => failure(() => w.t.api.call('files.move', { id: w.ids.root, stageId: 'stg_001', folderId: null })))).toMatchObject({ details: { reason: 'file_resource' } });
    await as(w, HADI, () => w.t.api.call('files.delete', { id: w.ids.root }));
    expect(w.t.store.state.files[w.ids.root]).toBeUndefined();
    const added = Object.values(w.t.store.state.events).filter((e) => e.verb === 'file.deleted').at(-1)!;
    await as(w, HADI, () => w.t.api.call('events.undo', { eventId: added.id }));
    expect(w.t.store.state.files[w.ids.root].name).toBe('handbook.pdf');
  });

  it('answer a hidden file as an unknown file on every file call, and a visible one with file_resource on the calls that never take it', async () => {
    const w = await world();
    for (const person of [SARA, HADI]) {
      for (const [name, hidden, missing] of [
        ['files.delete', { id: w.ids.secret }, { id: 'fil_998' }],
        ['files.move', { id: w.ids.secret, stageId: null, folderId: null }, { id: 'fil_998', stageId: null, folderId: null }],
        ['files.markDelivered', { id: w.ids.secret }, { id: 'fil_998' }],
        ['files.share', { fileId: w.ids.secret, target: { kind: 'project_chat' } }, { fileId: 'fil_998', target: { kind: 'project_chat' } }],
        ['files.get', { id: w.ids.secret }, { id: 'fil_998' }],
      ] as const) {
        const seen = await as(w, person, () => failure(() => w.t.api.call(name, hidden as never)));
        const gone = await as(w, person, () => failure(() => w.t.api.call(name, missing as never)));
        expect(seen, `${person} ${name}`).not.toBeNull();
        expect(shape(seen, w.ids.secret), `${person} ${name}`).toEqual(shape(gone, 'fil_998'));
      }
    }
    const reason = (error: Failure | null) => (error?.details as { reason?: string } | undefined)?.reason;
    expect(reason(await as(w, ADMIN, () => failure(() => w.t.api.call('files.markDelivered', { id: w.ids.root }))))).toBe('file_resource');
    expect(reason(await as(w, ADMIN, () => failure(() => w.t.api.call('files.share', { fileId: w.ids.root, target: { kind: 'project_chat' } }))))).toBe('file_resource');
  });
});
