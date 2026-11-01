import { beforeAll, describe, expect, it } from 'vitest';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { call, world } from './bulk.testing';
import { INSTRUCTIONS, TOOL_DOCS } from './docs';

/**
 * The busy-week rule of an agent (tsk_499, owner 2026-11-01): before it adds a to-do with a lead and a due date, or changes the lead or the due
 * date of a to-do, it reads tasks.list for that lead and the week, and asks its person when the lead has other work in that week or past due.
 * The screens show the same note. These tests pin the words of the rule, and the read that the rule names.
 */
let seed: State;
beforeAll(async () => {
  seed = await buildSeed('2026-09-30', async () => undefined);
});

describe('the busy-week rule in the texts for agents', () => {
  const line = () => INSTRUCTIONS.split('\n').find((text) => text.startsWith('Busy week: '))!;

  it('has one INSTRUCTIONS line that names the four writes, the read, the week, the people to ask and the two answers', () => {
    expect(line()).toBeDefined();
    for (const word of ['tasks.create', 'tasks.createMany', 'tasks.update', 'tasks.updateMany', 'tasks.list', 'ownerId', 'whose ownerId is the lead', 'todo, in_progress', 'includeDone false', 'dueTo', 'Saturday', 'Sunday', 'before today', 'your person', 'add it anyway', 'pick another date', 'before you write']) {
      expect(line(), word).toContain(word);
    }
    expect(line()).not.toMatch(/[–—]/);
  });

  it('has one short sentence in the docs of the four writes, inside the length limit', () => {
    for (const name of ['tasks.create', 'tasks.update', 'tasks.createMany', 'tasks.updateMany']) {
      const doc = TOOL_DOCS[name].description;
      expect(doc, name).toContain('Check Busy week first.');
      expect(doc.length, name).toBeLessThanOrEqual(600);
      expect(doc, name).not.toMatch(/[–—]/);
    }
  });
});

describe('the read that the rule names', () => {
  it('gives an agent the rows of the lead in the week and the past due ones, with the ownerId and the due date', async () => {
    const w = world(seed, 'usr_002', (state) => {
      const base = { description: '', status: 'todo' as const, flagged: false, needsReview: false, checklist: [] as never[], createdBy: 'usr_002', createdAt: '2026-09-29T09:00:00.000+03:00', completedAt: null, projectId: 'prj_001', stageId: 'stg_005' };
      state.tasks.tsk_901 = { ...base, id: 'tsk_901', title: 'Roof plan', ownerId: 'usr_005', dueDate: '2027-03-09' };
      state.tasks.tsk_902 = { ...base, id: 'tsk_902', title: 'Helped plan', ownerId: 'usr_006', helperIds: ['usr_005'], dueDate: '2027-03-10' };
      state.tasks.tsk_903 = { ...base, id: 'tsk_903', title: 'Later plan', ownerId: 'usr_005', dueDate: '2027-03-20' };
    });
    const result = await call(w, 'tasks.list', { ownerId: 'usr_005', status: ['todo', 'in_progress'], includeDone: false, dueTo: '2027-03-13' });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const rows = (result.structuredContent.output as { rows?: Array<{ id: string; title: string; ownerId: string | null; dueDate: string | null }> }).rows
      ?? (result.structuredContent.output as Array<{ id: string; title: string; ownerId: string | null; dueDate: string | null }>);
    const mine = rows.filter((row) => row.id === 'tsk_901' || row.id === 'tsk_902' || row.id === 'tsk_903');
    // The week ends on Saturday 13 Mar: a later to-do is not in the read. A to-do where the person only helps is in the read, and its ownerId tells it apart.
    expect(mine.map((row) => row.id).sort()).toEqual(['tsk_901', 'tsk_902']);
    expect(mine.find((row) => row.id === 'tsk_901')).toMatchObject({ title: 'Roof plan', dueDate: '2027-03-09' });
    expect(mine.find((row) => row.id === 'tsk_901')!.ownerId).toBe('usr_005');
    expect(mine.find((row) => row.id === 'tsk_902')!.ownerId).toBe('usr_006');
  });
});
