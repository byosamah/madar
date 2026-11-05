import { beforeAll, describe, expect, it } from 'vitest';
import type { RoleSettings } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { call } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';
import { aiSwitchOf } from './aiSwitches';
import { MCP_DENY } from './tools';
import { base64Of, uploadWorld, type UploadWorld } from './upload.testing';

/**
 * The Resources over MCP (fbk_078, lead decision 2026-11-05: no new tools). An agent uses files.list and folders.create with resources true, and folders.rename,
 * folders.setLock, folders.delete, files.move and files.delete with a Resources id. Each needs the AI switch of the tool and, for a change, the switch "Manage office resources". A locked folder and its files show only to the agent of a holder of
 * "Locked folders": for any other agent every tool answers as for a missing record, and no list, search or History holds a name.
 * People of the sample office: usr_001 is the Admin (both switches), usr_002 holds neither, usr_003 holds only the manage switch (role Curator), usr_004
 * holds only the lock switch (role Keeper).
 */
const ADMIN = 'usr_001';
const MEMBER = 'usr_002';
const CURATOR = 'usr_003';
const KEEPER = 'usr_004';
const AT = '2026-10-04T09:00:00.000+03:00';
const SECRET_FOLDER = 'Private papers';
const SECRET = 'Secret-policy.pdf';
const ROLES: RoleSettings = {
  custom: [
    { id: 'rol_091', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] },
    { id: 'rol_092', name: 'Curator', nameAr: 'مسؤول', rights: ['resources.manage'] },
  ],
};
const version = (key: string) => ({ letter: 'A', blobKey: key, mimeType: 'application/pdf', size: 10, uploadedBy: ADMIN, uploadedAt: AT });
const file = (id: string, name: string, key: string, folderId?: string) => ({
  id, projectId: null, stageId: null, taskId: null, resource: true as const, ...(folderId ? { folderId } : {}), name, versions: [version(key)],
});

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

function prepare(state: State): void {
  state.settings.roles = ROLES;
  state.users[CURATOR] = { ...state.users[CURATOR], systemRole: 'member', roleId: 'rol_092' };
  state.users[KEEPER] = { ...state.users[KEEPER], systemRole: 'member', roleId: 'rol_091' };
  state.settings.resourceFolders = [
    { id: 'fld_901', name: 'Office codes', createdBy: ADMIN, createdAt: AT },
    { id: 'fld_902', name: SECRET_FOLDER, createdBy: ADMIN, createdAt: AT, locked: true },
  ];
  state.counters.fld = 902;
  state.files.fil_901 = file('fil_901', 'Handbook.pdf', 'resources/upl-1/file');
  state.files.fil_902 = file('fil_902', 'Building-code.pdf', 'resources/upl-2/file', 'fld_901');
  state.files.fil_903 = file('fil_903', SECRET, 'resources/upl-3/file', 'fld_902');
}
const world = (person: string): UploadWorld => uploadWorld(seed, person, prepare);
const outputOf = (result: Record<string, any>) => result.structuredContent?.output as any;
const errorOf = (result: Record<string, any>) => result.structuredContent?.error as { code: string; message: string; details?: Record<string, any> } | undefined;
const swap = (value: unknown, id: string) => JSON.parse(JSON.stringify(value ?? null).split(id).join('@')) as unknown;

describe('the Resources tools', () => {
  it('adds no tool of its own: the five calls of the screen are on the deny list, and the instructions name the Resources', () => {
    for (const name of ['resources.list', 'resources.saveFolder', 'resources.updateFile', 'resources.delete']) expect(MCP_DENY as readonly string[], name).toContain(name);
    expect(INSTRUCTIONS).toContain('Resources:');
    expect(INSTRUCTIONS).toContain('Manage office resources');
    expect(INSTRUCTIONS).toContain('Locked folders');
  });

  it('puts the file and folder tools on ai.projects and files.list on ai.readWork', () => {
    expect(aiSwitchOf('files.list')).toBe('ai.readWork');
    for (const name of ['folders.create', 'folders.rename', 'folders.setLock', 'folders.delete', 'files.move', 'files.delete', 'files.link']) expect(aiSwitchOf(name), name).toBe('ai.projects');
  });
});

