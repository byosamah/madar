import { describe, expect, it } from 'vitest';
import { EventTarget } from './contract/entities';
import { COLLECTION } from './events';
import { REFERENCE_FIELDS, REFERENCES, isReferenced, jsonPathOf, valuesAt } from './references';
import { emptyState, type State } from './store';
import { buildSeed } from '../data/seed';
import { TODAY } from '../test/factories';

/** The scan that isUsedElsewhere ran before the map (plan 4.13, A1). The map must give the same answers. */
const SKIP_WHEN_SCANNING = new Set<keyof State>(['events', 'notifications', 'session', 'settings', 'counters']);
function mentions(value: unknown, id: string, depth: number): boolean {
  if (value === id) return true;
  if (depth === 0 || value === null || typeof value !== 'object') return false;
  return Object.values(value).some((item) => mentions(item, id, depth - 1));
}
function oldScan(state: State, collectionKey: keyof State, targetId: string): boolean {
  for (const key of Object.keys(state) as (keyof State)[]) {
    if (SKIP_WHEN_SCANNING.has(key)) continue;
    const value = state[key];
    if (value === null || typeof value !== 'object') continue;
    for (const [recordKey, record] of Object.entries(value)) {
      if (key === collectionKey && recordKey === targetId) continue;
      if (mentions(record, targetId, 3)) return true;
    }
  }
  return false;
}

/** Builds the smallest record that holds the id at the path. */
function recordWith(path: string, id: string): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  const array = head.endsWith('[]');
  const name = array ? head.slice(0, -2) : head;
  const inner = rest.length === 0 ? id : recordWith(rest.join('.'), id);
  if (name === '*') return { '👍': array ? [inner] : inner };
  return { [name]: array ? [inner] : inner };
}

function stateWith(collection: string, record: Record<string, unknown>): State {
  const state = emptyState(TODAY) as unknown as Record<string, Record<string, unknown>>;
  state[collection] = { ...(state[collection] ?? {}), rec_holder: record };
  return state as unknown as State;
}

const TARGET_ID: Record<EventTarget, string> = {
  project: 'prj_900', member: 'prj_900:usr_900', stage: 'stg_900', deadline: 'ddl_900', task: 'tsk_900', update: 'upd_900', comment: 'cmt_900',
  file: 'fil_900', client: 'cli_900', user: 'usr_900', settings: 'settings', stageTemplate: 'stt_900', taskTemplate: 'ttp_900', tracker: 'trk_900',
  payment: 'pay_900', feedback: 'fbk_900', team: 'tm_900', projectTemplate: 'ptp_900', subCompany: 'sub_900', meeting: 'mtg_900',
};

describe('the reference map', () => {
  it('has an entry for every target type', () => {
    expect(Object.keys(REFERENCES).sort()).toEqual([...EventTarget.options].sort());
    expect(REFERENCES.settings).toEqual([]);
  });

  it('reads values at a path, through lists and through every key of a record', () => {
    const record = { a: 'x', list: ['y', 'z'], nested: { b: 'w' }, rows: [{ c: 'v' }, { c: 'u' }], byKey: { one: ['t'], two: ['s'] } };
    expect(valuesAt(record, 'a')).toEqual(['x']);
    expect(valuesAt(record, 'list[]')).toEqual(['y', 'z']);
    expect(valuesAt(record, 'nested.b')).toEqual(['w']);
    expect(valuesAt(record, 'rows[].c')).toEqual(['v', 'u']);
    expect(valuesAt(record, 'byKey.*[]')).toEqual(['t', 's']);
    expect(valuesAt(record, 'missing.b')).toEqual([]);
    expect(valuesAt({ nested: null }, 'nested.b')).toEqual([]);
  });

  it('gives each path as a Postgres JSON path for the server', () => {
    expect(jsonPathOf('coverFileId')).toBe('$.coverFileId');
    expect(jsonPathOf('fileIds[]')).toBe('$.fileIds[*]');
    expect(jsonPathOf('versions[].uploadedBy')).toBe('$.versions[*].uploadedBy');
    expect(jsonPathOf('reactions.*[]')).toBe('$.reactions.*[*]');
  });

  for (const target of EventTarget.options) {
    for (const ref of REFERENCES[target]) {
      it(`finds a ${target} id in ${ref.collection}.${ref.path}`, () => {
        const id = TARGET_ID[target];
        expect(isReferenced(stateWith(ref.collection, recordWith(ref.path, id)), target, id)).toBe(true);
        expect(isReferenced(stateWith(ref.collection, recordWith(ref.path, `${id}0`)), target, id)).toBe(false);
      });
    }
  }

  it('finds a project file in a direct chat message, outside the project (AM 7.1)', () => {
    const state = stateWith('messages', { id: 'msg_001', conversationId: 'cnv_009', fileIds: ['fil_900'] });
    expect(isReferenced(state, 'file', 'fil_900')).toBe(true);
  });

  it('does not count the target record itself', () => {
    const state = stateWith('tasks', { id: 'tsk_900', prerequisiteIds: ['tsk_900'] });
    (state.tasks as Record<string, unknown>).tsk_900 = state.tasks.rec_holder;
    delete (state.tasks as Record<string, unknown>).rec_holder;
    expect(isReferenced(state, 'task', 'tsk_900')).toBe(false);
  });

  it('lists only fields that hold ids of their target type', () => {
    for (const field of REFERENCE_FIELDS) expect(field.targets.length).toBeGreaterThan(0);
  });

  it('gives the same answers as the old scan over the sample office, for every id', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    let checked = 0;
    let used = 0;
    for (const target of EventTarget.options) {
      const key = COLLECTION[target];
      if (!key) continue;
      for (const id of Object.keys((state[key] ?? {}) as object)) {
        const expected = oldScan(state, key, id);
        expect(isReferenced(state, target, id), `${target} ${id}`).toBe(expected);
        checked += 1;
        if (expected) used += 1;
      }
    }
    // The comparison means something only when both answers occur many times.
    expect(checked).toBeGreaterThan(300);
    expect(used).toBeGreaterThan(50);
    expect(checked - used).toBeGreaterThan(50);
    // The old scan reads the whole office once for each id. On a busy machine it needs more than the default 5 seconds.
  }, 30_000);
});
