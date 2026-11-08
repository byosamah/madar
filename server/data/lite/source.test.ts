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

async function both(edit?: (state: State) => void) {
  const state = office();
  edit?.(state);
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

  it('cuts an ascending read in SQL with order by asc and limit, as the memory source does', async () => {
    const { read, memory, log } = await both();
    const s: Select = { c: 'events', where: [{ col: 'id', in: ['evt_002', 'evt_003', 'evt_004'] }], order: { col: 'created_at', asc: true, id: true }, limit: 2 };
    const rows = await read((src) => src.select(s));
    expect(rows.map((row) => row.doc.id)).toEqual((await memory.select(s)).map((row) => row.doc.id));
    expect(rows.map((row) => row.doc.id)).toEqual(['evt_002', 'evt_003']);
    expect(log.some((text) => text.includes('order by t.created_at asc, t.id asc limit ?'))).toBe(true);
  });

  it('refuses an ascending read with ties in the memory and the SQLite form', async () => {
    const { read, memory } = await both();
    const s: Select = { c: 'events', where: [], order: { col: 'created_at', asc: true }, limit: 2, ties: true };
    await expect(memory.select(s)).rejects.toThrow('An ascending read takes no ties.');
    await expect(read((src) => src.select(s))).rejects.toThrow('An ascending read takes no ties.');
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

  it('keeps a row at another offset just before an upper bound (atBefore), so the text bound drops no row', async () => {
    // The bound is 09:35 at +03:00, which is 06:35 UTC. Both new rows are before it in time.
    // Their local text sorts after the local text of the bound. A text bound on the local time would drop the +14:00 row.
    const { read, memory } = await both((state) => {
      Object.assign(state.events, {
        evt_801: { id: 'evt_801', seq: 801, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.updated', createdAt: '2026-10-16T20:00:00.000+14:00', undoneBy: null },
        evt_802: { id: 'evt_802', seq: 802, targetType: 'task', targetId: 'tsk_001', projectId: 'prj_001', verb: 'task.updated', createdAt: '2026-10-15T20:00:00.000-10:00', undoneBy: null },
      });
    });
    const s = { c: 'events' as const, per: 'verb', where: [{ col: 'created_at', atOrAfter: '2026-10-15T00:00:00+03:00' }, { col: 'created_at', atBefore: at(35) }] };
    expect(await memory.countWhere(s)).toEqual(new Map([['task.updated', 5]]));
    expect(await read((src) => src.countWhere(s))).toEqual(await memory.countWhere(s));
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
    const o = { owner: 'usr_001', led: ['prj_001'], me: ['usr_001'], limit: 100, admin: false, seen: ['prj_001', 'prj_002', 'prj_003'] };
    expect(await read((src) => src.threads(o))).toEqual(await memory.threads(o));
  });

  it('gives a helper and a person named with @ the thread, and a quiet line that holds a name nothing (chat, 2026-11-08)', async () => {
    const { read, memory } = await both((state) => {
      state.tasks.tsk_005.helperIds = ['usr_007'];
      const note = (id: string, taskId: string, body: string, extra: Record<string, unknown> = {}) => {
        state.comments[id] = { id, targetType: 'task', targetId: taskId, authorId: 'usr_001', body, createdAt: at(20), reactions: {}, ...extra } as never;
      };
      note('cmt_031', 'tsk_005', 'Please help.');
      note('cmt_032', 'tsk_006', 'Look at this @[Third](usr_008) please.');
      note('cmt_033', 'tsk_007', 'The reason names @[Fourth](usr_009).', { kind: 'reopened' });
      note('cmt_034', 'tsk_008', 'Looks like a name but is not: ](usr_010) and no mark.');
    });
    const base = { led: [] as string[], limit: 100, admin: false, seen: ['prj_001', 'prj_002', 'prj_003'] };
    const idsFor = async (owner: string) => (await read((src) => src.threads({ ...base, owner, me: [owner] }))).map((thread) => thread.id);
    expect(await idsFor('usr_007')).toEqual(['tsk_005']);
    expect(await idsFor('usr_008')).toEqual(['tsk_006']);
    expect(await idsFor('usr_009')).toEqual([]);
    expect(await idsFor('usr_010')).toEqual([]);
    for (const owner of ['usr_001', 'usr_007', 'usr_008', 'usr_009', 'usr_010']) {
      expect(await read((src) => src.threads({ ...base, owner, me: [owner] })), owner).toEqual(await memory.threads({ ...base, owner, me: [owner] }));
    }
  });

  it('sets the time of a thread by its newest message, and by its newest line only when it has no message (chat, 2026-11-08)', async () => {
    const { read, memory } = await both((state) => {
      const note = (id: string, taskId: string, minute: number, extra: Record<string, unknown> = {}) => {
        state.comments[id] = { id, targetType: 'task', targetId: taskId, authorId: 'usr_001', body: id, createdAt: at(minute), reactions: {}, ...extra } as never;
      };
      note('cmt_051', 'tsk_005', 20);
      note('cmt_052', 'tsk_005', 40, { dates: { from: { startDate: null, dueDate: '2026-10-10' }, to: { startDate: null, dueDate: '2026-10-12' } } });
      note('cmt_053', 'tsk_006', 25, { kind: 'reopened' });
      note('cmt_054', 'tsk_006', 35, { kind: 'reopened' });
      note('cmt_055', 'tsk_007', 30);
    });
    const o = { owner: 'usr_001', led: [] as string[], me: ['usr_001'], limit: 100, admin: false, seen: ['prj_001', 'prj_002', 'prj_003'] };
    const found = await read((src) => src.threads(o));
    expect(found.find((thread) => thread.id === 'tsk_005')?.last).toBe(at(20));
    expect(found.find((thread) => thread.id === 'tsk_006')?.last).toBe(at(35));
    expect(found.find((thread) => thread.id === 'tsk_007')?.last).toBe(at(30));
    expect(found).toEqual(await memory.threads(o));
  });

  it('reads the names of a body with the same rule as the memory source (field names)', async () => {
    const { read, memory } = await both((state) => {
      state.comments.cmt_041 = { id: 'cmt_041', targetType: 'task', targetId: 'tsk_002', authorId: 'usr_001', body: 'Hello @[Omar Other](usr_004) and @[Sara](usr_003).', createdAt: at(21), reactions: {} } as never;
      state.comments.cmt_042 = { id: 'cmt_042', targetType: 'task', targetId: 'tsk_003', authorId: 'usr_001', body: 'No mark: usr_004', createdAt: at(22), reactions: {} } as never;
    });
    for (const who of ['usr_004', 'usr_003', 'usr_001']) {
      const s: Select = { c: 'comments', where: [{ col: 'target_type', eq: 'task' }, { field: 'body', names: who }] };
      expect((await read((src) => src.select(s))).map((row) => row.doc.id), who).toEqual((await memory.select(s)).map((row) => row.doc.id));
    }
    const s: Select = { c: 'comments', where: [{ field: 'body', names: 'usr_004' }] };
    expect((await memory.select(s)).map((row) => row.doc.id)).toEqual(['cmt_041']);
  });

  it('leaves out the threads of a project that the person does not see, the same as the memory source (hidden projects)', async () => {
    const { read, memory } = await both();
    // tsk_001 is in prj_002, and the person commented on it: the thread shows only while prj_002 is in "seen".
    const base = { owner: 'usr_003', led: [] as string[], me: ['usr_003'], limit: 100, admin: false };
    const shown = await read((src) => src.threads({ ...base, seen: ['prj_001', 'prj_002'] }));
    expect(shown.map((thread) => thread.id)).toEqual(['tsk_001']);
    expect(shown).toEqual(await memory.threads({ ...base, seen: ['prj_001', 'prj_002'] }));
    for (const seen of [['prj_001', 'prj_003'], []]) {
      expect(await read((src) => src.threads({ ...base, seen }))).toEqual([]);
      expect(await memory.threads({ ...base, seen })).toEqual([]);
    }
  });
});