describe('files.list with resources true, and files.link', () => {
  const names = (result: Record<string, any>) => (outputOf(result) as { file: { name: string } }[]).map((view) => view.file.name);

  it('gives the Admin and the holder of the lock switch the locked file, and everyone else the open ones only', async () => {
    for (const person of [ADMIN, KEEPER]) {
      expect(names(await call(world(person), 'files.list', { resources: true })), person).toEqual(['Building-code.pdf', 'Handbook.pdf', SECRET]);
    }
    for (const person of [MEMBER, CURATOR]) {
      const result = await call(world(person), 'files.list', { resources: true });
      expect(names(result), person).toEqual(['Building-code.pdf', 'Handbook.pdf']);
      expect(JSON.stringify(result), person).not.toMatch(/Private papers|Secret-policy|fld_902|fil_903/);
    }
  });

  it('gives a link to an open file, and the answer of a missing file for the locked one', async () => {
    const w = world(MEMBER);
    const open = await call(w, 'files.link', { id: 'fil_902', variant: 'full', disposition: 'inline' });
    expect(open.isError, JSON.stringify(open)).toBeUndefined();
    const hidden = errorOf(await call(w, 'files.link', { id: 'fil_903', variant: 'full', disposition: 'inline' }));
    const gone = errorOf(await call(w, 'files.link', { id: 'fil_999', variant: 'full', disposition: 'inline' }));
    expect(hidden?.code).toBe('not_found');
    expect(swap(hidden, 'fil_903')).toEqual(swap(gone, 'fil_999'));
    const keeper = await call(world(KEEPER), 'files.link', { id: 'fil_903', variant: 'full', disposition: 'inline' });
    expect(keeper.isError, JSON.stringify(keeper)).toBeUndefined();
  });

  it('shows no name in the search, the History or the settings of the agent of a person without the lock switch', async () => {
    for (const person of [MEMBER, CURATOR]) {
      const w = world(person);
      for (const [name, args] of [['search.query', { text: 'secret' }], ['search.query', { text: 'private' }], ['events.list', { limit: 500 }], ['settings.get', {}]] as const) {
        expect(JSON.stringify(await call(w, name, args)), `${person} ${name}`).not.toMatch(/Private papers|Secret-policy|fld_902|fil_903/);
      }
    }
    const found = outputOf(await call(world(KEEPER), 'search.query', { text: 'secret' }));
    expect(found.files.map((hit: { name: string }) => hit.name)).toEqual([SECRET]);
  });
});

describe('the folder and file tools with a Resources target', () => {
  it('make, rename, move and delete for the agent of a holder of the manage switch, and write the event with the agent and the person', async () => {
    const w = world(CURATOR);
    const made = outputOf(await call(w, 'folders.create', { resources: true, name: 'Policies' }));
    expect(made.name).toBe('Policies');
    expect(outputOf(await call(w, 'folders.rename', { id: made.id, name: 'Office policies' })).name).toBe('Office policies');
    const moved = outputOf(await call(w, 'files.move', { id: 'fil_901', stageId: null, folderId: made.id }));
    expect(moved.file).toMatchObject({ name: 'Handbook.pdf', folderId: made.id });
    expect(outputOf(await call(w, 'folders.delete', { id: made.id }))).toEqual({ deleted: true });
    expect(w.mem.tables.state.files.fil_901.folderId ?? null).toBeNull();
    expect(outputOf(await call(w, 'files.delete', { id: 'fil_901' }))).toEqual({ deleted: true });
    const events = Object.values(w.mem.tables.state.events).filter((e) => e.verb === 'resources.folders_changed' && e.actorKind === 'agent');
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event).toMatchObject({ actorId: 'usr_950', actingForId: CURATOR });
  });

  it('refuses the agent of a holder of the manage switch a lock, and answers as for a missing record for the locked folder and file', async () => {
    const w = world(CURATOR);
    expect(errorOf(await call(w, 'folders.setLock', { id: 'fld_901', locked: true }))).toMatchObject({ code: 'forbidden', details: { action: 'folder.locked' } });
    for (const [name, hidden, missing, id, gone] of [
      ['folders.rename', { id: 'fld_902', name: 'Mine' }, { id: 'fld_998', name: 'Mine' }, 'fld_902', 'fld_998'],
      ['folders.setLock', { id: 'fld_902', locked: false }, { id: 'fld_998', locked: false }, 'fld_902', 'fld_998'],
      ['folders.delete', { id: 'fld_902' }, { id: 'fld_998' }, 'fld_902', 'fld_998'],
      ['files.delete', { id: 'fil_903' }, { id: 'fil_998' }, 'fil_903', 'fil_998'],
      ['files.move', { id: 'fil_903', stageId: null, folderId: null }, { id: 'fil_998', stageId: null, folderId: null }, 'fil_903', 'fil_998'],
      ['files.move', { id: 'fil_901', stageId: null, folderId: 'fld_902' }, { id: 'fil_901', stageId: null, folderId: 'fld_998' }, 'fld_902', 'fld_998'],
    ] as const) {
      const seen = errorOf(await call(w, name, hidden));
      const other = errorOf(await call(w, name, missing));
      expect(seen?.code, name).toBeDefined();
      expect(swap(seen, id), name).toEqual(swap(other, gone));
    }
    expect(w.mem.tables.state.files.fil_903).toBeDefined();
  });

  it('lets the agent of the Admin lock and unlock a folder', async () => {
    const w = world(ADMIN);
    expect(outputOf(await call(w, 'folders.setLock', { id: 'fld_901', locked: true })).locked).toBe(true);
    expect(outputOf(await call(w, 'folders.setLock', { id: 'fld_901', locked: false })).locked).toBeUndefined();
  });

  it('refuses the agent of a person without the manage switch every change', async () => {
    const w = world(MEMBER);
    for (const [name, args] of [['folders.create', { resources: true, name: 'Mine' }], ['folders.rename', { id: 'fld_901', name: 'Mine' }], ['files.delete', { id: 'fil_901' }], ['files.move', { id: 'fil_901', stageId: null, folderId: 'fld_901' }]] as const) {
      expect(errorOf(await call(w, name, args))?.code, name).toBe('forbidden');
    }
    expect(w.mem.tables.state.settings.resourceFolders).toHaveLength(2);
  });
});

