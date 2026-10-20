import { describe, expect, it } from 'vitest';
import { FEED_VERBS } from '../../../src/api/views';
import { emptyState, type State } from '../../../src/api/store';
import { memorySource } from '../loaders/memorySource';
import type { Select } from '../loaders/query';
import { tableOf } from '../tables';
import { LIST_BOUND_MAX, whereOf } from './compile';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

function world(): State {
  const s = emptyState('2026-10-17');
  const tasks = [
    { id: 'tsk_001', projectId: 'prj_001', ownerId: 'usr_001', status: 'todo', title: 'تصميم الواجهة', helperIds: ['usr_002'], flagged: true, points: 3, after: { status: 'in_review' } },
    { id: 'tsk_002', projectId: null, ownerId: 'usr_002', status: 'done', title: 'Office errand', helperIds: [], flagged: false, points: 1.5, after: ['x'] },
    { id: 'tsk_003', projectId: 'prj_002', ownerId: null, status: 'in_review', title: 'Roof plan', helperIds: 'usr_002' },
  ];
  for (const t of tasks) (s.tasks as Record<string, unknown>)[t.id] = t;
  const events = [
    { id: 'evt_001', seq: 1, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.created', createdAt: '2026-10-16T05:59:59.999Z' },
    { id: 'evt_002', seq: 2, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.updated', createdAt: '2026-10-16T09:00:00.000+03:00' },
    { id: 'evt_003', seq: 3, targetType: 'task', targetId: 'tsk_003', projectId: 'prj_002', verb: 'undo', undoes: 'evt_002', createdAt: '2026-10-16T06:00:00.001Z' },
  ];
  for (const e of events) (s.events as Record<string, unknown>)[e.id] = e;
  return s;
}

async function idsBoth(s: Select): Promise<{ lite: string[]; memory: string[] }> {
  const state = world();
  const { db } = await freshLite();
  await db.tx('write', (q) => liteWriteState(q, state));
  const values: unknown[] = [];
  const where = whereOf(s, values);
  const spec = tableOf(s.c);
  const lite = (await db.statement<{ id: string }>('read', `select t.id from ${spec.table} t where ${where} order by t.rowid`, values)).map((row) => row.id);
  const memory = (await memorySource(state).select(s)).map((row) => spec.key(row.doc));
  return { lite, memory };
}

const CASES: [string, Select][] = [
  ['a boolean field', { c: 'tasks', where: [{ field: 'flagged', in: ['true'] }] }],
  ['a false boolean field', { c: 'tasks', where: [{ field: 'flagged', in: ['false'] }] }],
  ['a number field', { c: 'tasks', where: [{ field: 'points', in: ['3', '1.5'] }] }],
  ['a key of an object field, not of a list', { c: 'tasks', where: [{ field: 'after', key: 'status', in: ['in_review'] }] }],
  ['a field that is JSON null or absent', { c: 'tasks', where: [{ field: 'flagged', null: true }] }],
  ['a field not in a list', { c: 'tasks', where: [{ field: 'flagged', notIn: ['true'] }] }],
  ['a column not in a list, with null', { c: 'tasks', where: [{ col: 'owner_id', notIn: ['usr_001'] }] }],
  ['a list field that holds a value, and a text field that does not count', { c: 'tasks', where: [{ has: 'helperIds', value: 'usr_002' }] }],
  ['a column that is null', { c: 'tasks', where: [{ col: 'project_id', eq: null }] }],
  ['search text', { c: 'tasks', where: [{ col: 'search_text', contains: 'roof' }] }],
  ['an or of two conditions', { c: 'tasks', where: [{ or: [{ col: 'status', in: ['done'] }, { has: 'helperIds', value: 'usr_002' }] }] }],
  ['a time at or after, with offsets and milliseconds', { c: 'events', where: [{ col: 'created_at', atOrAfter: '2026-10-16T09:00:00.000+03:00' }] }],
  ['a stamp and id after a pair', { c: 'events', where: [{ after: { at: '2026-10-16T09:00:00.000+03:00', id: 'evt_001' } }] }],
  ['a text that holds a LIKE wildcard', { c: 'tasks', where: [{ col: 'search_text', contains: '%' }] }],
  ['a stamp and id before a pair', { c: 'events', where: [{ before: { at: '2026-10-16T09:00:00.000+03:00', id: 'evt_003' } }] }],
  ['an int column in a list of texts', { c: 'events', where: [{ col: 'seq', in: ['2', '3'] }] }],
  ['events that no undo names', { c: 'events', where: [{ notUndone: true }] }],
];

describe('the conditions of a read on SQLite (server/data/lite/compile.ts)', () => {
  for (const [name, s] of CASES) {
    it(`gives the rows of the memory form: ${name}`, async () => {
      const { lite, memory } = await idsBoth(s);
      expect(lite).toEqual(memory);
    });
  }

  it('sends = for one value, bound values for a short list, and one JSON value for a long list', () => {
    const one: unknown[] = [];
    expect(whereOf({ c: 'tasks', where: [{ col: 'status', in: ['todo'] }] }, one)).toBe('t.status = ?');
    expect(one).toEqual(['todo']);
    const short: unknown[] = [];
    expect(whereOf({ c: 'tasks', where: [{ col: 'status', in: ['todo', 'done'] }] }, short)).toBe('t.status in (?, ?)');
    const long: unknown[] = [];
    const list = Array.from({ length: LIST_BOUND_MAX + 5 }, (_, i) => `tsk_${i}`);
    expect(whereOf({ c: 'tasks', where: [{ col: 'id', in: list }] }, long)).toBe('t.id in (select value from json_each(?))');
    expect(long).toEqual([JSON.stringify(list)]);
  });

  it('keeps the verb list of the project feed as bound values, so SQLite reads the events of the project by its own index', () => {
    // A list over LIST_BOUND_MAX turns into json_each. SQLite then drives the read by the verb and reads about twice the rows
    // (the year office pin of projects.list, wave 2). Raise LIST_BOUND_MAX with care when the verb list grows.
    const values: unknown[] = [];
    const sql = whereOf({ c: 'events', where: [{ col: 'project_id', in: ['prj_001'] }, { col: 'verb', in: [...FEED_VERBS] }] }, values);
    expect(sql).not.toContain('json_each');
    // The read with ties holds the conditions twice, plus the limit: it must stay under the 100 values of the host.
    expect(values.length * 2 + 1).toBeLessThanOrEqual(100);
  });
});
