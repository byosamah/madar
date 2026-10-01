import { beforeEach, describe, expect, it } from 'vitest';
import { nextProjectCode, projectCalls } from './projects';
import type { Store } from '../store';
import { makeTask, makeWorld, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { FORMS, markOf } from '../../lib/projectMark';

beforeEach(() => setNow(NOW));

const notices = (store: Store, trigger: string, userId: string) =>
  Object.values(store.state.notifications).filter((n) => n.trigger === trigger && n.userId === userId);

describe('projects.create', () => {
  it('lets a team member create a project and lead it', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    const detail = await t.api.call('projects.create', { name: 'Beach Pavilion', teamIds: ['usr_004'] });
    expect(detail.project.code).toBe('KH-26-002');
    expect(detail.project.leaderId).toBe('usr_003');
    expect(detail.stages.map((s) => s.name)).toEqual([
      'Concept', 'Schematic Design', 'Design Development', 'Construction Documents', 'Permits', 'Tender', 'Supervision',
    ]);
    expect(detail.currentStage.name).toBe('Concept');
    expect(detail.viewerRole).toBe('leader');
    expect(detail.viewerCan.edit).toBe(true);
    expect(detail.members.map((m) => m.user.id)).toEqual(['usr_003', 'usr_004']);
    expect(notices(t.store, 'added_to_project', 'usr_004')).toHaveLength(1);
    expect(notices(t.store, 'added_to_project', 'usr_003')).toHaveLength(0);
  });

  it('gives each new project its own picture, with a form no other project uses yet', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    for (const name of ['Beach Pavilion', 'Kiosk', 'Shade Canopy', 'Pier Cafe']) await t.api.call('projects.create', { name });
    const created = Object.values(t.store.state.projects).filter((project) => project.id !== 'prj_001');
    expect(created.every((project) => typeof project.mark === 'number')).toBe(true);
    const forms = Object.values(t.store.state.projects).map((project) => markOf(project) % FORMS.length);
    expect(new Set(forms).size).toBe(forms.length);
  });

  it('keeps the creator on the team when the leader is someone else or nobody', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    const other = await t.api.call('projects.create', { name: 'Kiosk', leader: 'usr_002' });
    expect(other.project.leaderId).toBe('usr_002');
    expect(other.viewerRole).toBe('team');
    expect(other.viewerCan.edit).toBe(false);
    const none = await t.api.call('projects.create', { name: 'Shade Canopy', leader: 'none' });
    expect(none.project.leaderId).toBeNull();
    expect(none.viewerRole).toBe('team');
  });

  it('refuses an end date before the start date and an agent as leader', async () => {
    const { api } = testApi(projectCalls);
    await expect(api.call('projects.create', { name: 'X', startDate: '2026-10-10', targetEndDate: '2026-10-01' })).rejects.toMatchObject({
      code: 'invalid_input', details: { fields: ['targetEndDate'] },
    });
    await expect(api.call('projects.create', { name: 'X', leader: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('numbers codes by year', () => {
    const state = makeWorld();
    expect(nextProjectCode(state, 'KH', '2026-09-30')).toBe('KH-26-002');
    expect(nextProjectCode(state, 'KH', '2027-01-02')).toBe('KH-27-001');
  });
});

describe('projects.list and the card', () => {
  it('filters and sorts', async () => {
    const t = testApi(projectCalls);
    await t.api.call('projects.create', { name: 'Alpha Villa', leader: 'usr_002' });
    const byName = await t.api.call('projects.list', { sort: 'name' });
    expect(byName.map((s) => s.project.name)).toEqual(['Alpha Villa', 'Test Tower']);
    t.as('usr_004');
    expect(await t.api.call('projects.list', { filter: 'mine' })).toHaveLength(0);
    t.store.state.tasks.tsk_001 = makeTask({ dueDate: '2026-09-28', status: 'in_progress' });
    const risky = await t.api.call('projects.list', { filter: 'at_risk' });
    expect(risky.map((s) => s.project.id)).toEqual(['prj_001']);
    expect(risky[0].health?.value).toBe('at_risk');
  });

  it('shows the next deadline, or the last past one', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('deadlines.create', { projectId: 'prj_001', name: 'Site survey', date: '2026-09-20' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).nextDeadline).toMatchObject({ name: 'Site survey', daysLeft: -10 });
    await t.api.call('deadlines.create', { projectId: 'prj_001', name: 'Client presentation', date: '2026-10-12' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).nextDeadline).toMatchObject({ name: 'Client presentation', daysLeft: 12 });
  });

  it('shows the two latest feed items', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_004' });
    await t.api.call('projects.setStage', { id: 'prj_001', stageId: 'stg_001' });
    const summary = (await t.api.call('projects.list', {}))[0];
    expect(summary.latest.map((item) => (item.kind === 'event' ? item.verb : item.kind))).toEqual(['project.stage_changed', 'member.added']);
  });
});

describe('project changes', () => {
  it('lets the leader edit and stops a team member', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { name: 'New' } })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const detail = await t.api.call('projects.update', { id: 'prj_001', patch: { name: 'Test Tower B', areaM2: 1200 } });
    expect(detail.project).toMatchObject({ name: 'Test Tower B', areaM2: 1200 });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { targetEndDate: '2026-07-01' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('moves the stage, clears the override and tells the team', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'at_risk', reason: 'Client delay' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).health?.overridden).toBe(true);
    const detail = await t.api.call('projects.setStage', { id: 'prj_001', stageId: 'stg_001' });
    expect(detail.currentStage.id).toBe('stg_001');
    expect(detail.health?.overridden).toBe(false);
    expect(notices(t.store, 'stage_changed', 'usr_003')).toHaveLength(1);
    expect(notices(t.store, 'stage_changed', 'usr_002')).toHaveLength(0);
  });

  it('adds a new leader to the team', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('projects.setLeader', { id: 'prj_001', leaderId: 'usr_004' });
    expect(detail.leader?.id).toBe('usr_004');
    expect(detail.members.find((m) => m.isLeader)?.user.id).toBe('usr_004');
    expect(notices(t.store, 'added_to_project', 'usr_004')).toHaveLength(1);
  });

  it('lets only the Admin delete, and removes the project data', async () => {
    const t = testApi(projectCalls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_002');
    await expect(t.api.call('projects.delete', { id: 'prj_001', confirm: true })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    expect(t.store.state.projects.prj_001).toBeUndefined();
    expect(t.store.state.tasks.tsk_001).toBeUndefined();
    expect(Object.keys(t.store.state.stages)).toHaveLength(0);
    expect(Object.keys(t.store.state.members)).toHaveLength(0);
  });
});

