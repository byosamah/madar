import { beforeAll, describe, expect, it } from 'vitest';
import type { ProjectFolder } from '../../src/api/contract/entities';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { diffState, writeDiff } from './save';

/**
 * The change signals of a locked folder (fbk_074, owner 2026-10-29). A change inside a locked folder (the folder, its files, the History lines
 * about them) goes only as person signals to the people who view the project and hold the switch "Locked folders", and names no folder or file. A
 * folder that gets locked or unlocked is a change that everyone sees, so it goes on the office signal with the kinds projects and files. The sample
 * office is the one of folderSignals.test.ts: the Admin usr_001 holds the switch, and usr_005 holds it by a custom role. prj_001 is open.
 */
let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const PROJECT = 'prj_001';
const ADMIN = 'usr_001';
const KEEPER = 'usr_005';
const AT = '2026-10-04T10:00:00.000+03:00';
const NAME = 'Signed papers';

const copy = (): State => {
  const state = structuredClone(seed);
  state.settings.roles = { custom: [{ id: 'rol_090', name: 'Keeper', nameAr: 'أمين', rights: ['folder.locked'] }] };
  state.users[KEEPER] = { ...state.users[KEEPER], roleId: 'rol_090' };
  return state;
};
const people = (ids: string[]) => [...new Set(ids)].sort().map((id) => `person:${id}`);
const folder = (locked: boolean, name = NAME): ProjectFolder => ({ id: 'fld_901', stageId: null, name, createdBy: 'usr_002', createdAt: AT, ...(locked ? { locked: true } : {}) });

function withFolder(state: State, locked: boolean, name = NAME): State {
  state.projects[PROJECT] = { ...state.projects[PROJECT], folders: [folder(locked, name)] };
  return state;
}
function withEvent(state: State, verb: string, targetType: 'project' | 'file', targetId: string, before: unknown, after: unknown): void {
  const seq = Math.max(...Object.values(state.events).map((e) => e.seq)) + 1;
  state.events.evt_901 = {
    id: 'evt_901', seq, projectId: PROJECT, actorId: 'usr_002', actorKind: 'human', actingForId: 'usr_002', correlationId: 'sty_locked',
    verb, targetType, targetId, before, after, createdAt: AT, undoneBy: null,
  };
}
const fileOf = (state: State) => Object.values(state.files).find((item) => item.projectId === PROJECT)!;

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
const NO_NAMES = new RegExp(`${NAME}|fld_901`);

describe('a change inside a locked folder', () => {
  it('goes only as person signals to the holders who view the project, with no office signal', async () => {
    const before = copy();
    const after = withFolder(structuredClone(before), true);
    // A new file in the folder: it was never seen by anyone else.
    const file = fileOf(after);
    after.files.fil_901 = { ...file, id: 'fil_901', folderId: 'fld_901', stageId: null, name: 'Deed.pdf' };
    withEvent(after, 'project.folders_changed', 'project', PROJECT, { folders: [] }, { folders: after.projects[PROJECT].folders });
    const signals = await send(before, after);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, KEEPER]));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    for (const signal of signals) expect(signal.kinds).toEqual(expect.arrayContaining(['events', 'projects']));
    expect(JSON.stringify(signals)).not.toMatch(NO_NAMES);
  });

  it('sends a rename of the locked folder and the History line of a file in it the same way', async () => {
    const before = withFolder(copy(), true);
    const file = fileOf(before);
    before.files[file.id] = { ...file, folderId: 'fld_901', stageId: null };
    const after = structuredClone(before);
    after.projects[PROJECT] = { ...after.projects[PROJECT], folders: [folder(true, 'Deeds')] };
    withEvent(after, 'project.folders_changed', 'project', PROJECT, { folders: before.projects[PROJECT].folders }, { folders: after.projects[PROJECT].folders });
    const signals = await send(before, after);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, KEEPER]));
    const next = structuredClone(before);
    withEvent(next, 'file.version_added', 'file', file.id, { versions: [] }, { versions: file.versions });
    next.files[file.id] = { ...file, folderId: 'fld_901', stageId: null, name: 'Deed v2.pdf' };
    const edit = await send(before, next);
    expect(edit.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, KEEPER]));
    expect(edit.some((signal) => signal.channel === 'office')).toBe(false);
  });
});

describe('a folder that gets locked or unlocked', () => {
  it('is heard by everyone: the office signal holds the kinds projects and files', async () => {
    const before = withFolder(copy(), false);
    const file = fileOf(before);
    before.files[file.id] = { ...file, folderId: 'fld_901', stageId: null };
    const after = structuredClone(before);
    after.projects[PROJECT] = { ...after.projects[PROJECT], folders: [folder(true)] };
    withEvent(after, 'project.folders_changed', 'project', PROJECT, { folders: before.projects[PROJECT].folders }, { folders: after.projects[PROJECT].folders });
    const signals = await send(before, after);
    const office = signals.find((signal) => signal.channel === 'office')!;
    expect(office.projects).toEqual([PROJECT]);
    expect(office.kinds).toEqual(expect.arrayContaining(['projects', 'files']));
    expect(JSON.stringify(signals)).not.toMatch(NO_NAMES);
  });

  it('is heard by everyone when a file leaves a locked folder', async () => {
    const before = withFolder(copy(), true);
    const file = fileOf(before);
    before.files[file.id] = { ...file, folderId: 'fld_901', stageId: null };
    const after = structuredClone(before);
    after.files[file.id] = { ...file, folderId: null, stageId: null };
    const signals = await send(before, after);
    expect(signals.find((signal) => signal.channel === 'office')!.kinds).toContain('files');
  });
});

describe('a folder that is not locked', () => {
  it('keeps the office signal of a change in an open folder', async () => {
    const before = copy();
    const after = withFolder(structuredClone(before), false, 'Site photos');
    withEvent(after, 'project.folders_changed', 'project', PROJECT, { folders: [] }, { folders: after.projects[PROJECT].folders });
    const signals = await send(before, after);
    expect(signals.find((signal) => signal.channel === 'office')!.kinds).toEqual(expect.arrayContaining(['events', 'projects']));
  });
});
