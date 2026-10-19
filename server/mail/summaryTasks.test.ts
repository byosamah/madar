import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../src/api/contract/views';
import { addDays } from '../../src/lib/dates';
import { workGroupOf } from '../../src/lib/myWork';
import { SUMMARY_LINES_MAX, TITLE_MAX, groupOpenTasks, weekEndOf, type OpenTask } from './summaryTasks';

/**
 * The open tasks of the morning email (fbk_021, owner 2026-10-19): three groups (Past due, Today, This week) with the rules of the
 * Work screen, the shared order inside a group, and at most 8 lines in all, past due first.
 */

// Sunday 2026-10-04 is a working day. Friday is 2026-10-09 and Saturday is 2026-10-10.
const SUN = '2026-10-04';

const task = (id: string, dueDate: string, more: Partial<OpenTask> = {}): OpenTask => ({ id, title: `Task ${id}`, dueDate, rank: null, projectCode: '260902AZT-RES-Villa', ...more });

describe('weekEndOf', () => {
  it('is the Saturday of this week on a working day', () => {
    expect(weekEndOf('2026-10-04')).toBe('2026-10-10'); // Sunday
    expect(weekEndOf('2026-10-08')).toBe('2026-10-10'); // Thursday
  });

  it('is the Saturday of the coming week on Friday and Saturday, as the Work screen says', () => {
    expect(weekEndOf('2026-10-09')).toBe('2026-10-17'); // Friday
    expect(weekEndOf('2026-10-10')).toBe('2026-10-17'); // Saturday
  });

  it('agrees with the group of the Work screen for every day of five weeks and every due day around it', () => {
    for (let offset = 0; offset < 35; offset += 1) {
      const today = addDays(SUN, offset);
      for (let gap = -3; gap <= 16; gap += 1) {
        const due = addDays(today, gap);
        const row = { overdue: due < today, task: { dueDate: due } } as unknown as TaskRow;
        const screen = workGroupOf(row, today);
        const mail = due < today ? 'overdue' : due === today ? 'today' : due <= weekEndOf(today) ? 'week' : 'later';
        expect({ today, due, group: mail }).toEqual({ today, due, group: screen });
      }
    }
  });
});

describe('groupOpenTasks', () => {
  it('puts each task in the group of its due day and leaves out a task that is due after this week', () => {
    const grouped = groupOpenTasks([task('a', '2026-10-01'), task('b', SUN), task('c', '2026-10-07'), task('d', '2026-10-11'), task('e', '2026-10-03')], SUN);
    expect(grouped.pastDue.map((l) => l.title)).toEqual(['Task a', 'Task e']);
    expect(grouped.today.map((l) => l.title)).toEqual(['Task b']);
    expect(grouped.week.map((l) => l.title)).toEqual(['Task c']);
    expect(grouped.more).toBe(0);
  });

  it('gives each line the title, the project key or null for an office task, and the due day', () => {
    const grouped = groupOpenTasks([
      task('a', SUN, { title: 'Check the setback', projectCode: '260902AZT-RES-Villa' }),
      task('b', SUN, { title: 'Renew the licence', projectCode: null }),
      task('c', SUN, { title: 'Send the survey', projectCode: 'KH-26-014' }),
    ], SUN);
    expect(grouped.today).toEqual([
      { title: 'Check the setback', where: '260902AZT', due: SUN },
      { title: 'Renew the licence', where: null, due: SUN },
      { title: 'Send the survey', where: 'KH-26-014', due: SUN },
    ]);
  });

  it('orders a group as the Tasks screen does: the tasks with a place first (lowest first), then by date and title', () => {
    const grouped = groupOpenTasks([
      task('a', '2026-10-02', { title: 'Beta' }),
      task('b', '2026-10-01', { title: 'Zeta' }),
      task('c', '2026-10-03', { title: 'Gamma', rank: 2 }),
      task('d', '2026-10-03', { title: 'Delta', rank: 1 }),
      task('e', '2026-10-01', { title: 'Alpha' }),
    ], SUN);
    expect(grouped.pastDue.map((l) => l.title)).toEqual(['Delta', 'Gamma', 'Alpha', 'Zeta', 'Beta']);
  });

  it('shows at most 8 lines in all, the past due first, and counts the rest', () => {
    expect(SUMMARY_LINES_MAX).toBe(8);
    const tasks = [
      ...Array.from({ length: 5 }, (_, i) => task(`p${i}`, '2026-10-01')),
      ...Array.from({ length: 3 }, (_, i) => task(`t${i}`, SUN)),
      ...Array.from({ length: 4 }, (_, i) => task(`w${i}`, '2026-10-07')),
      task('later', '2026-11-30'),
    ];
    const grouped = groupOpenTasks(tasks, SUN);
    expect(grouped.pastDue).toHaveLength(5);
    expect(grouped.today).toHaveLength(3);
    expect(grouped.week).toHaveLength(0);
    // 12 tasks are in the three groups; 8 show; the task due later is no part of the count.
    expect(grouped.more).toBe(4);
  });

  it('cuts the groups in order when the past due alone is more than 8', () => {
    const grouped = groupOpenTasks(Array.from({ length: 11 }, (_, i) => task(`p${i}`, '2026-10-01')).concat(task('t', SUN)), SUN);
    expect(grouped.pastDue).toHaveLength(8);
    expect(grouped.today).toHaveLength(0);
    expect(grouped.more).toBe(4);
  });

  it('gives nothing for no task', () => {
    expect(groupOpenTasks([], SUN)).toEqual({ pastDue: [], today: [], week: [], more: 0 });
  });

  it('keeps a title on one line and cuts a very long one', () => {
    const long = 'A'.repeat(TITLE_MAX + 40);
    const grouped = groupOpenTasks([task('a', SUN, { title: `  Check\n  the   ${long}  ` })], SUN);
    const [line] = grouped.today;
    expect(line.title.startsWith('Check the AAAA')).toBe(true);
    expect([...line.title]).toHaveLength(TITLE_MAX);
    expect(line.title.endsWith('…')).toBe(true);
    expect(line.title).not.toMatch(/\n/);
  });
});
