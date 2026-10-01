import { describe, expect, it } from 'vitest';
import { shiftState } from './shift';
import { buildSeed } from './seed';
import { healthCounts } from '../test/seed-helpers';
import { Stamp } from '../api/contract/entities';
import { addDays } from '../lib/dates';
import { NOW, TODAY } from '../test/factories';
import { runScheduledTriggers } from '../api/notify';

describe('shiftState', () => {
  it('moves days and stamps and keeps the health mix', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const task = Object.values(state.tasks).find((t) => t.dueDate !== null)!;
    const moved = shiftState(structuredClone(state), 10);
    expect(moved.tasks[task.id].dueDate).toBe(addDays(task.dueDate!, 10));
    expect(moved.seededOn).toBe(addDays(state.seededOn, 10));
    expect(Stamp.safeParse(moved.tasks[task.id].createdAt).success).toBe(true);
    expect(healthCounts(moved, addDays(TODAY, 10))).toEqual(healthCounts(state, TODAY));
  });

  it('returns the same state for a zero shift', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    expect(shiftState(state, 0)).toBe(state);
  });

  it('keeps sent reminders from coming back after a shift', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    runScheduledTriggers(state, NOW);
    const moved = shiftState(structuredClone(state), 10);
    expect(runScheduledTriggers(moved, new Date(NOW.getTime() + 10 * 86_400_000))).toBe(0);
  });

  it('never changes text that people typed, even when it looks like a date', async () => {
    const state = await buildSeed(TODAY, async () => undefined);
    const task = Object.values(state.tasks)[0];
    task.title = '2026-09-30';
    const moved = shiftState(structuredClone(state), 10);
    expect(moved.tasks[task.id].title).toBe('2026-09-30');
  });
});
