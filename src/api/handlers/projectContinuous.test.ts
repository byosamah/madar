import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { Project } from '../contract/entities';
import { computeHealth } from '../health';
import { makeProject, makeStage, makeTask, makeWorld, NOW, STAMP, testApi, TODAY } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * A continuous project (fbk_069, owner 2026-10-26): a project that never ends, like an internal tool or a retainer. It has no target end date,
 * it leaves the data gap "a stage with no end date", and a stage end date never makes it Late. usr_001 is the Admin, usr_002 leads prj_001
 * and usr_003 works on it with no right to edit it. TODAY is 2026-09-30.
 */
describe('a continuous project: the contract', () => {
  const base = Project.parse({
    id: 'prj_001', code: 'KH-26-014', name: 'Test Tower', clientId: null, status: 'active', leaderId: null, currentStageId: 'stg_001',
    location: '', areaM2: null, geo: null, startDate: null, targetEndDate: null, contractStartDate: null, coverFileId: null, modelFolderPath: '',
    description: '', healthOverride: null, createdBy: 'usr_001', createdAt: STAMP, updatedAt: STAMP,
  });

  it('reads a project with no value, and takes and keeps true and false', () => {
    expect(Project.parse(base).continuous).toBeUndefined();
    expect(Project.parse({ ...base, continuous: true }).continuous).toBe(true);
    expect(Project.parse({ ...base, continuous: false }).continuous).toBe(false);
    expect(Project.safeParse({ ...base, continuous: 'yes' }).success).toBe(false);
  });
});

describe('a continuous project: health', () => {
  const past = makeStage();
  const current = makeStage({ id: 'stg_002', name: 'Schematic Design', order: 1, startDate: '2026-09-01', endDate: '2026-10-31' });
  const withEnd = (endDate: string) => [past, { ...current, endDate }];
  const input = (continuous: boolean | undefined, extra: Partial<Parameters<typeof computeHealth>[0]> = {}) => ({
    project: makeProject({ continuous }), stages: [past, current], tasks: [] as ReturnType<typeof makeTask>[], ...extra,
  });

  it('is never Late from a stage end date in the past, while the same project with the switch off is Late', () => {
    expect(computeHealth(input(true, { stages: withEnd('2026-09-20') }), TODAY)?.value).toBe('on_track');
    expect(computeHealth(input(false, { stages: withEnd('2026-09-20') }), TODAY)?.value).toBe('late');
    expect(computeHealth(input(undefined, { stages: withEnd('2026-09-20') }), TODAY)?.value).toBe('late');
  });

  it('skips the rule "the stage ends within 7 days with less than 70% done"', () => {
    const tasks = [
      makeTask({ id: 'tsk_001', status: 'done' }),
      makeTask({ id: 'tsk_002', dueDate: '2026-10-05' }),
      makeTask({ id: 'tsk_003', dueDate: '2026-10-06' }),
    ];
    expect(computeHealth(input(false, { stages: withEnd('2026-10-04'), tasks }), TODAY)?.value).toBe('at_risk');
    expect(computeHealth(input(true, { stages: withEnd('2026-10-04'), tasks }), TODAY)?.value).toBe('on_track');
  });

  it('still turns At risk from a to-do 3 or more days past due, and stays on track at 2 days', () => {
    const three = [makeTask({ dueDate: '2026-09-27', status: 'in_progress' })];
    const two = [makeTask({ dueDate: '2026-09-28', status: 'in_progress' })];
    expect(computeHealth(input(true, { stages: withEnd('2026-09-20'), tasks: three }), TODAY)?.value).toBe('at_risk');
    expect(computeHealth(input(true, { tasks: two }), TODAY)?.value).toBe('on_track');
  });

  it('keeps a health override', () => {
    const project = makeProject({ continuous: true, healthOverride: { value: 'late', reason: 'Client waits', setBy: 'usr_001', setAt: STAMP } });
    expect(computeHealth({ project, stages: [past, current], tasks: [] }, TODAY)?.value).toBe('late');
  });
});

describe('a continuous project: projects.create', () => {
  it('starts with the switch off, and saves the switch when it is on', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const plain = await t.api.call('projects.create', { name: 'Plain' });
    expect(plain.project.continuous ?? false).toBe(false);
    const made = await t.api.call('projects.create', { name: 'Retainer', continuous: true });
    expect(made.project.continuous).toBe(true);
    expect(made.project.targetEndDate).toBeNull();
    expect((await t.api.call('projects.get', { id: made.project.id })).project.continuous).toBe(true);
  });

  it('refuses a target end date beside the switch, and changes nothing', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const before = Object.keys(t.store.state.projects).length;
    await expect(t.api.call('projects.create', { name: 'Retainer', continuous: true, startDate: '2026-09-01', targetEndDate: '2027-01-01' }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(Object.keys(t.store.state.projects).length).toBe(before);
  });

  it('takes the switch on an internal project too', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const made = await t.api.call('projects.create', { name: 'Madar', kind: 'internal', continuous: true });
    expect(made.project.continuous).toBe(true);
  });
});