describe('members', () => {
  it('protects the leader and people with open tasks', async () => {
    const t = testApi(projectCalls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003' });
    t.as('usr_002');
    await expect(t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_002' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_003' })).rejects.toMatchObject({ code: 'invalid_input' });
    await t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_004' });
    const detail = await t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_004' });
    expect(detail.members.map((m) => m.user.id)).not.toContain('usr_004');
    await expect(t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_005' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_003' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('stages', () => {
  it('refuses to remove a stage with tasks, and names it', async () => {
    const t = testApi(projectCalls);
    t.store.state.tasks.tsk_001 = makeTask({ stageId: 'stg_001' });
    t.as('usr_002');
    const call = t.api.call('stages.replace', { projectId: 'prj_001', stages: [{ id: 'stg_002', name: 'Schematic Design' }] });
    await expect(call).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(call).rejects.toThrow('Move the tasks out of "Concept" first.');
    expect(t.store.state.stages.stg_001).toBeDefined();
  });

  it('renames, adds and removes stages', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('stages.replace', {
      projectId: 'prj_001', stages: [{ id: 'stg_002', name: 'Schematic' }, { name: 'Authority approvals' }],
    });
    expect(detail.stages.map((s) => [s.id, s.name, s.order])).toEqual([['stg_002', 'Schematic', 0], ['stg_003', 'Authority approvals', 1]]);
    expect(detail.currentStage.id).toBe('stg_002');
  });

  it('moves the current stage to the first stage when it is removed', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('stages.replace', { projectId: 'prj_001', stages: [{ id: 'stg_001', name: 'Concept' }, { name: 'Detail design' }] });
    expect(detail.currentStage.id).toBe('stg_001');
  });

  it('checks stage dates', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await expect(t.api.call('stages.setDates', { stageId: 'stg_002', startDate: '2026-10-10', endDate: '2026-10-01' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    const detail = await t.api.call('stages.setDates', { stageId: 'stg_002', startDate: '2026-09-01', endDate: '2026-10-20' });
    expect(detail.currentStage.endDate).toBe('2026-10-20');
  });
});

describe('plan 2 additions', () => {
  beforeEach(() => setNow(NOW));

  it("gives each project summary the viewer's role and rights", async () => {
    const t = testApi(projectCalls);
    t.as('usr_004');
    const [outside] = await t.api.call('projects.list', {});
    expect(outside.viewerRole).toBe('other');
    expect(outside.viewerCan.archive).toBe(false);
    t.as('usr_002');
    const [led] = await t.api.call('projects.list', {});
    expect(led.viewerRole).toBe('leader');
    expect(led.viewerCan.archive).toBe(true);
  });

  it('names the person who set the health by hand', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'at_risk', reason: 'Client delay' });
    const [summary] = await t.api.call('projects.list', {});
    expect(summary.healthSetBy?.name).toBe('Faisal Leader');
  });

  it('gives the latest letter of the cover, so a new version shows', async () => {
    const t = testApi(projectCalls);
    const version = (letter: string) => ({ letter, blobKey: `blob_${letter}`, mimeType: 'image/png', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP });
    t.store.state.files.fil_001 = { id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Render.png', versions: [version('A'), version('B')] };
    t.store.state.projects.prj_001.coverFileId = 'fil_001';
    const [summary] = await t.api.call('projects.list', {});
    expect(summary.coverLetter).toBe('B');
  });

  it('sets a project image as the cover and refuses other files', async () => {
    const t = testApi(projectCalls);
    const version = { letter: 'A', blobKey: 'blob_1', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP };
    t.store.state.files.fil_001 = {
      id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Render.png', versions: [{ ...version, mimeType: 'image/png' }],
    };
    t.store.state.files.fil_002 = {
      id: 'fil_002', projectId: 'prj_001', stageId: null, taskId: null, name: 'Plan.pdf', versions: [{ ...version, mimeType: 'application/pdf' }],
    };
    t.as('usr_002');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { coverFileId: 'fil_002' } })).rejects.toMatchObject({ code: 'invalid_input' });
    const detail = await t.api.call('projects.update', { id: 'prj_001', patch: { coverFileId: 'fil_001' } });
    expect(detail.project.coverFileId).toBe('fil_001');
  });
});

