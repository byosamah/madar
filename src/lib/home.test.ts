import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../api/contract/views';
import { makeTask, STAMP } from '../test/factories';
import { dayRing, greetingKey, nextForYou } from './home';

const TODAY = '2026-09-30';
const row = (id: string, patch: Partial<TaskRow['task']>, overdue = false): TaskRow => ({
  task: makeTask({ id, ...patch }),
  owner: { id: 'usr_003', name: 'Sara Team', avatarUrl: null, kind: 'human', discipline: 'Architect' },
  project: { id: 'prj_001', code: 'KH-26-001', name: 'Test Tower', mark: 0 },
  stage: { id: 'stg_002', name: 'Schematic Design' },
  commentCount: 0, fileCount: 0, overdue, canMove: true,
});

describe('Next for you', () => {
  const base = { review: [], mine: [], today: TODAY };
  const late1 = row('tsk_001', { dueDate: '2026-09-25', status: 'todo' }, true);
  const late2 = row('tsk_002', { dueDate: '2026-09-20', status: 'in_progress' }, true);
  const today = row('tsk_003', { dueDate: TODAY, status: 'todo' });
  const doing = row('tsk_004', { dueDate: '2026-10-05', status: 'in_progress' });
  const waiting = row('tsk_005', { status: 'in_review' });

  it('puts a review that waits for me first', () => {
    expect(nextForYou({ ...base, review: [waiting], mine: [late1, today] })).toMatchObject({ kind: 'review', row: waiting });
  });

  it('then my oldest past-due task, then a task due today, then work in progress', () => {
    expect(nextForYou({ ...base, mine: [late1, late2, today] })).toMatchObject({ kind: 'pastDue', row: late2 });
    expect(nextForYou({ ...base, mine: [doing, today] })).toMatchObject({ kind: 'dueToday', row: today });
    expect(nextForYou({ ...base, mine: [doing] })).toMatchObject({ kind: 'continue', row: doing });
  });

  it('says all is done when nothing is left', () => {
    expect(nextForYou(base)).toEqual({ kind: 'clear' });
  });

  it('never offers a task that waits for review or is done', () => {
    const inReview = row('tsk_006', { dueDate: '2026-09-20', status: 'in_review' }, false);
    const done = row('tsk_007', { dueDate: '2026-09-20', status: 'done' });
    expect(nextForYou({ ...base, mine: [inReview, done] })).toEqual({ kind: 'clear' });
  });
});

describe('day ring', () => {
  it('counts what I finished today against what today asks of me', () => {
    const doneToday = row('tsk_001', { status: 'done', completedAt: `${TODAY}T09:00:00.000+03:00` });
    const doneBefore = row('tsk_002', { status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' });
    const dueToday = row('tsk_003', { dueDate: TODAY, status: 'todo' });
    const late = row('tsk_004', { dueDate: '2026-09-28', status: 'todo' }, true);
    const later = row('tsk_005', { dueDate: '2026-10-08', status: 'todo' });
    const waiting = row('tsk_006', { dueDate: '2026-09-28', status: 'in_review' });
    expect(dayRing([doneToday, doneBefore, dueToday, late, later], TODAY)).toEqual({ done: 1, total: 3 });
    // A task I sent to review fills the ring: the member's part is done.
    expect(dayRing([doneToday, dueToday, late, waiting], TODAY)).toEqual({ done: 2, total: 4 });
    expect(dayRing([later], TODAY)).toEqual({ done: 0, total: 0 });
    expect(STAMP.startsWith(TODAY)).toBe(true);
  });
});

describe('greeting', () => {
  it('follows the hour in office time', () => {
    expect(greetingKey(8)).toBe('morning');
    expect(greetingKey(13)).toBe('afternoon');
    expect(greetingKey(19)).toBe('evening');
  });
});