describe('files.uploadContent into Resources', () => {
  const body = (extra: Record<string, unknown> = {}) => ({ resources: true, name: 'Fire-code.pdf', type: 'application/pdf', contentBase64: base64Of(new TextEncoder().encode('%PDF-1.4 code')), ...extra });

  it('uploads into a folder for the agent of a holder, under the Resources key, and answers without a key or a link', async () => {
    const w = world(CURATOR);
    const result = await call(w, 'files.uploadContent', body({ folderId: 'fld_901' }));
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const out = outputOf(result);
    expect(out).toMatchObject({ name: 'Fire-code.pdf', version: 'A', place: { projectId: null, stageId: null, taskId: null, folderId: 'fld_901', resources: true } });
    const keys = [...w.files.objects.keys()].filter((key) => key.endsWith('/file'));
    expect(keys.filter((key) => key.startsWith('up/'))).toEqual([]);
    expect(keys.filter((key) => key.startsWith('resources/'))).toHaveLength(1);
    const text = JSON.stringify(result);
    for (const bad of ['blobKey', 'resources/upl', 'https://', 'uploadId']) expect(text, bad).not.toContain(bad);
    const listed = outputOf(await call(w, 'files.list', { resources: true }));
    expect(listed.some((view: { file: { id: string } }) => view.file.id === out.id)).toBe(true);
  });

  it('adds a version for the same name in the same place', async () => {
    const w = world(CURATOR);
    const first = outputOf(await call(w, 'files.uploadContent', body()));
    const second = outputOf(await call(w, 'files.uploadContent', body({ contentBase64: base64Of(new TextEncoder().encode('%PDF-1.4 second')) })));
    expect(second.id).toBe(first.id);
    expect(second.version).toBe('B');
  });

  it('refuses the agent of a person without the manage switch before any store work, and a locked folder as a missing folder', async () => {
    for (const person of [MEMBER, KEEPER]) {
      const w = world(person);
      const refused = errorOf(await call(w, 'files.uploadContent', body({ folderId: 'fld_901' })));
      expect(refused?.code, person).toBe('forbidden');
      expect(w.files.calls).toEqual([]);
      expect(w.puts).toEqual([]);
    }
    const w = world(CURATOR);
    const hidden = errorOf(await call(w, 'files.uploadContent', body({ folderId: 'fld_902' })));
    const gone = errorOf(await call(w, 'files.uploadContent', body({ folderId: 'fld_998' })));
    expect(hidden?.code).toBe('invalid_input');
    expect(swap(hidden, 'fld_902')).toEqual(swap(gone, 'fld_998'));
    expect(JSON.stringify(hidden)).not.toMatch(/Private papers|fld_902/);
  });

  it('refuses a project next to resources', async () => {
    const w = world(ADMIN);
    const refused = errorOf(await call(w, 'files.uploadContent', body({ projectId: 'prj_001' })));
    expect(refused?.code).toBe('invalid_input');
  });
});
