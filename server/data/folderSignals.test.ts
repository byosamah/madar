import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import type { Query } from '../core/ports';
import type { ChangeSignal } from '../core/types';
import { diffState, writeDiff } from './save';

/**
 * The change signals of a folder (fbk_066, owner 2026-10-26). A folder lives in its project, so its changes follow the rule of hidden projects
 * (wave D3): a hidden project sends them only as person signals to the people who view it, and no signal names a folder or its file. The sample
 * office is the one of hiddenProjectSignals.test.ts: prj_001 has the leader usr_002 and the team usr_002, usr_005, usr_006 and usr_008; usr_001 is
 * the Admin; usr_007 becomes the chosen person; usr_003, usr_004, usr_010 and usr_011 are outsiders of prj_001.
 */

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const HIDDEN = 'prj_001';
const ADMIN = 'usr_001';
const TEAM = ['usr_002', 'usr_005', 'usr_006', 'usr_008'];
const CHOSEN = 'usr_007';
const OUTSIDERS = ['usr_003', 'usr_004', 'usr_010', 'usr_011'];
const AT = '2026-10-04T10:00:00.000+03:00';
const NAME = 'Secret mood folder';

const copy = (): State => structuredClone(seed);
const people = (ids: string[]) => [...new Set(ids)].sort().map((id) => `person:${id}`);

function hide(state: State): State {
  state.projects[HIDDEN] = { ...state.projects[HIDDEN], access: { hidden: true, viewerIds: [CHOSEN] } };
  return state;
}

/** A folder in the project and a file moved into it, with the events that the handlers write. */
function folderChange(state: State, projectId: string): string {
  const stage = Object.values(state.stages).find((item) => item.projectId === projectId)!;
  state.projects[projectId] = {
    ...state.projects[projectId],
    folders: [{ id: 'fld_901', stageId: stage.id, name: NAME, createdBy: 'usr_002', createdAt: AT }],
  };
  const seq = Math.max(...Object.values(state.events).map((e) => e.seq)) + 1;
  state.events.evt_901 = {
    id: 'evt_901', seq, projectId, actorId: 'usr_002', actorKind: 'human', actingForId: 'usr_002', correlationId: 'sty_folder',
    verb: 'project.folders_changed', targetType: 'project', targetId: projectId, before: { folders: [] }, after: { folders: state.projects[projectId].folders },
    createdAt: AT, undoneBy: null,
  };
  return stage.id;
}

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

describe('a folder change of a hidden project', () => {
  it('goes only as person signals to the leader, the team, the chosen person and the Admin, and names no folder', async () => {
    const before = hide(copy());
    const after = structuredClone(before);
    folderChange(after, HIDDEN);
    const signals = await send(before, after);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    for (const signal of signals) expect(signal.kinds).toEqual(expect.arrayContaining(['events', 'projects']));
    for (const outsider of OUTSIDERS) expect(signals.some((signal) => signal.channel === `person:${outsider}`), outsider).toBe(false);
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
    expect(JSON.stringify(signals)).not.toMatch(new RegExp(`${NAME}|fld_901`));
  });

  it('sends the move of a file into the folder to the same people, with the kind files', async () => {
    const before = hide(copy());
    const stageId = folderChange(before, HIDDEN);
    const after = structuredClone(before);
    const file = Object.values(after.files).find((item) => item.projectId === HIDDEN)!;
    after.files[file.id] = { ...file, stageId, folderId: 'fld_901' };
    const signals = await send(before, after);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    for (const signal of signals) expect(signal.kinds).toContain('files');
    expect(JSON.stringify(signals)).not.toMatch(new RegExp(`${NAME}|fld_901`));
  });
});

describe('a folder change of an open project', () => {
  it('goes on the office signal with the project, and names no folder', async () => {
    const before = copy();
    const after = structuredClone(before);
    folderChange(after, HIDDEN);
    const signals = await send(before, after);
    const office = signals.find((signal) => signal.channel === 'office')!;
    expect(office.projects).toEqual([HIDDEN]);
    expect(office.kinds).toEqual(expect.arrayContaining(['events', 'projects']));
    expect(JSON.stringify(signals)).not.toMatch(new RegExp(`${NAME}|fld_901`));
  });
});
