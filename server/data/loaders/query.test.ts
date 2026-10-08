import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../../src/api/store';
import { memorySource } from './memorySource';
import type { Select } from './query';
import { selectSql } from './sqlSource';

/**
 * The conditions of the loader reads in both forms (performance audit 2026-10-07). server/it/loaders.it.test.ts runs the same
 * reads on the database against the memory form.
 */

describe('a key of an object field (DB-5)', () => {
  const review: Select = { c: 'events', where: [{ col: 'target_type', in: ['task'] }, { field: 'after', key: 'status', in: ['in_review'] }] };

  it('reads doc->field->>key in SQL, with the values as a parameter', () => {
    const { text, values } = selectSql(review);
    expect(text).toBe(`select t.ord, t.doc as doc from events t where t.target_type = any($1::text[]) and t.doc->'after'->>'status' = any($2::text[]) order by t.ord`);
    expect(values).toEqual([['task'], ['in_review']]);
  });

  it('takes only plain names for the field and the key', () => {
    expect(() => selectSql({ c: 'events', where: [{ field: 'after', key: "status' or '1", in: ['x'] }] })).toThrow('Not a doc field');
    expect(() => selectSql({ c: 'events', where: [{ field: 'af-ter', key: 'status', in: ['x'] }] })).toThrow('Not a doc field');
  });

  it('matches in memory only a key that holds one of the values: not an absent field, a null, another value or another type', async () => {
    const event = (id: string, seq: number, after: unknown) => ({
      id, seq, verb: 'task.updated', targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', actorId: 'usr_001', actingForId: 'usr_001',
      actorKind: 'human', correlationId: 'cor_1', createdAt: '2026-10-01T09:00:00.000+03:00', before: null, undoneBy: null, ...(after === undefined ? {} : { after }),
    });
    const state = emptyState('2026-10-04') as State;
    const events = [
      event('evt_001', 1, undefined), event('evt_002', 2, null), event('evt_003', 3, { status: 'todo' }), event('evt_004', 4, { title: 'x' }),
      event('evt_005', 5, { status: 'in_review' }), event('evt_006', 6, ['in_review']), event('evt_007', 7, { status: 3 }), event('evt_008', 8, 'in_review'),
    ];
    state.events = Object.fromEntries(events.map((e) => [e.id, e])) as unknown as State['events'];
    const rows = await memorySource(state).select(review);
    expect(rows.map((row) => row.doc.id)).toEqual(['evt_005']);
    const number = await memorySource(state).select({ c: 'events', where: [{ field: 'after', key: 'status', in: ['3'] }] });
    expect(number.map((row) => row.doc.id)).toEqual(['evt_007']);
  });
});
