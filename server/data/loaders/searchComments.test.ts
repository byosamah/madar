import { beforeAll, describe, expect, it } from 'vitest';
import { emptyReactions } from '../../../src/api/contract/entities';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { snapshotOf } from '../officeCache';
import { Load } from './build';
import { memorySource } from './memorySource';
import type { Select } from './query';
import { searchQuery } from './overview';
import type { Source } from './source';

/**
 * The comment read of search.query (chat design 2026-10-19, item 16). Postgres keeps the stored project of a comment after its task
 * goes, so a read of the newest comments can name a task that the load does not hold. The loader then reads again without that
 * task, until no read names a missing task. The memory form gives such a comment no project, so this test adds the row that Postgres
 * would give: the first read of the comments gets one more row, a newer comment of the deleted task tsk_gone.
 */
let seed: State;

beforeAll(async () => {
  seed = await buildSeed('2026-10-04', async () => undefined);
});

describe('the comments of search.query on a deleted task', () => {
  it('reads the comments again without a deleted task, until no read finds one', async () => {
    const state = structuredClone(seed);
    const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_001')!;
    state.comments.cmt_901 = {
      id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_002', body: 'The riser moved', reactions: emptyReactions(), fileIds: [],
      createdAt: '2026-10-04T08:00:00.000+03:00', editedAt: null,
    };
    const inner = memorySource(state);
    const asked: Select[] = [];
    const ghost = { ord: 99_999, doc: { id: 'cmt_999', targetType: 'task', targetId: 'tsk_gone', authorId: 'usr_002', body: 'The riser of a gone task', createdAt: '2026-10-04T09:00:00.000+03:00', editedAt: null, reactions: {} } };
    const src: Source = {
      ...inner,
      async select(s) {
        asked.push(s);
        const rows = await inner.select(s);
        const gone = s.where.some((cond) => 'col' in cond && cond.col === 'target_id' && 'notIn' in cond && cond.notIn.includes('tsk_gone'));
        const projectRead = s.c === 'comments' && s.where.some((cond) => 'col' in cond && cond.col === 'project_id' && 'in' in cond && cond.in.length > 0);
        return projectRead && !gone ? [...rows, ghost] : rows;
      },
    };
    const L = new Load({ src, office: snapshotOf(state, 1), actorId: 'usr_003', write: false });
    await searchQuery(L, { text: 'riser' });
    const reads = asked.filter((s) => s.c === 'comments' && s.where.some((cond) => 'col' in cond && cond.col === 'project_id' && 'in' in cond));
    expect(reads).toHaveLength(2);
    expect(reads[1].where).toContainEqual({ col: 'target_id', notIn: ['tsk_gone'] });
    // The handler sees the comment of the task that exists, and the load holds the task of it.
    const loaded = await L.state();
    expect(loaded.tasks[task.id]).toBeDefined();
    expect(loaded.tasks.tsk_gone).toBeUndefined();
  });

  it('makes one read of the comments of project tasks when every task exists', async () => {
    const state = structuredClone(seed);
    const task = Object.values(state.tasks).find((t) => t.projectId === 'prj_001')!;
    state.comments.cmt_901 = {
      id: 'cmt_901', targetType: 'task', targetId: task.id, authorId: 'usr_002', body: 'The riser moved', reactions: emptyReactions(), fileIds: [],
      createdAt: '2026-10-04T08:00:00.000+03:00', editedAt: null,
    };
    const asked: Select[] = [];
    const inner = memorySource(state);
    const src: Source = { ...inner, async select(s) { asked.push(s); return inner.select(s); } };
    await searchQuery(new Load({ src, office: snapshotOf(state, 1), actorId: 'usr_003', write: false }), { text: 'riser' });
    expect(asked.filter((s) => s.c === 'comments' && s.where.some((cond) => 'col' in cond && cond.col === 'project_id' && 'in' in cond))).toHaveLength(1);
  });

  it('reads no comment for a query with no word of 3 letters', async () => {
    const asked: Select[] = [];
    const inner = memorySource(seed);
    const src: Source = { ...inner, async select(s) { asked.push(s); return inner.select(s); } };
    await searchQuery(new Load({ src, office: snapshotOf(seed, 1), actorId: 'usr_003', write: false }), { text: 'ri' });
    expect(asked.filter((s) => s.c === 'comments' || s.c === 'messages')).toEqual([]);
  });
});
