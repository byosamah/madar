import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../../api/contract/views';
import { boardRows, doneWindow } from './boardRows';

/** A minimal row: the board only reads the id, the status and the finish stamp. */
const row = (id: string, status: TaskRow['task']['status'], completedAt: string | null = null): TaskRow => ({ task: { id, status, completedAt } } as unknown as TaskRow);

describe('the rows of the Tasks board', () => {
  it('puts the to-dos that wait for my review first, then my open to-dos, then my finished to-dos', () => {
    const rows = boardRows([row('a', 'todo'), row('b', 'in_progress')], [row('r', 'in_review')], [row('d', 'done', '2026-09-28T10:00:00.000+03:00')]);
    expect(rows.map((item) => item.task.id)).toEqual(['r', 'a', 'b', 'd']);
  });

  it('shows a to-do once when it is mine and also waits for my review', () => {
    const rows = boardRows([row('a', 'in_review'), row('b', 'todo')], [row('a', 'in_review')], []);
    expect(rows.map((item) => item.task.id)).toEqual(['a', 'b']);
  });

  it('puts the newest finished to-do first', () => {
    const rows = boardRows([], [], [
      row('old', 'done', '2026-09-25T09:00:00.000+03:00'),
      row('new', 'done', '2026-09-29T09:00:00.000+03:00'),
      row('mid', 'done', '2026-09-27T09:00:00.000+03:00'),
    ]);
    expect(rows.map((item) => item.task.id)).toEqual(['new', 'mid', 'old']);
  });

  it('asks for the done to-dos of the last 7 days: today and the 6 days before', () => {
    expect(doneWindow('2026-09-30')).toEqual({ filter: 'mine', status: ['done'], includeDone: true, doneFrom: '2026-09-24' });
    expect(doneWindow('2026-10-02').doneFrom).toBe('2026-09-26');
  });
});