describe('deadlines across projects', () => {
  beforeEach(() => setNow(NOW));

  it('lists the deadlines of active projects in a date range, soonest first', async () => {
    const t = testApi(projectCalls);
    const s = t.store.state;
    s.deadlines.ddl_001 = { id: 'ddl_001', projectId: 'prj_001', stageId: null, name: 'Workshop', date: '2026-10-09' };
    s.deadlines.ddl_002 = { id: 'ddl_002', projectId: 'prj_001', stageId: null, name: 'Submission', date: '2026-10-02' };
    s.deadlines.ddl_003 = { id: 'ddl_003', projectId: 'prj_001', stageId: null, name: 'Handover', date: '2026-12-01' };
    const rows = await t.api.call('deadlines.list', { from: '2026-09-30', to: '2026-10-14' });
    expect(rows.map((row) => row.deadline.name)).toEqual(['Submission', 'Workshop']);
    expect(rows[0]).toMatchObject({ project: { id: 'prj_001', code: 'KH-26-001' }, daysLeft: 2 });
    s.projects.prj_001.status = 'on_hold';
    expect(await t.api.call('deadlines.list', { from: '2026-09-30', to: '2026-10-14' })).toEqual([]);
  });
});

describe('projects by health', () => {
  it('lists the projects of one health value', async () => {
    const t = testApi(projectCalls);
    const all = await t.api.call('projects.list', {});
    for (const value of ['on_track', 'at_risk', 'late'] as const) {
      const some = await t.api.call('projects.list', { health: value });
      expect(some.map((s) => s.project.id)).toEqual(all.filter((s) => s.health?.value === value).map((s) => s.project.id));
    }
  });
});

describe('pausing a project', () => {
  it('lets the leader pause with a reason and a restart date, and resume', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const paused = await t.api.call('projects.pause', { id: 'prj_001', reason: 'The client reviews the budget.', resumeOn: '2026-10-15' });
    expect(paused.project.status).toBe('on_hold');
    expect(paused.project.pause).toMatchObject({ reason: 'The client reviews the budget.', resumeOn: '2026-10-15', by: 'usr_002' });
    const resumed = await t.api.call('projects.resume', { id: 'prj_001' });
    expect(resumed.project.status).toBe('active');
    expect(resumed.project.pause).toBeNull();
    const verbs = Object.values(t.store.state.events).map((e) => e.verb);
    expect(verbs).toContain('project.paused');
    expect(verbs).toContain('project.resumed');
  });

  it('refuses a team member, an empty reason and a restart date in the past', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    await expect(t.api.call('projects.pause', { id: 'prj_001', reason: 'No time.' })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await expect(t.api.call('projects.pause', { id: 'prj_001', reason: '  ' })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('projects.pause', { id: 'prj_001', reason: 'Wait.', resumeOn: '2026-09-01' })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses to resume a project that is not paused', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await expect(t.api.call('projects.resume', { id: 'prj_001' })).rejects.toMatchObject({ code: 'conflict' });
  });
});
