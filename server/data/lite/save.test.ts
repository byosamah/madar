import { describe, expect, it } from 'vitest';
import type { State } from '../../../src/api/store';
import { buildSeed } from '../../../src/data/seed';
import { TABLES } from '../tables';
import { liteSave } from './save';
import { freshLite } from './testDb';
import { liteLoadWhole, liteWriteState } from './whole';

const TODAY = '2026-10-04';
const seedOf = () => buildSeed(TODAY, async () => undefined);

async function officeWithSeed() {
  const lite = await freshLite();
  const seed = await seedOf();
  await lite.db.tx('write', (q) => liteWriteState(q, seed));
  lite.log.length = 0;
  return { ...lite, seed };
}

describe('the save step on SQLite (server/data/lite/save.ts)', () => {
  it('writes the sample office and reads it back the same, in the same order', async () => {
    const { db, seed } = await officeWithSeed();
    const back = await db.tx('read', (q) => liteLoadWhole(q, { today: seed.seededOn }));
    for (const spec of TABLES) {
      const want = spec.collection === 'settings' ? seed.settings : (seed[spec.collection] ?? {});
      expect(back[spec.collection], spec.table).toEqual(want);
      if (spec.collection !== 'settings') expect(Object.keys(back[spec.collection] ?? {}), spec.table).toEqual(Object.keys(want as object));
    }
    expect(back.counters).toEqual(seed.counters);
  });

  it('sets doc and only the key columns that changed', async () => {
    const { db, seed, log } = await officeWithSeed();
    const task = Object.values(seed.tasks).find((t) => t.projectId !== null && t.status !== 'done')!;
    const write = async (change: Partial<typeof task>) => {
      const before = await db.tx('read', (q) => liteLoadWhole(q));
      const after = structuredClone(before) as State;
      after.tasks[task.id] = { ...after.tasks[task.id], ...change };
      log.length = 0;
      await db.tx('write', (q) => liteSave(q, before, after, { signals: false }));
      return log.filter((text) => text.startsWith('update tasks'));
    };
    expect(await write({ rank: 7 })).toEqual(['update tasks set doc = ? where id = ?']);
    expect(await write({ title: `${task.title} (B)` })).toEqual(['update tasks set doc = ?, search_text = ? where id = ?']);
    expect(await write({ status: task.status === 'todo' ? 'in_progress' : 'todo' })).toEqual(['update tasks set doc = ?, status = ? where id = ?']);
  });

  it('inserts new rows in State order, so they come last in insertion order', async () => {
    const { db, seed } = await officeWithSeed();
    const base = Object.values(seed.tasks)[0];
    const after = structuredClone(seed);
    after.tasks.tsk_901 = { ...base, id: 'tsk_901' };
    after.tasks.tsk_900 = { ...base, id: 'tsk_900' };
    await db.tx('write', (q) => liteSave(q, seed, after, { signals: false }));
    const back = await db.tx('read', (q) => liteLoadWhole(q));
    expect(Object.keys(back.tasks).slice(-2)).toEqual(['tsk_901', 'tsk_900']);
  });

  it('writes the office snapshot in the save of an office change, and none in the save of a task', async () => {
    const { db, seed, log } = await officeWithSeed();
    const project = Object.values(seed.projects)[0];
    const renamed = structuredClone(seed);
    renamed.projects[project.id] = { ...project, name: `${project.name} (B)` };
    const saved = await db.tx('write', (q) => liteSave(q, seed, renamed, { signals: false }));
    expect(saved.officeVersion).toBeGreaterThan(0);
    expect(log.some((text) => text.startsWith('insert into office_snapshot'))).toBe(true);
    log.length = 0;
    const task = Object.values(renamed.tasks)[0];
    const moved = structuredClone(renamed);
    moved.tasks[task.id] = { ...task, rank: 3 };
    await db.tx('write', (q) => liteSave(q, renamed, moved, { signals: false }));
    expect(log.some((text) => text.includes('office_snapshot'))).toBe(false);
  });

  it('fills the project of a comment whose target the call did not load', async () => {
    const { db, seed } = await officeWithSeed();
    const task = Object.values(seed.tasks).find((t) => t.projectId !== null)!;
    const base = Object.values(seed.comments).find((c) => c.targetType === 'task')!;
    const before = structuredClone(seed);
    delete before.tasks[task.id];
    const after = structuredClone(before);
    after.comments.cmt_900 = { ...base, id: 'cmt_900', targetId: task.id };
    await db.tx('write', (q) => liteSave(q, before, after, { signals: false }));
    expect(await db.statement('read', "select project_id from comments where id = 'cmt_900'")).toEqual([{ project_id: task.projectId }]);
  });

  it('gives the numbers and signals of writeDiff: a new office version, office_seq and a person number', async () => {
    const { db, seed } = await officeWithSeed();
    const project = Object.values(seed.projects)[0];
    const after = structuredClone(seed);
    after.projects[project.id] = { ...project, name: `${project.name} (C)` };
    const saved = await db.tx('write', (q) => liteSave(q, seed, after, { story: { storyId: 'sty_test', actorId: 'usr_001' } }));
    expect(saved.changed).toBe(true);
    expect(saved.signals.find((signal) => signal.channel === 'office')?.seq).toBe(1);
    const [meta] = await db.statement<{ version: number; office_seq: number }>('read', 'select version, office_seq from office_meta');
    expect(meta).toEqual({ version: saved.officeVersion, office_seq: 1 });
  });
});
