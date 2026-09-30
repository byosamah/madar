import { beforeEach, describe, expect, it } from 'vitest';
import { timeCalls } from './time';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const WEEK = '2026-09-27';

function sara() {
  const t = testApi(timeCalls);
  t.as('usr_003');
  return t;
}

describe('time calls', () => {
  it('shows an empty week with seven days and the target', async () => {
    const week = await sara().api.call('time.week', { weekStart: WEEK });
    expect(week.days).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(week).toMatchObject({ target: 40, locked: false, weekTotal: 0, rows: [] });
  });

  it('refuses a week that does not start on Sunday', async () => {
    await expect(sara().api.call('time.week', { weekStart: '2026-09-28' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('logs, changes and clears hours', async () => {
    const t = sara();
    const set = (hours: number) => t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours });
    let week = await set(7.5);
    expect(week.rows[0].hours).toEqual([0, 7.5, 0, 0, 0, 0, 0]);
    expect(week.dayTotals[1]).toBe(7.5);
    week = await set(8);
    expect(week.weekTotal).toBe(8);
    week = await set(0);
    expect(week.rows).toEqual([]);
    expect(Object.keys(t.store.state.time)).toHaveLength(0);
  });

  it('checks half-hour steps, 24 hours a day and future days', async () => {
    const t = sara();
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours: 0.3 })).rejects.toMatchObject({ code: 'invalid_input' });
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_001', date: '2026-09-28', hours: 20 });
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours: 5 })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['hours'] },
    });
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-10-01', hours: 1 })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['date'] },
    });
  });

  it('stops an outsider and a task from another stage', async () => {
    const t = testApi(timeCalls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_004');
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-28', hours: 1 })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_003');
    await expect(t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_001', taskId: 'tsk_001', date: '2026-09-28', hours: 1 })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['taskId'] },
    });
  });

  it('locks a week 14 days after it ends, until the Admin unlocks it', async () => {
    const t = sara();
    const log = (hours: number) => t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_002', date: '2026-09-14', hours });
    setNow(new Date('2026-10-03T06:00:00Z'));
    await expect(log(8)).rejects.toMatchObject({ code: 'forbidden', details: { reason: 'week_locked' } });
    setNow(new Date('2026-10-02T06:00:00Z'));
    await expect(log(8)).resolves.toMatchObject({ weekTotal: 8 });
    setNow(new Date('2026-10-03T06:00:00Z'));
    t.as('usr_001');
    expect(await t.api.call('time.unlockWeek', { userId: 'usr_003', weekStart: '2026-09-13' })).toMatchObject({ locked: false, unlocked: true });
    t.as('usr_003');
    await expect(log(7)).resolves.toMatchObject({ weekTotal: 7 });
  });

  it("shows another person's week only to the Admin", async () => {
    const t = testApi(timeCalls);
    t.as('usr_002');
    await expect(t.api.call('time.week', { userId: 'usr_003', weekStart: WEEK })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await expect(t.api.call('time.week', { userId: 'usr_003', weekStart: WEEK })).resolves.toMatchObject({ userId: 'usr_003' });
  });

  it('pins rows, protects rows with hours, and copies last week', async () => {
    const t = sara();
    let week = await t.api.call('time.addRow', { weekStart: WEEK, projectId: 'prj_001', stageId: 'stg_001' });
    expect(week.rows.map((r) => [r.stage.name, r.pinned])).toEqual([['Concept', true]]);
    await t.api.call('time.set', { projectId: 'prj_001', stageId: 'stg_001', date: '2026-09-27', hours: 2 });
    await expect(t.api.call('time.removeRow', { weekStart: WEEK, rowKey: 'prj_001|stg_001|-' })).rejects.toMatchObject({ code: 'invalid_input' });
    week = await t.api.call('time.copyLastWeek', { weekStart: '2026-10-04' });
    expect(week.rows.map((r) => r.key)).toEqual(['prj_001|stg_001|-']);
    expect(week.weekTotal).toBe(0);
    week = await t.api.call('time.removeRow', { weekStart: '2026-10-04', rowKey: 'prj_001|stg_001|-' });
    expect(week.rows).toEqual([]);
  });
});
