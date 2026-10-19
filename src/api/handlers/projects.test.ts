import { beforeEach, describe, expect, it } from 'vitest';
import { nextProjectCode, projectCalls } from './projects';
import { taskCalls } from './tasks';
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
    // 2 days past due: still on track. From 3 days past due the project is at risk (owner, 2026-10-06).
    t.store.state.tasks.tsk_001 = makeTask({ dueDate: '2026-09-28', status: 'in_progress' });
    expect(await t.api.call('projects.list', { filter: 'at_risk' })).toHaveLength(0);
    t.store.state.tasks.tsk_001 = makeTask({ dueDate: '2026-09-27', status: 'in_progress' });
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

  // Feedback fbk_004 (2026-10-11): the Projects list said "No deadline" for every project, while the Late tag used the end date
  // of the current stage. With no named deadline, the stage end date is the date to show.
  // In this world the stage tag picks stg_001 (Concept), the first stage, and it ended on 2026-08-31. Today is 2026-09-30.
  it('gives the end of the current stage when the project has no named deadline', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.currentStage.id).toBe('stg_001');
    expect(detail.nextDeadline).toBeNull();
    expect(detail.stageEnd).toEqual({ date: '2026-08-31', daysLeft: -30 });
    expect((await t.api.call('projects.list', {}))[0].stageEnd).toEqual({ date: '2026-08-31', daysLeft: -30 });
  });

  it('counts the days of a stage end that is still to come', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    t.store.state.stages.stg_001.endDate = '2026-10-31';
    expect((await t.api.call('projects.get', { id: 'prj_001' })).stageEnd).toEqual({ date: '2026-10-31', daysLeft: 31 });
  });

  it('gives no stage end when the stage has no end date, or the project is not active', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    t.store.state.stages.stg_001.endDate = null;
    expect((await t.api.call('projects.get', { id: 'prj_001' })).stageEnd).toBeNull();
    t.store.state.stages.stg_001.endDate = '2026-10-31';
    t.store.state.projects.prj_001.status = 'completed';
    expect((await t.api.call('projects.get', { id: 'prj_001' })).stageEnd).toBeNull();
  });

  it('sorts by the next deadline, then by the stage end of a project with no named deadline', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    t.store.state.stages.stg_001.endDate = '2026-10-31';
    await t.api.call('projects.create', { name: 'Alpha Villa', leader: 'usr_002' });
    const alpha = Object.values(t.store.state.projects).find((p) => p.name === 'Alpha Villa')!;
    t.store.state.stages[alpha.currentStageId].endDate = '2026-10-05';
    expect((await t.api.call('projects.list', { sort: 'deadline' })).map((s) => s.project.name)).toEqual(['Alpha Villa', 'Test Tower']);
    await t.api.call('deadlines.create', { projectId: 'prj_001', name: 'Site survey', date: '2026-10-01' });
    expect((await t.api.call('projects.list', { sort: 'deadline' })).map((s) => s.project.name)).toEqual(['Test Tower', 'Alpha Villa']);
  });

  it('shows the two latest feed items', async () => {
    const t = testApi({ ...projectCalls, ...taskCalls });
    t.as('usr_002');
    await t.api.call('members.add', { projectId: 'prj_001', userId: 'usr_004' });
    // The stage tag follows the tasks, so a task in the stage after the first one moves the tag and puts a line in the feed.
    t.store.state.tasks.tsk_001 = makeTask({ stageId: 'stg_001', status: 'done' });
    t.store.state.counters.tsk = 1;
    t.store.state.projects.prj_001.currentStageId = 'stg_001';
    await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_002', title: 'Roof plan' });
    const summary = (await t.api.call('projects.list', {}))[0];
    expect(summary.latest.map((item) => (item.kind === 'event' ? item.verb : item.kind))).toContain('project.stage_changed');
    expect(summary.latest).toHaveLength(2);
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

  it('moves the stage with the tasks, clears the override and tells the team', async () => {
    const t = testApi({ ...projectCalls, ...taskCalls });
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'at_risk', reason: 'Client delay' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).health?.overridden).toBe(true);
    // The first task is in Schematic Design, so the tag moves there from Concept.
    const task = await t.api.call('tasks.create', { projectId: 'prj_001', stageId: 'stg_002', title: 'Roof plan' });
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(task.task.stageId).toBe('stg_002');
    expect(detail.currentStage.id).toBe('stg_002');
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
    expect(detail.stages.find((stage) => stage.id === 'stg_002')?.endDate).toBe('2026-10-20');
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

describe('project links (colleague comment 5, 2026-10-01)', () => {
  it('lets the leader and the team add, change and remove links; others only read them', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const added = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'moodboard', label: 'Pinterest: facades', url: 'https://www.pinterest.com/office/facades/' });
    const link = added.project.links!.at(-1)!;
    expect(link).toMatchObject({ kind: 'moodboard', label: 'Pinterest: facades', url: 'https://www.pinterest.com/office/facades/' });
    t.as('usr_003');
    const changed = await t.api.call('projects.updateLink', { projectId: 'prj_001', linkId: link.id, label: 'Pinterest: lobby' });
    expect(changed.project.links!.find((l) => l.id === link.id)?.label).toBe('Pinterest: lobby');
    t.as('usr_004');
    await expect(t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'other', label: '', url: 'https://example.com' })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('projects.removeLink', { projectId: 'prj_001', linkId: link.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    const removed = await t.api.call('projects.removeLink', { projectId: 'prj_001', linkId: link.id });
    expect(removed.project.links!.some((l) => l.id === link.id)).toBe(false);
    await expect(t.api.call('projects.removeLink', { projectId: 'prj_001', linkId: link.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('accepts only web links, and network paths only for an office folder', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const bad = (kind: 'other' | 'folder' | 'location', url: string) =>
      expect(t.api.call('projects.addLink', { projectId: 'prj_001', kind, label: '', url })).rejects.toMatchObject({ code: 'invalid_input' });
    await bad('other', 'javascript:alert(1)');
    await bad('other', 'data:text/html,hi');
    await bad('other', 'ftp://files.example.com');
    await bad('location', '\\\\STUDIO\\Projects\\KH-26-001');
    const folder = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'folder', label: '', url: '\\\\STUDIO\\Projects\\KH-26-001\\Renders' });
    expect(folder.project.links!.at(-1)!.url).toBe('\\\\STUDIO\\Projects\\KH-26-001\\Renders');
    const plain = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'location', label: '', url: 'http://maps.google.com/?q=26.28,50.21' });
    expect(plain.project.links!.at(-1)!.kind).toBe('location');
  });
});

