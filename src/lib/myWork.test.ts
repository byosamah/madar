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

  it('keeps the group order and leaves out empty groups', () => {
    const groups = groupMyTasks([row('tsk_006', null), row('tsk_001', '2026-09-25', true)], TODAY);
    expect(groups.map((group) => group.group)).toEqual(['overdue', 'none']);
  });
});
