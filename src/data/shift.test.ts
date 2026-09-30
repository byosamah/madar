import { describe, expect, it } from 'vitest';
import { shiftState } from './shift';
import { buildSeed } from './seed';
import { healthCounts } from '../test/seed-helpers';
import { Stamp } from '../api/contract/entities';
import { addDays, dayOfWeek } from '../lib/dates';
import { TODAY } from '../test/factories';

describe('shiftState', () => {
  it('moves days and stamps, keeps weeks on Sunday and keeps the health mix', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const task = Object.values(state.tasks).find((t) => t.dueDate !== null)!;
    const key = 'usr_005|2026-09-27|prj_001|stg_004|-';
    state.timeRows[key] = { key, userId: 'usr_005', weekStart: '2026-09-27', projectId: 'prj_001', stageId: 'stg_004', taskId: null };
    const moved = shiftState(structuredClone(state), 10);
    expect(moved.tasks[task.id].dueDate).toBe(addDays(task.dueDate!, 10));
    expect(moved.seededOn).toBe(addDays(state.seededOn, 10));
    expect(Stamp.safeParse(moved.tasks[task.id].createdAt).success).toBe(true);
    for (const row of Object.values(moved.timeRows)) {
      expect(dayOfWeek(row.weekStart)).toBe(0);
      expect(row.key.split('|')[1]).toBe(row.weekStart);
    }
    expect(healthCounts(moved, addDays(TODAY, 10))).toEqual(healthCounts(state, TODAY));
  });

  it('returns the same state for a zero shift', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    expect(shiftState(state, 0)).toBe(state);
  });
});
