import { describe, expect, it } from 'vitest';
import { emptyState, type State } from '../../../src/api/store';
import { memorySource } from '../loaders/memorySource';
import type { Select } from '../loaders/query';
import { liteSource } from './source';
import { freshLite } from './testDb';
import { liteWriteState } from './whole';

const at = (minute: number) => `2026-10-16T09:${String(minute).padStart(2, '0')}:00.000+03:00`;

function office(): State {
  const s = emptyState('2026-10-17');
  const put = (c: keyof State, rec: Record<string, unknown>) => {
    ((s[c] ??= {} as never) as Record<string, unknown>)[rec.id as string] = rec;
  };
  // A real office keeps the project of each project task (a foreign key on Postgres), and each event holds undoneBy null.
  for (let i = 1; i <= 3; i++) put('projects', { id: `prj_00${i}`, code: `KH-00${i}`, name: `Project ${i}`, status: 'active', clientId: null, leaderId: 'usr_001' });
  for (let i = 1; i <= 150; i++) put('tasks', { id: `tsk_${String(i).padStart(3, '0')}`, projectId: `prj_${String((i % 3) + 1).padStart(3, '0')}`, ownerId: 'usr_001', status: 'todo', title: `Task ${i}`, helperIds: [] });
  // prj_001 has two newest posts of one stamp (a tie at the cut of limit 1); prj_002 has one newest post.
  const postMinutes = [1, 2, 4, 4, 5, 6];
  for (let i = 1; i <= 6; i++) put('updates', { id: `upd_00${i}`, projectId: i <= 4 ? 'prj_001' : 'prj_002', authorId: 'usr_001', body: 'Notes', fileIds: [], createdAt: at(postMinutes[i - 1]) });
  for (let i = 1; i <= 4; i++) put('comments', { id: `cmt_00${i}`, targetType: 'task', targetId: 'tsk_001', authorId: i === 2 ? 'usr_002' : 'usr_003', body: 'Hi', createdAt: at(i), reactions: { ok: ['usr_009'] } });
  for (let i = 1; i <= 5; i++) put('events', { id: `evt_00${i}`, seq: i, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.updated', createdAt: at(i * 10), undoneBy: null });
  put('files', { id: 'fil_001', projectId: 'prj_001', taskId: null, name: 'Plan', versions: [{ openedBy: 'usr_004' }, 'loose'] });
  return s;
}

async function both() {
  const state = office();
  const { db, log } = await freshLite();
  await db.tx('write', (q) => liteWriteState(q, state));
  log.length = 0;
  const read = <T,>(work: (s: ReturnType<typeof liteSource>) => Promise<T>) => db.tx('read', (q) => work(liteSource(q)));
  return { state, db, log, read, memory: memorySource(state) };
}

describe('the Source on SQLite (server/data/lite/source.ts)', () => {
  it('reads a list with no limit and gives its rows in insertion order, with no sort in SQL', async () => {
    const { read, memory, log } = await both();
    const s: Select = { c: 'tasks', where: [{ col: 'project_id', in: ['prj_002'] }] };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    expect(log.some((text) => /order by/.test(text))).toBe(false);
  });

  it('reads each key of a long in-list with one = statement, never more than 100 values', async () => {
    const { read, memory, log } = await both();
    const ids = Array.from({ length: 150 }, (_, i) => `tsk_${String(i + 1).padStart(3, '0')}`);
    const s: Select = { c: 'tasks', where: [{ col: 'id', in: ids }] };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    expect(log.filter((text) => text.includes('where t.id = ?'))).toHaveLength(150);
  });

  it('keeps the cut order of a per read in SQL, with order by and limit for each key', async () => {
    const { read, memory, log } = await both();
    const s: Select = { c: 'events', where: [{ col: 'project_id', in: ['prj_001'] }], order: { col: 'seq', desc: true }, per: 'project_id', limit: 2 };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    expect(log.some((text) => text.endsWith('order by t.seq desc, t.rowid desc limit ?'))).toBe(true);
  });

  it('keeps every row that ties at the cut', async () => {
    const { read, memory } = await both();
    const s: Select = { c: 'updates', where: [{ col: 'project_id', in: ['prj_001', 'prj_002'] }], order: { col: 'created_at', desc: true }, per: 'project_id', limit: 1, ties: true };
    const rows = await read((src) => src.select(s));
    expect(rows).toEqual(await memory.select(s));
    expect(rows.map((row) => row.doc.id)).toEqual(['upd_003', 'upd_004', 'upd_006']);
  });

  it('reads events since a time on the created_at index, and cuts them in JavaScript', async () => {
    const { read, memory, log } = await both();
    const s: Select = { c: 'events', where: [{ col: 'created_at', atOrAfter: at(20) }], order: { col: 'seq', desc: true }, limit: 2 };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
    const sent = log.find((text) => text.includes('from events t'))!;
    expect(sent).toContain('indexed by events_created_at');
    expect(sent).not.toContain('limit');
  });

  it('takes only the picked fields, and leaves an absent field absent', async () => {
    const { read, memory } = await both();
    const s: Select = { c: 'tasks', where: [{ col: 'id', in: ['tsk_001'] }], pick: ['id', 'title', 'nothingHere'] };
    expect(await read((src) => src.select(s))).toEqual(await memory.select(s));
  });

  it('counts each value with one statement and leaves out the values with no row', async () => {
    const { read, memory } = await both();
    expect(await read((src) => src.count('comments', 'target_id', ['tsk_001', 'tsk_404']))).toEqual(await memory.count('comments', 'target_id', ['tsk_001', 'tsk_404']));
  });

  it('counts the rows after each bound of a bounds condition, the authors left out', async () => {
    const { read, memory } = await both();
    const s = { c: 'comments' as const, per: 'target_id', where: [{ col: 'target_type', eq: 'task' }, { bounds: { col: 'target_id', by: { tsk_001: { gt: at(1), after: { at: at(2), id: 'cmt_002' } }, tsk_404: { gt: '' } } } }, { field: 'authorId', notIn: ['usr_002'] }] };
    expect(await read((src) => src.countWhere(s))).toEqual(await memory.countWhere(s));
  });

  it('counts the events of a period with an exact upper bound (atBefore), the same as the memory source', async () => {
    const { read, memory } = await both();
    const s = { c: 'events' as const, per: 'verb', where: [{ col: 'created_at', atOrAfter: at(15) }, { col: 'created_at', atBefore: at(35) }] };
    expect(await read((src) => src.countWhere(s))).toEqual(await memory.countWhere(s));
    expect(await memory.countWhere(s)).toEqual(new Map([['task.updated', 2]]));
  });

  it('finds the first row that holds an id at each kind of reference path', async () => {
    const { read, memory } = await both();
    const cases: [Parameters<ReturnType<typeof liteSource>['referencing']>[0], string, string][] = [
      ['tasks', 'ownerId', 'usr_001'], ['comments', 'reactions.*[]', 'usr_009'], ['files', 'versions[].openedBy', 'usr_004'], ['tasks', 'helperIds[]', 'usr_404'],
    ];
    for (const [c, path, id] of cases) expect(await read((src) => src.referencing(c, path, id, null)), path).toEqual(await memory.referencing(c, path, id, null));
  });

  it('gives the newest threads, newest first, with the ties at the cut', async () => {
    const { read, memory } = await both();
    const o = { owner: 'usr_001', led: ['prj_001'], me: ['usr_001'], limit: 100, admin: false };
    expect(await read((src) => src.threads(o))).toEqual(await memory.threads(o));
  });
});
