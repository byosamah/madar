import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../api/contract/views';
import { makeTask } from '../test/factories';
import { groupMyTasks, workGroupOf } from './myWork';

const TODAY = '2026-09-30'; // a Wednesday; the office week ends on Saturday 3 Oct
const row = (id: string, dueDate: string | null, overdue = false): TaskRow => ({
  task: makeTask({ id, dueDate }),
  waitingFor: { tasks: [], stages: [] },
  owner: { id: 'usr_003', name: 'Sara Team', avatarUrl: null, kind: 'human', discipline: 'Architect' },
  helpers: [],
  project: { id: 'prj_001', code: 'KH-26-001', name: 'Test Tower', mark: 0 },
  stage: { id: 'stg_002', name: 'Schematic Design' },
  commentCount: 0,
  fileCount: 0,
  overdue,
  canMove: true,
});

describe('My Work groups', () => {
  it('puts each task in one group', () => {
    expect(workGroupOf(row('tsk_001', '2026-09-25', true), TODAY)).toBe('overdue');
    expect(workGroupOf(row('tsk_002', '2026-09-28'), TODAY)).toBe('today');
    expect(workGroupOf(row('tsk_003', TODAY), TODAY)).toBe('today');
    expect(workGroupOf(row('tsk_004', '2026-10-03'), TODAY)).toBe('week');
    expect(workGroupOf(row('tsk_005', '2026-10-04'), TODAY)).toBe('later');
    expect(workGroupOf(row('tsk_006', null), TODAY)).toBe('none');
  });

  // The office works Sunday to Thursday. On Friday and Saturday, "This week" is the coming work week (audit BRW-9).
  it('on Friday and Saturday puts the coming Sunday to Thursday under This week', () => {
    const SATURDAY = '2026-10-03';
    expect(workGroupOf(row('tsk_007', '2026-10-04'), SATURDAY)).toBe('week');
    expect(workGroupOf(row('tsk_008', '2026-10-08'), SATURDAY)).toBe('week');
    expect(workGroupOf(row('tsk_009', '2026-10-11'), SATURDAY)).toBe('later');
    expect(workGroupOf(row('tsk_010', '2026-10-06'), '2026-10-02')).toBe('week');
  });

  it('keeps the group order and leaves out empty groups', () => {
    const groups = groupMyTasks([row('tsk_006', null), row('tsk_001', '2026-09-25', true)], TODAY);
    expect(groups.map((group) => group.group)).toEqual(['overdue', 'none']);
  });

  it('follows the shared order inside a group, and never moves a task to another group (owner, 2026-10-07)', () => {
    const placed = (id: string, dueDate: string, rank: number) => ({ ...row(id, dueDate), task: makeTask({ id, dueDate, rank }) });
    const groups = groupMyTasks([
      row('tsk_001', TODAY), placed('tsk_002', TODAY, 2000), placed('tsk_003', TODAY, 1000),
      row('tsk_004', '2026-10-01'), placed('tsk_005', '2026-10-02', 500),
    ], TODAY);
    expect(groups.map((group) => [group.group, group.rows.map((item) => item.task.id)])).toEqual([
      ['today', ['tsk_003', 'tsk_002', 'tsk_001']],
      ['week', ['tsk_005', 'tsk_004']],
    ]);
  });

  it('puts the tasks I only help with after the tasks I may move', () => {
    const helping = (id: string, rank?: number) => ({ ...row(id, TODAY), task: makeTask({ id, dueDate: TODAY, rank }), canMove: false });
    const [today] = groupMyTasks([helping('tsk_001', 1), row('tsk_002', TODAY), helping('tsk_003'), row('tsk_004', TODAY)], TODAY);
    expect(today.rows.map((item) => item.task.id)).toEqual(['tsk_002', 'tsk_004', 'tsk_001', 'tsk_003']);
  });
});