describe('the contract start date', () => {
  it('is saved on create, changed on update, cleared with null and shown to every viewer', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    const created = await t.api.call('projects.create', { name: 'Beach Pavilion', contractStartDate: '2026-09-01' });
    expect(created.project.contractStartDate).toBe('2026-09-01');
    const plain = await t.api.call('projects.create', { name: 'Kiosk' });
    expect(plain.project.contractStartDate).toBeNull();
    const id = created.project.id;
    expect((await t.api.call('projects.update', { id, patch: { contractStartDate: '2026-09-15' } })).project.contractStartDate).toBe('2026-09-15');
    t.as('usr_004');
    expect((await t.api.call('projects.get', { id })).project.contractStartDate).toBe('2026-09-15');
    t.as('usr_003');
    expect((await t.api.call('projects.update', { id, patch: { contractStartDate: null } })).project.contractStartDate).toBeNull();
    await expect(t.api.call('projects.update', { id, patch: { contractStartDate: 'next week' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('works on a project saved before the field existed', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    expect('contractStartDate' in t.store.state.projects.prj_001).toBe(false);
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.project.contractStartDate).toBeUndefined();
    const updated = await t.api.call('projects.update', { id: 'prj_001', patch: { contractStartDate: '2026-08-20' } });
    expect(updated.project.contractStartDate).toBe('2026-08-20');
  });
});

describe('the sub-company of a project (fbk_007)', () => {
  const sub = (id: string, name: string) => ({ id, name, nameAr: `${name} ar`, logo: null, createdBy: 'usr_001', createdAt: STAMP });

  /** The sample office with two sub-companies, Vado and Bunah. The actor is a team member, who may create and edit projects. */
  function office() {
    const t = testApi(projectCalls);
    t.store.state.subCompanies = { sub_001: sub('sub_001', 'Vado'), sub_002: sub('sub_002', 'Bunah') };
    t.as('usr_002');
    return t;
  }

  it('asks for a sub-company on create when the office has some', async () => {
    const t = office();
    await expect(t.api.call('projects.create', { name: 'Kiosk' })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'sub_company_required' },
    });
    await expect(t.api.call('projects.create', { name: 'Kiosk', subCompanyId: null })).rejects.toMatchObject({
      details: { reason: 'sub_company_required' },
    });
    expect(Object.values(t.store.state.projects).some((project) => project.name === 'Kiosk')).toBe(false);
  });

  it('creates a project with its sub-company, and the summary names it', async () => {
    const t = office();
    const detail = await t.api.call('projects.create', { name: 'Kiosk', subCompanyId: 'sub_002' });
    expect(detail.project.subCompanyId).toBe('sub_002');
    expect((await t.api.call('projects.get', { id: detail.project.id })).subCompanyId).toBe('sub_002');
  });

  it('lets a project have no sub-company when the office has none', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('projects.create', { name: 'Kiosk' });
    expect(detail.project.subCompanyId).toBeUndefined();
    expect(detail.subCompanyId).toBeNull();
  });

  it('refuses a sub-company that the office does not hold', async () => {
    const t = office();
    await expect(t.api.call('projects.create', { name: 'Kiosk', subCompanyId: 'sub_099' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: 'sub_099' } })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('sets and clears the sub-company with projects.update', async () => {
    const t = office();
    const set = await t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: 'sub_001' } });
    expect(set.project.subCompanyId).toBe('sub_001');
    expect(set.subCompanyId).toBe('sub_001');
    const cleared = await t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: null } });
    expect(cleared.project.subCompanyId).toBeNull();
    expect(cleared.subCompanyId).toBeNull();
  });

  it('keeps an update that leaves the sub-company out as it was', async () => {
    const t = office();
    await t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: 'sub_002' } });
    await t.api.call('projects.update', { id: 'prj_001', patch: { name: 'Corniche Tower' } });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).project.subCompanyId).toBe('sub_002');
  });

  it('lists only the projects of one sub-company, with projects.list', async () => {
    const t = office();
    await t.api.call('projects.update', { id: 'prj_001', patch: { subCompanyId: 'sub_001' } });
    await t.api.call('projects.create', { name: 'Kiosk', subCompanyId: 'sub_002' });
    const vado = await t.api.call('projects.list', { status: 'all', subCompanyId: 'sub_001' });
    expect(vado.map((row) => row.project.id)).toEqual(['prj_001']);
    expect(vado[0].subCompanyId).toBe('sub_001');
    const bunah = await t.api.call('projects.list', { status: 'all', subCompanyId: 'sub_002' });
    expect(bunah.map((row) => row.project.name)).toEqual(['Kiosk']);
    expect((await t.api.call('projects.list', { status: 'all' })).length).toBe(Object.keys(t.store.state.projects).length);
  });
});

