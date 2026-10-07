import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../api/contract/views';
import { makeTask, STAMP } from '../test/factories';
import { comingUp, dayRing, dueByToday, greetingKey, nextForYou } from './home';

const TODAY = '2026-09-30';
const row = (id: string, patch: Partial<TaskRow['task']>, overdue = false): TaskRow => ({
  task: makeTask({ id, ...patch }),
  waitingFor: { tasks: [], stages: [] },
  owner: { id: 'usr_003', name: 'Sara Team', avatarUrl: null, kind: 'human', discipline: 'Architect' },
  helpers: [],
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

  // A helper cannot finish a task; only its lead can (owner decision C2). Home must not ask a helper to (audit PER-1).
  it('never offers a task the person helps on but cannot finish, and never counts it in the day ring', () => {
    const helping = { ...row('tsk_010', { dueDate: '2026-09-01', status: 'todo' }, true), canMove: false };
    expect(nextForYou({ ...base, mine: [helping, today] })).toMatchObject({ kind: 'dueToday', row: today });
    expect(dayRing([helping, today], TODAY)).toEqual({ done: 0, total: 1 });
  });

  // A task that waits for another task cannot move yet, so it is not the one next step (audit PER-2).
  it('skips a task that waits for another task or a stage', () => {
    const blocked = { ...row('tsk_011', { dueDate: '2026-09-01', status: 'todo' }, true), waitingFor: { tasks: [{ id: 'tsk_099', title: 'Survey' }], stages: [] } };
    expect(nextForYou({ ...base, mine: [blocked, doing] })).toMatchObject({ kind: 'continue', row: doing });
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

describe('coming up (owner, 2026-10-07)', () => {
  it('gives my next 3 open tasks with a date after today, soonest first', () => {
    const later3 = row('tsk_001', { dueDate: '2026-10-09', status: 'todo' });
    const later1 = row('tsk_002', { dueDate: '2026-10-01', status: 'in_progress' });
    const later4 = row('tsk_003', { dueDate: '2026-10-20', status: 'todo' });
    const later2 = row('tsk_004', { dueDate: '2026-10-05', status: 'todo' });
    const ids = (rows: TaskRow[]) => rows.map((item) => item.task.id);
    expect(ids(comingUp([later3, later1, later4, later2], TODAY))).toEqual(['tsk_002', 'tsk_004', 'tsk_001']);
  });

  it('leaves out today, past due, no date, review, done and the tasks I only help with', () => {
    const today = row('tsk_001', { dueDate: TODAY, status: 'todo' });
    const late = row('tsk_002', { dueDate: '2026-09-28', status: 'todo' }, true);
    const noDate = row('tsk_003', { dueDate: null, status: 'todo' });
    const review = row('tsk_004', { dueDate: '2026-10-05', status: 'in_review' });
    const done = row('tsk_005', { dueDate: '2026-10-05', status: 'done' });
    const helper = { ...row('tsk_006', { dueDate: '2026-10-05', status: 'todo' }), canMove: false };
    const later = row('tsk_007', { dueDate: '2026-10-06', status: 'todo' });
    expect(comingUp([today, late, noDate, review, done, helper, later], TODAY).map((item) => item.task.id)).toEqual(['tsk_007']);
  });
});

describe('the shared order on Home (owner, 2026-10-07)', () => {
  const placed = (id: string, patch: Partial<TaskRow['task']>, rank: number, overdue = false) => row(id, { ...patch, rank }, overdue);
  const ids = (rows: TaskRow[]) => rows.map((item) => item.task.id);

  it('lists the Today panel as the Tasks screen does: past due first, then today, each in the order', () => {
    const lateOld = row('tsk_001', { dueDate: '2026-09-20', status: 'todo' }, true);
    const latePlaced = placed('tsk_002', { dueDate: '2026-09-28', status: 'todo' }, 1000, true);
    const today = row('tsk_003', { dueDate: TODAY, status: 'todo' });
    const todayPlaced = placed('tsk_004', { dueDate: TODAY, status: 'todo' }, 5000);
    expect(ids(dueByToday([today, lateOld, todayPlaced, latePlaced], TODAY))).toEqual(['tsk_002', 'tsk_001', 'tsk_004', 'tsk_003']);
  });

  it('offers the top task of the order next', () => {
    const lateOld = row('tsk_001', { dueDate: '2026-09-20', status: 'todo' }, true);
    const latePlaced = placed('tsk_002', { dueDate: '2026-09-28', status: 'todo' }, 1000, true);
    expect(nextForYou({ review: [], mine: [lateOld, latePlaced], today: TODAY })).toMatchObject({ kind: 'pastDue', row: latePlaced });
    const first = row('tsk_003', { dueDate: TODAY, status: 'todo' });
    const second = placed('tsk_004', { dueDate: TODAY, status: 'todo' }, 1000);
    expect(nextForYou({ review: [], mine: [first, second], today: TODAY })).toMatchObject({ kind: 'dueToday', row: second });
  });

  it('lists Coming up with This week before Later, each in the order', () => {
    const fri = row('tsk_001', { dueDate: '2026-10-02', status: 'todo' });
    const thu = placed('tsk_002', { dueDate: '2026-10-01', status: 'todo' }, 2000);
    const sat = placed('tsk_003', { dueDate: '2026-10-03', status: 'todo' }, 1000);
    const later = placed('tsk_004', { dueDate: '2026-10-20', status: 'todo' }, 1);
    expect(ids(comingUp([fri, thu, sat, later], TODAY))).toEqual(['tsk_003', 'tsk_002', 'tsk_001']);
  });
});

describe('greeting', () => {
  it('follows the hour in office time', () => {
    expect(greetingKey(8)).toBe('morning');
    expect(greetingKey(13)).toBe('afternoon');
    expect(greetingKey(19)).toBe('evening');
  });
});
