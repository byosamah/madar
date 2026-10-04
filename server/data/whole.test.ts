import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../src/api/store';
import type { Query } from '../core/ports';
import { TABLES } from './tables';
import { loadWhole, writeState } from './whole';

/** The whole read and write without a database (task C1). server/data/schema.test.ts runs them on the local stack. */

const TODAY = '2026-10-04';

/** A fake database: the docs of each table in insertion order, and the counters. */
function fakeDb(docs: Record<string, unknown[]>, counters: { prefix: string; n: number | string }[] = []) {
  const sql: string[] = [];
  const q: Query = async <R,>(text: string) => {
    sql.push(text);
    const table = /^select doc from (\w+) order by ord$/.exec(text)?.[1];
    if (table) return (docs[table] ?? []).map((doc) => ({ doc })) as R[];
    if (text.startsWith('select prefix, n from counters')) return counters as R[];
    return [] as R[];
  };
  return { q, sql };
}

const EVENT = { seq: 1, projectId: null, actorId: 'usr_001', actorKind: 'human', actingForId: 'usr_001', correlationId: 'sty_a', verb: 'x', targetType: 'task', targetId: 'tsk_001', before: null, after: null, createdAt: '2026-10-04T10:00:00.000+03:00', undoneBy: null };

describe('loadWhole', () => {
  it('reads every table in insertion order, fills undoneBy from the undo events, and reads the counters as numbers', async () => {
    const settings = emptyState(TODAY).settings;
    const { q, sql } = fakeDb(
      {
        settings: [settings],
        tasks: [{ id: 'tsk_002' }, { id: 'tsk_001' }],
        members: [{ projectId: 'prj_001', userId: 'usr_001' }],
        events: [{ ...EVENT, id: 'evt_001' }, { ...EVENT, id: 'evt_002', seq: 2, verb: 'undo', undoes: 'evt_001' }],
      },
      [{ prefix: 'tsk', n: 2 }, { prefix: 'evt', n: '2' }],
    );
    const state = await loadWhole(q, { withEvents: true, today: TODAY });
    expect(Object.keys(state.tasks)).toEqual(['tsk_002', 'tsk_001']);
    expect(Object.keys(state.members)).toEqual(['prj_001:usr_001']);
    expect(state.events.evt_001.undoneBy).toBe('evt_002');
    expect(state.events.evt_002.undoneBy).toBeNull();
    expect(state.counters).toEqual({ tsk: 2, evt: 2 });
    expect(state.settings).toEqual(settings);
    expect(state.feedback).toEqual({});
    expect(state.seededOn).toBe(TODAY);
    expect(sql.filter((text) => text.startsWith('select doc from'))).toHaveLength(TABLES.length);
  });

  it('gives a change event back each field of the change on both sides, as undefined where the JSON of the doc dropped it (D2)', async () => {
    // events.ts records a field that was absent before a change as before[field] = undefined, and the Undo removes the field again
    // from that key. JSON drops the key, so the load puts it back from the other side.
    const before = { startDate: '2026-10-01' };
    const after = { startDate: '2026-10-07', dateNotes: [{ lateDays: 4 }] };
    const { q } = fakeDb({ events: [{ ...EVENT, id: 'evt_001', before, after }, { ...EVENT, id: 'evt_002', seq: 2, before: null, after: { id: 'tsk_002' } }] });
    const state = await loadWhole(q, { withEvents: true });
    const loaded = state.events.evt_001.before as Record<string, unknown>;
    expect(Object.keys(loaded).sort()).toEqual(['dateNotes', 'startDate']);
    expect(loaded.dateNotes).toBeUndefined();
    expect(state.events.evt_001.after).toEqual(after);
    expect(state.events.evt_002.before).toBeNull();
    expect(state.events.evt_002.after).toEqual({ id: 'tsk_002' });
  });

  it('leaves the events out when asked', async () => {
    const { q, sql } = fakeDb({ events: [{ ...EVENT, id: 'evt_001' }] });
    const state = await loadWhole(q, { withEvents: false });
    expect(state.events).toEqual({});
    expect(sql.some((text) => text.includes('from events'))).toBe(false);
  });
});

describe('writeState', () => {
  it('writes every record of a State as new rows, with no change signal', async () => {
    const sql: { text: string; values?: unknown[] }[] = [];
    const q: Query = async <R,>(text: string, values?: unknown[]) => {
      sql.push({ text, values });
      if (text.includes('update office_meta')) return [{ version: 1, office_seq: 0 }] as R[];
      return [] as R[];
    };
    const state: State = emptyState(TODAY);
    state.users.usr_001 = { id: 'usr_001' } as never;
    state.tasks.tsk_001 = { id: 'tsk_001', projectId: 'prj_001', title: 'A' } as never;
    state.counters = { usr: 1, tsk: 1 };
    const result = await writeState(q, state);
    expect(result.signals).toEqual([]);
    expect(sql.find((s) => s.text.includes('update office_meta'))!.values).toEqual([1, 0]);
    expect(sql.some((s) => s.text.includes('person_seq'))).toBe(false);
    // The settings row exists from the first migration, so it is an upsert like every other row.
    expect(sql.find((s) => s.text.startsWith('insert into settings'))!.text).toContain('on conflict (id) do update');
    expect(sql.filter((s) => s.text.startsWith('insert into')).map((s) => s.text.split(' ')[2])).toEqual(['users', 'settings', 'tasks', 'counters']);
  });
});