describe('the map pin (owner, 2026-10-18, fbk_017)', () => {
  it('is saved on create, changed on update, cleared with null and shown to every viewer', async () => {
    const t = testApi(projectCalls);
    t.as('usr_003');
    const created = await t.api.call('projects.create', { name: 'Harbour Kiosk', geo: { lat: 26.28, lng: 50.21 } });
    expect(created.project.geo).toEqual({ lat: 26.28, lng: 50.21 });
    expect(created.geo).toEqual({ lat: 26.28, lng: 50.21 });
    const id = created.project.id;
    expect((await t.api.call('projects.update', { id, patch: { geo: { lat: 26.3, lng: 50.2 } } })).geo).toEqual({ lat: 26.3, lng: 50.2 });
    t.as('usr_004');
    expect((await t.api.call('projects.get', { id })).geo).toEqual({ lat: 26.3, lng: 50.2 });
    t.as('usr_003');
    expect((await t.api.call('projects.update', { id, patch: { geo: null } })).geo).toBeNull();
    expect((await t.api.call('projects.get', { id })).geo).toBeNull();
  });

  it('refuses a latitude or longitude out of range, and a value that is not a number', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { geo: { lat: 91, lng: 50 } } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { geo: { lat: 26, lng: 181 } } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(t.api.call('projects.update', { id: 'prj_001', patch: { geo: { lat: Number.NaN, lng: 50 } } })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).geo).toBeNull();
  });

  it('gives no pin for a project saved before the field existed, and lists the pin in projects.list', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    expect('geo' in t.store.state.projects.prj_001).toBe(false);
    expect((await t.api.call('projects.get', { id: 'prj_001' })).geo).toBeNull();
    await t.api.call('projects.update', { id: 'prj_001', patch: { geo: { lat: 26.28, lng: 50.21 } } });
    const row = (await t.api.call('projects.list', { status: 'all' })).find((summary) => summary.project.id === 'prj_001');
    expect(row?.geo).toEqual({ lat: 26.28, lng: 50.21 });
  });
});

