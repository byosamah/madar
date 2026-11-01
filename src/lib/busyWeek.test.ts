import { describe, expect, it } from 'vitest';
import { splitBusy, weekEndOf, type BusyRow } from './busyWeek';

// Today is Wednesday 2026-09-30. The office week runs from Sunday to Saturday.
const TODAY = '2026-09-30';
const row = (id: string, o: Partial<BusyRow['task']> = {}): BusyRow => ({
  task: { id, title: `To-do ${id}`, ownerId: 'usr_005', status: 'todo', dueDate: '2026-10-14', ...o },
});
const ask = { leadId: 'usr_005', due: '2026-10-14', today: TODAY };
const ids = (rows: BusyRow[]) => rows.map((r) => r.task.id);

describe('weekEndOf', () => {
  it('gives the Saturday of the week of a day', () => {
    expect(weekEndOf('2026-10-14')).toBe('2026-10-17'); // a Wednesday
    expect(weekEndOf('2026-10-11')).toBe('2026-10-17'); // the Sunday
    expect(weekEndOf('2026-10-17')).toBe('2026-10-17'); // the Saturday
    expect(weekEndOf('2026-12-30')).toBe('2027-01-02'); // across a year
  });
});

describe('splitBusy', () => {
  it('takes the to-dos due from the Sunday to the Saturday of the week of the due date, and no others', () => {
    const rows = [
      row('a', { dueDate: '2026-10-10' }), // the Saturday before
      row('b', { dueDate: '2026-10-11' }), // the Sunday
      row('c', { dueDate: '2026-10-17' }), // the Saturday
      row('d', { dueDate: '2026-10-18' }), // the Sunday after
    ];
    expect(ids(splitBusy(rows, ask).week)).toEqual(['b', 'c']);
  });

  it('sorts the week by due date and keeps the order of equal days', () => {
    const rows = [row('a', { dueDate: '2026-10-15' }), row('b', { dueDate: '2026-10-12' }), row('c', { dueDate: '2026-10-15' }), row('d', { dueDate: '2026-10-13' })];
    expect(ids(splitBusy(rows, ask).week)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('counts only the to-dos that the person leads, not the ones the person helps on', () => {
    const rows = [row('a'), row('b', { ownerId: 'usr_006' }), row('c', { ownerId: null })];
    expect(ids(splitBusy(rows, ask).week)).toEqual(['a']);
  });

  it('counts only open to-dos: to do and in progress, never in review or done', () => {
    const rows = [row('a', { status: 'todo' }), row('b', { status: 'in_progress' }), row('c', { status: 'in_review' }), row('d', { status: 'done' })];
    expect(ids(splitBusy(rows, ask).week)).toEqual(['a', 'b']);
  });

  it('never counts the open to-do itself', () => {
    expect(ids(splitBusy([row('a'), row('b')], { ...ask, openId: 'a' }).week)).toEqual(['b']);
  });

  it('leaves out a to-do with no due date', () => {
    expect(splitBusy([row('a', { dueDate: null })], ask)).toEqual({ week: [], pastDue: [] });
  });

  it('counts a to-do due before today as past due, and a to-do due after today but before the week as neither', () => {
    const rows = [
      row('old', { dueDate: '2026-09-01' }),
      row('yesterday', { dueDate: '2026-09-29' }),
      row('today', { dueDate: TODAY }), // due today is not past due
      row('soon', { dueDate: '2026-10-05' }), // after today, before the week of the due date
    ];
    const out = splitBusy(rows, ask);
    expect(ids(out.pastDue)).toEqual(['old', 'yesterday']);
    expect(out.week).toEqual([]);
  });

  it('lists a to-do once: a past due to-do inside the chosen week counts as past due only', () => {
    // The week of the 30th is Sunday 27 Sep to Saturday 3 Oct.
    const rows = [row('mon', { dueDate: '2026-09-28' }), row('thu', { dueDate: '2026-10-01' })];
    const out = splitBusy(rows, { ...ask, due: TODAY });
    expect(ids(out.pastDue)).toEqual(['mon']);
    expect(ids(out.week)).toEqual(['thu']);
  });

  it('answers an empty split while the rows are not there', () => {
    expect(splitBusy(undefined, ask)).toEqual({ week: [], pastDue: [] });
  });
});
