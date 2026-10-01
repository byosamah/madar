import { describe, expect, it } from 'vitest';
import type { TaskRow } from '../api/contract/views';
import { makeTask } from '../test/factories';
import { currentWork, needsAttention, stageStanding } from './overview';

const TODAY = '2026-09-30';
const row = (id: string, patch: Partial<TaskRow['task']>): TaskRow => ({
  task: makeTask({ id, ownerId: 'usr_003', ...patch }),
  owner: { id: patch.ownerId ?? 'usr_003', name: 'Sara Team', avatarUrl: null, kind: 'human', discipline: 'Architect' },
  project: { id: 'prj_001', code: 'KH-26-001', name: 'Test Tower', mark: 0 },
  stage: { id: 'stg_002', name: 'Schematic Design' },
  commentCount: 0, fileCount: 0, overdue: false, canMove: true,
});

describe('project overview', () => {
  it('shows what a person works on now: in progress first, then the next task to do', () => {
    const rows = [
      row('tsk_001', { status: 'todo', dueDate: '2026-10-01' }),
      row('tsk_002', { status: 'in_progress', dueDate: '2026-10-09' }),
      row('tsk_003', { status: 'done' }),
      row('tsk_004', { status: 'todo', ownerId: 'usr_004' }),
    ];
    expect(currentWork(rows, 'usr_003')).toMatchObject({ now: { task: { id: 'tsk_002' } }, open: 2 });
    expect(currentWork([rows[0]], 'usr_003').now?.task.id).toBe('tsk_001');
    expect(currentWork(rows, 'usr_009')).toEqual({ now: null, open: 0 });
  });

  it('lists past-due, waiting-for-review and flagged work', () => {
    const late = row('tsk_001', { status: 'in_progress', dueDate: '2026-09-25' });
    const review = row('tsk_002', { status: 'in_review', dueDate: '2026-09-20' });
    const flagged = row('tsk_003', { status: 'todo', flagged: true });
    const doneFlag = row('tsk_004', { status: 'done', flagged: true });
    const result = needsAttention([late, review, flagged, doneFlag], TODAY);
    expect(result.pastDue.map((r) => r.task.id)).toEqual(['tsk_001']);
    expect(result.review.map((r) => r.task.id)).toEqual(['tsk_002']);
    expect(result.flagged.map((r) => r.task.id)).toEqual(['tsk_003']);
  });

  it('counts the stage tasks and the days left in the stage', () => {
    const rows = [row('tsk_001', { stageId: 'stg_002', status: 'done' }), row('tsk_002', { stageId: 'stg_002' }), row('tsk_003', { stageId: 'stg_003' })];
    expect(stageStanding(rows, { id: 'stg_002', endDate: '2026-10-05' }, TODAY)).toEqual({ done: 1, total: 2, daysLeft: 5 });
    expect(stageStanding(rows, { id: 'stg_002', endDate: '2026-09-28' }, TODAY).daysLeft).toBe(-2);
    expect(stageStanding(rows, { id: 'stg_002', endDate: null }, TODAY).daysLeft).toBeNull();
  });
});