describe('the pin and the location link (audit 2026-10-19, PRJ-04)', () => {
  const LINK = 'https://maps.google.com/?q=26.2928,50.2172';

  it('sets the pin from a location link that holds coordinates, in the same save', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const detail = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'location', label: 'Google Maps', url: LINK });
    expect(detail.project.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
    expect(detail.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
  });

  it('moves the pin when the location link changes, and leaves it when another kind of link changes', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const added = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'location', label: '', url: LINK });
    const link = added.project.links!.at(-1)!;
    const moved = await t.api.call('projects.updateLink', { projectId: 'prj_001', linkId: link.id, url: 'https://www.google.com/maps/@26.3,50.1,17z' });
    expect(moved.geo).toEqual({ lat: 26.3, lng: 50.1 });
    await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'moodboard', label: '', url: 'https://pinterest.com/x?q=26.9,50.9' });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).geo).toEqual({ lat: 26.3, lng: 50.1 });
  });

  it('keeps the pin for a location link with no coordinates, a short link, or a place outside Saudi Arabia', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    await t.api.call('projects.update', { id: 'prj_001', patch: { geo: { lat: 26.28, lng: 50.21 } } });
    for (const url of ['https://maps.google.com/?q=Al+Khobar', 'https://maps.app.goo.gl/AbC123', 'https://maps.google.com/?q=50.2,26.3']) {
      const detail = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'location', label: '', url });
      expect(detail.geo, url).toEqual({ lat: 26.28, lng: 50.21 });
    }
  });

  it('shows the place of the location link for a project with no pin of its own (old data), and never when the pin was removed', async () => {
    const t = testApi(projectCalls);
    t.as('usr_002');
    const project = t.store.state.projects.prj_001;
    delete project.geo;
    project.links = [{ id: 'lnk_900', kind: 'location', label: 'Google Maps', url: LINK }];
    expect((await t.api.call('projects.get', { id: 'prj_001' })).geo).toEqual({ lat: 26.2928, lng: 50.2172 });
    expect((await t.api.call('projects.list', { status: 'active' })).find((row) => row.project.id === 'prj_001')?.geo).toEqual({ lat: 26.2928, lng: 50.2172 });
    // A pin of its own wins over the link.
    await t.api.call('projects.update', { id: 'prj_001', patch: { geo: { lat: 26.4, lng: 50.0 } } });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).geo).toEqual({ lat: 26.4, lng: 50.0 });
    // A removed pin stays removed: the link does not bring it back.
    await t.api.call('projects.update', { id: 'prj_001', patch: { geo: null } });
    expect((await t.api.call('projects.get', { id: 'prj_001' })).geo).toBeNull();
  });
});