describe('a continuous project: projects.update', () => {
  it('turns the switch on, clears the target end date in the same change, and the History holds one event', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    expect(t.store.state.projects.prj_001.targetEndDate).toBe('2027-06-30');
    const on = await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } });
    expect(on.project.continuous).toBe(true);
    expect(on.project.targetEndDate).toBeNull();
    const events = Object.values(t.store.state.events).filter((event) => event.verb === 'project.updated' && event.targetId === 'prj_001');
    expect(events).toHaveLength(1);
    expect(events[0].after).toEqual({ continuous: true, targetEndDate: null });
  });

  it('turns the switch off and leaves the target end date empty', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } });
    const off = await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: false } });
    expect(off.project.continuous).toBe(false);
    expect(off.project.targetEndDate).toBeNull();
  });

  it('turns the switch off and sets a new target end date in one change', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } });
    const off = await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: false, targetEndDate: '2028-01-01' } });
    expect(off.project.continuous).toBe(false);
    expect(off.project.targetEndDate).toBe('2028-01-01');
  });

  it('refuses a target end date while the switch is on, and changes nothing', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true, targetEndDate: '2028-01-01' } }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.projects.prj_001.continuous).toBeUndefined();
    expect(t.store.state.projects.prj_001.targetEndDate).toBe('2027-06-30');
    await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { targetEndDate: '2028-01-01' } })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(t.store.state.projects.prj_001.targetEndDate).toBeNull();
  });

  it('writes no event when the switch is off already and the patch turns it off', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const before = Object.keys(t.store.state.events).length;
    await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: false } });
    expect(Object.keys(t.store.state.events).length).toBe(before);
    expect(t.store.state.projects.prj_001.continuous).toBeUndefined();
  });

  it('refuses a person without the right project.details, and lets the Admin and the leader in', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.projects.prj_001.continuous).toBeUndefined();
    expect(t.store.state.projects.prj_001.targetEndDate).toBe('2027-06-30');
    t.as('usr_001');
    expect((await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } })).project.continuous).toBe(true);
  });

  it('takes the switch on an internal project', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    const made = await t.api.call('projects.create', { name: 'Madar', kind: 'internal' });
    const on = await t.api.call('projects.update', { id: made.project.id, patch: { continuous: true } });
    expect(on.project.continuous).toBe(true);
  });

  it('undoes the turn-on, and the target end date comes back', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } });
    const event = Object.values(t.store.state.events).find((one) => one.verb === 'project.updated')!;
    await t.api.call('events.undo', { eventId: event.id });
    expect(t.store.state.projects.prj_001.continuous ?? false).toBe(false);
    expect(t.store.state.projects.prj_001.targetEndDate).toBe('2027-06-30');
  });
});

describe('a continuous project: the views', () => {
  it('carries the switch in projects.get and projects.list, and in the Late tag of the list', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    // The current stage ended in the past: the project is Late until the switch is on.
    t.store.state.stages.stg_002.endDate = '2026-09-20';
    expect((await t.api.call('projects.list', {})).find((row) => row.project.id === 'prj_001')?.health?.value).toBe('late');
    await t.api.call('projects.update', { id: 'prj_001', patch: { continuous: true } });
    const row = (await t.api.call('projects.list', {})).find((one) => one.project.id === 'prj_001')!;
    expect(row.project.continuous).toBe(true);
    expect(row.health?.value).toBe('on_track');
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.project.continuous).toBe(true);
    expect(detail.health?.value).toBe('on_track');
    expect((await t.api.call('projects.list', { health: 'late' })).map((one) => one.project.id)).not.toContain('prj_001');
  });
});

describe('a continuous project: the data gap "a stage with no end date"', () => {
  function gapWorld() {
    const state = makeWorld();
    state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Retainer', leaderId: 'usr_003' });
    state.stages.stg_009 = { id: 'stg_009', projectId: 'prj_002', name: 'Concept', order: 0, startDate: '2026-09-01', endDate: null };
    state.counters.prj = 2;
    return state;
  }

  it('counts the project while the switch is off, and leaves it when the switch is on, in the number and in the list', async () => {
    const t = testApi(calls, gapWorld());
    t.as('usr_001');
    expect((await t.api.call('dashboard.get', {})).gaps!.projectsStageNoEnd).toBe(1);
    expect((await t.api.call('projects.list', { filter: 'stage_no_end' })).map((s) => s.project.id)).toEqual(['prj_002']);
    await t.api.call('projects.update', { id: 'prj_002', patch: { continuous: true } });
    expect((await t.api.call('dashboard.get', {})).gaps!.projectsStageNoEnd).toBe(0);
    expect((await t.api.call('projects.list', { filter: 'stage_no_end' })).map((s) => s.project.id)).toEqual([]);
  });

  it('keeps the number and the list equal under the filters', async () => {
    const t = testApi(calls, gapWorld());
    t.as('usr_001');
    await t.api.call('projects.update', { id: 'prj_002', patch: { continuous: true } });
    for (const filters of [{}, { leaderId: 'usr_003' }, { status: 'all' as const }]) {
      const { gaps } = await t.api.call('dashboard.get', filters);
      expect(gaps!.projectsStageNoEnd, JSON.stringify(filters)).toBe((await t.api.call('projects.list', { filter: 'stage_no_end', ...filters })).length);
    }
  });

  it('leaves the office report line out as well', async () => {
    const t = testApi(calls, gapWorld());
    t.as('usr_001');
    const line = async () => ((await t.api.call('reports.office', { period: 'week' })).gaps ?? []).find((g: string) => g.includes('stage that has no end date'));
    expect(await line()).toBeDefined();
    await t.api.call('projects.update', { id: 'prj_002', patch: { continuous: true } });
    expect(await line()).toBeUndefined();
  });
});
