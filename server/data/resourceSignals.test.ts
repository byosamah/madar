import { beforeAll, describe, expect, it } from 'vitest';
import type { ResourceFolder } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { diffState, writeDiff } from './save';

/**
 * The change signals of the Resources page (fbk_078, owner 2026-11-05). A change inside a locked folder of Resources (the folder, its files, the History
 * lines about them) goes only as person signals to the holders of the switch "Locked folders", and names no folder or file. Resources belongs to no
 * project, so the signal names no project. A folder that gets locked or unlocked is a change that everyone sees, so it goes on the office signal with the
 * kinds settings and files. The sample office: the Admin usr_001 holds the switch, and usr_005 holds it by a custom role.
 */
let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const ADMIN = 'usr_001';
const KEEPER = 'usr_005';
const AT = '2026-10-04T10:00:00.000+03:00';
const NAME = 'Private papers';

const copy = (): State => {
  const state = structuredClone(seed);
  state.settings.roles = { custom: [{ id: 'rol_090', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] }] };
  state.users[KEEPER] = { ...state.users[KEEPER], roleId: 'rol_090' };
  return state;
};
const people = (ids: string[]) => [...new Set(ids)].sort().map((id) => `person:${id}`);
const folder = (locked: boolean, name = NAME): ResourceFolder => ({ id: 'fld_901', name, createdBy: 'usr_001', createdAt: AT, ...(locked ? { locked: true } : {}) });
const withFolders = (state: State, folders: ResourceFolder[]): State => {
  state.settings = { ...state.settings, resourceFolders: folders };
  return state;
};
function withEvent(state: State, verb: string, targetType: 'settings' | 'file', targetId: string, before: unknown, after: unknown): void {
  const seq = Math.max(...Object.values(state.events).map((e) => e.seq)) + 1;
  state.events.evt_901 = {
    id: 'evt_901', seq, projectId: null, actorId: 'usr_001', actorKind: 'human', actingForId: 'usr_001', correlationId: 'sty_resources',
    verb, targetType, targetId, before, after, createdAt: AT, undoneBy: null,
  };
}
const resourceFile = (id: string, folderId?: string) => ({
  id, projectId: null, stageId: null, taskId: null, resource: true as const, ...(folderId ? { folderId } : {}), name: 'Policy.pdf',
  versions: [{ letter: 'A', blobKey: 'resources/upl-x/file', mimeType: 'application/pdf', size: 9, uploadedBy: 'usr_001', uploadedAt: AT }],
});

function recorder() {
  const q: Query = async <R,>(text: string, values?: unknown[]) => {
    if (text.includes('update office_meta')) {
      const [v, s] = values as number[];
      return [{ version: String(7 + v), office_seq: String(40 + s) }] as R[];
    }
    if (text.includes('insert into person_seq')) return (values![0] as string[]).map((id) => ({ user_id: id, seq: '1' })) as R[];
    return [] as R[];
  };
  return q;
}
const send = async (before: State, after: State): Promise<ChangeSignal[]> => (await writeDiff(recorder(), diffState(before, after))).signals;
const NO_NAMES = new RegExp(`${NAME}|fld_901|Policy`);

describe('a change inside a locked folder of Resources', () => {
  it('goes only as person signals to the holders of the lock switch, with no office signal and no project', async () => {
    const before = withFolders(copy(), [folder(true)]);
    const after = structuredClone(before);
    after.files.fil_901 = resourceFile('fil_901', 'fld_901');
    withEvent(after, 'file.added', 'file', 'fil_901', null, after.files.fil_901);
    const signals = await send(before, after);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, KEEPER]));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    for (const signal of signals) {
      expect(signal.kinds).toEqual(['events', 'files']);
      expect(signal.projects).toEqual([]);
    }
    expect(JSON.stringify(signals)).not.toMatch(NO_NAMES);
  });

  it('sends a rename of the locked folder the same way', async () => {
    const before = withFolders(copy(), [folder(true)]);
    const after = withFolders(structuredClone(before), [folder(true, 'Private papers 2')]);
    withEvent(after, 'resources.folders_changed', 'settings', 'resources', { resourceFolders: before.settings.resourceFolders }, { resourceFolders: after.settings.resourceFolders });
    const signals = await send(before, after);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, KEEPER]));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    for (const signal of signals) expect(signal.kinds).toEqual(['events', 'settings']);
    expect(JSON.stringify(signals)).not.toMatch(/Private papers|fld_901/);
  });

  it('sends the delete of a file of the locked folder the same way', async () => {
    const before = withFolders(copy(), [folder(true)]);
    before.files.fil_901 = resourceFile('fil_901', 'fld_901');
    const after = structuredClone(before);
    delete after.files.fil_901;
    withEvent(after, 'file.deleted', 'file', 'fil_901', before.files.fil_901, null);
    const signals = await send(before, after);
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, KEEPER]));
  });
});

describe('a change that everyone sees', () => {
  it('goes on the office signal when a folder gets locked, with the kinds settings and files', async () => {
    const before = withFolders(copy(), [folder(false)]);
    const after = withFolders(structuredClone(before), [folder(true)]);
    withEvent(after, 'resources.folders_changed', 'settings', 'resources', { resourceFolders: before.settings.resourceFolders }, { resourceFolders: after.settings.resourceFolders });
    const signals = await send(before, after);
    const office = signals.find((signal) => signal.channel === 'office')!;
    expect(office.kinds).toEqual(expect.arrayContaining(['files', 'settings']));
    expect(JSON.stringify(office)).not.toMatch(NO_NAMES);
  });

  it('goes on the office signal when a file of an open folder changes', async () => {
    const before = withFolders(copy(), [folder(false)]);
    const after = structuredClone(before);
    after.files.fil_901 = resourceFile('fil_901', 'fld_901');
    withEvent(after, 'file.added', 'file', 'fil_901', null, after.files.fil_901);
    const signals = await send(before, after);
    const office = signals.find((signal) => signal.channel === 'office')!;
    expect(office.kinds).toEqual(expect.arrayContaining(['events', 'files']));
    expect(office.projects).toEqual([]);
    expect(JSON.stringify(office)).not.toMatch(NO_NAMES);
  });

  it('goes on the office signal when a file comes out of a locked folder, because the others see it appear', async () => {
    const before = withFolders(copy(), [folder(true)]);
    before.files.fil_901 = resourceFile('fil_901', 'fld_901');
    const after = structuredClone(before);
    after.files.fil_901 = resourceFile('fil_901');
    const signals = await send(before, after);
    expect(signals.some((signal) => signal.channel === 'office')).toBe(true);
  });
});
