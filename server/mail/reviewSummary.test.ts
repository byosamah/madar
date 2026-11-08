import { describe, expect, it } from 'vitest';
import { reviewersOfTask } from '../../src/api/notify';
import type { State } from '../../src/api/store';
import { buildSeed } from '../../src/data/seed';
import { freshLite } from '../data/lite/testDb';
import { liteWriteState } from '../data/lite/whole';
import { SUMMARY_COUNTS_SQL, buildSummary } from './summary';

/**
 * The reviews in the morning summary follow the rule of fbk_087 (owner 2026-11-08): the stored sender of a to-do in review decides who
 * reviews it. The SQLite form runs here on real documents and must give the same answer as reviewersOfTask for every person. The
 * Postgres form is the same rule in SQL: server/it/email.it.test.ts runs it on the database against reviewersOfTask, and
 * the text checks below pin its parts.
 */

const TODAY = '2026-10-05';

describe('the SQLite form of the review count', () => {
  it('counts a review for the person that reviewersOfTask names, for a stored sender and for none', async () => {
    const lite = await freshLite();
    const seed = await buildSeed('2026-10-04', async () => undefined);
    // Drop the sample reviews, then add the cases of the rule. prj_001 is led by usr_002.
    for (const task of Object.values(seed.tasks)) if (task.status === 'in_review') seed.tasks[task.id] = { ...task, status: 'in_progress' };
    const base = Object.values(seed.tasks).find((t) => t.projectId === 'prj_001')!;
    const office = { ...base, projectId: null, stageId: null };
    const cases: [string, Partial<typeof base>][] = [
      ['project, lead sent', { ownerId: 'usr_003', reviewSentBy: 'usr_003' }],
      ['project, helper sent', { ownerId: 'usr_003', helperIds: ['usr_006'], reviewSentBy: 'usr_006' }],
      ['project, leader leads and sent', { ownerId: 'usr_002', reviewSentBy: 'usr_002' }],
      ['project, no stored sender', { ownerId: 'usr_003' }],
    ];
    const officeCases: [string, Partial<typeof base>][] = [
      ['office, lead sent', { ownerId: 'usr_003', createdBy: 'usr_006', reviewSentBy: 'usr_003' }],
      ['office, helper sent', { ownerId: 'usr_001', createdBy: 'usr_006', helperIds: ['usr_006'], reviewSentBy: 'usr_006' }],
      ['office, maker leads and sent', { ownerId: 'usr_006', createdBy: 'usr_006', reviewSentBy: 'usr_006' }],
      ['office, no stored sender', { ownerId: 'usr_003', createdBy: 'usr_006' }],
    ];
    let n = 0;
    for (const [from, list] of [[base, cases], [office, officeCases]] as const) {
      for (const [, change] of list) {
        n += 1;
        const id = `tsk_9${n}`;
        seed.tasks[id] = { ...from, id, status: 'in_review', helperIds: [], ...change } as typeof base;
      }
    }
    await lite.db.tx('write', (q) => liteWriteState(q, seed));
    const reviewing = Object.values(seed.tasks).filter((t) => t.status === 'in_review');
    expect(reviewing).toHaveLength(8);
    let seen = 0;
    for (const person of Object.values(seed.users).filter((u) => u.active && u.kind === 'human')) {
      const expected = reviewing.filter((t) => reviewersOfTask(seed as unknown as State, t).includes(person.id)).length;
      const summary = await lite.db.tx('read', (q) => buildSummary(q, person, TODAY));
      expect({ id: person.id, reviews: summary?.reviewsWaiting ?? 0 }).toEqual({ id: person.id, reviews: expected });
      seen += expected;
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('the Postgres form of the review count', () => {
  const reviews = SUMMARY_COUNTS_SQL.split('as due_today,')[1];

  it('reads the stored sender of the to-do in both parts, and keeps the old rule for a to-do with none', () => {
    const [projectPart, officePart] = reviews.split(/\n  \+ \(select/);
    for (const part of [projectPart, officePart]) {
      expect(part).toContain("t.doc->>'reviewSentBy' is null");
      expect(part).toContain("t.owner_id is distinct from t.doc->>'reviewSentBy'");
      expect(part).toContain("$1 <> t.doc->>'reviewSentBy'");
    }
    expect(projectPart).toContain('l.id = any($3::text[])');
    expect(projectPart).toContain('left join users pl on pl.id = p.leader_id and pl.active');
    expect(officePart).toContain('m.id <> t.doc->>\'reviewSentBy\'');
  });
});
