import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { signinOffice } from '../auth/own/testOffice';
import { memoryData } from '../core/memoryData';
import { createRunCall } from '../core/runCall';
import { fakeDeps } from '../test/fakes/deps';
import { liteSave } from './lite/save';
import { liteLoadWhole } from './lite/whole';

/**
 * The signals of a hidden project through runCall (hidden projects, owner 2026-10-22, wave D3): the same rule on the memory path of the
 * server tests and on the SQLite path of the office object. A real call changes a task of a hidden project; the people who view it hear
 * it on their own channel, and the office signal and every outsider hear nothing.
 */

const NOW = new Date('2026-10-04T06:00:00Z');
const HIDDEN = 'prj_001';
const ADMIN = 'usr_001';
const TEAM = ['usr_002', 'usr_005', 'usr_006', 'usr_008'];
const CHOSEN = 'usr_007';
const OUTSIDERS = ['usr_003', 'usr_004', 'usr_010', 'usr_011'];
const TASK = 'tsk_001';

let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

const hide = (state: State): State => {
  state.projects[HIDDEN] = { ...state.projects[HIDDEN], access: { hidden: true, viewerIds: [CHOSEN] } };
  return state;
};
const people = (ids: string[]) => [...new Set(ids)].sort().map((id) => `person:${id}`);

describe('on the memory path', () => {
  function runner() {
    const mem = memoryData(hide(structuredClone(seed)));
    const deps = fakeDeps({ db: mem.db });
    deps.clock.set(NOW);
    const run = createRunCall({ data: () => mem.data() });
    return async (userId: string, name: string, input: unknown) => {
      const sent = deps.signal.sent.length;
      const result = await run(deps, { principal: { userId }, name, input, batch: { storyRefs: new Map(), overviewCalls: 0 } });
      if (!result.ok) throw new Error(`${name} failed: ${result.error.code} ${result.error.message}`);
      return deps.signal.sent.slice(sent);
    };
  }

  it('sends the change of a to-do of a hidden project to its people only, and nothing on the office channel', async () => {
    const call = runner();
    const signals = await call('usr_002', 'tasks.update', { id: TASK, patch: { title: 'A new title for the hidden project' } });
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    for (const signal of signals) expect(signal.projects).toEqual([HIDDEN]);
    for (const outsider of OUTSIDERS) expect(signals.some((signal) => signal.channel === `person:${outsider}`), outsider).toBe(false);
  });

  it('sends a comment on that to-do to the same people', async () => {
    const call = runner();
    const signals = await call('usr_005', 'comments.create', { targetType: 'task', targetId: TASK, body: 'A comment in the hidden project' });
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    expect(signals.some((signal) => signal.channel === 'office')).toBe(false);
  });
});

describe('on the SQLite path of the office object', () => {
  it('sends the change of a to-do of a hidden project to its people only, and nothing on the office channel', async () => {
    const t = await signinOffice({ at: '2026-10-04T06:00:00Z' });
    await t.db.tx('write', async (q) => {
      const before = await liteLoadWhole(q);
      await liteSave(q, before, hide(structuredClone(before)), { signals: false });
    });
    const sent = t.deps.signal.sent.length;
    const result = await t.call('usr_002', 'tasks.update', { id: TASK, patch: { title: 'A new title for the hidden project' } });
    if (!result.ok) throw new Error(`The call failed: ${JSON.stringify(result.error)}`);
    const signals = t.deps.signal.sent.slice(sent);
    expect(signals.map((signal) => signal.channel).sort()).toEqual(people([ADMIN, ...TEAM, CHOSEN]));
    for (const signal of signals) expect(signal.projects).toEqual([HIDDEN]);
    // The answer holds the own person signal, so the screen of the actor reloads.
    expect(result.signals?.map((signal) => signal.channel)).toEqual(['person:usr_002']);
  });
});
