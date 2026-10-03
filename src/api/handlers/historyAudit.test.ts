import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeStage, makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

// Today is Wed 30 Sep 2026. Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Omar (usr_004) is not.

describe('Undo of a story with follow-on changes (audit 2026-10-03, API-1)', () => {
  it('lets a member undo a late finish that moved the leader task', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', needsReview: false, dueDate: '2026-09-24' });
    s.tasks.tsk_002 = makeTask({
      id: 'tsk_002', ownerId: 'usr_002', title: 'Leader work', schedule: 'dynamic', startDate: '2026-10-04', durationDays: 3, dueDate: '2026-10-06', prerequisiteIds: ['tsk_001'],
    });
    s.counters.tsk = 2;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_late' });
    expect(s.tasks.tsk_002.startDate).not.toBe('2026-10-04');
    await t.api.call('events.undoStory', { correlationId: 'cor_late' });
    expect(s.tasks.tsk_001.status).toBe('todo');
    expect(s.tasks.tsk_002.startDate).toBe('2026-10-04');
    expect(s.tasks.tsk_002.dateNotes ?? []).toEqual([]);
    expect(Object.values(s.tracker ?? {})).toHaveLength(0);
  });

  it('lets a member undo a reopen that reopened the leader task', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', status: 'done', completedAt: '2026-09-29T10:00:00.000+03:00', prerequisiteIds: ['tsk_001'] });
    s.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_003', title: 'Open one' });
    s.counters.tsk = 3;
    t.as('usr_003');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' }, { correlationId: 'cor_open' });
    expect(s.tasks.tsk_002.status).toBe('todo');
    await t.api.call('events.undoStory', { correlationId: 'cor_open' });
    expect(s.tasks.tsk_001.status).toBe('done');
    expect(s.tasks.tsk_002.status).toBe('done');
  });

  it('lets a member undo a new version that reopened the leader task', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', status: 'done', completedAt: '2026-09-29T10:00:00.000+03:00', prerequisiteIds: ['tsk_001'] });
    s.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_003', title: 'Open one' });
    s.counters.tsk = 3;
    t.as('usr_003');
    await t.api.call('tasks.newVersion', { id: 'tsk_001', reason: 'Client comments' }, { correlationId: 'cor_nv' });
    await t.api.call('events.undoStory', { correlationId: 'cor_nv' });
    expect(s.tasks.tsk_001.status).toBe('done');
    expect(s.tasks.tsk_002.status).toBe('done');
  });

  it('still refuses a single Undo of a follow-on change on a task that is not mine', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', status: 'done', completedAt: '2026-09-29T10:00:00.000+03:00', prerequisiteIds: ['tsk_001'] });
    s.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_003', title: 'Open one' });
    s.counters.tsk = 3;
    t.as('usr_003');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' }, { correlationId: 'cor_open' });
    const reopened = Object.values(s.events).find((e) => e.verb === 'task.reopened');
    await expect(t.api.call('events.undo', { eventId: reopened!.id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses the relief for a reopen whose cause is not in the story (audit 2026-10-03, V-2)', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', needsReview: false });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', title: 'Leader work', needsReview: false, prerequisiteIds: ['tsk_001'] });
    s.tasks.tsk_003 = makeTask({ id: 'tsk_003', ownerId: 'usr_003', title: 'Open one' });
    s.counters.tsk = 3;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    // Sara takes back her finish with a single Undo, sent with a story ID she picks: the leader task reopens in that story.
    t.as('usr_003');
    const finish = Object.values(s.events).find((e) => e.targetId === 'tsk_001' && e.verb === 'task.status_changed')!;
    await t.api.call('events.undo', { eventId: finish.id }, { correlationId: 'cor_forged' });
    expect(s.tasks.tsk_002.status).toBe('todo');
    // She adds a change of her own to the same story and undoes the story.
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_003', body: 'x' }, { correlationId: 'cor_forged' });
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_forged' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(s.tasks.tsk_001.status).toBe('todo');
    expect(s.tasks.tsk_002.status).toBe('todo');
  });

  it('records the change that caused each follow-on change (audit 2026-10-03, V-2)', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', status: 'done', completedAt: '2026-09-29T09:00:00.000+03:00' });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_002', status: 'done', completedAt: '2026-09-29T10:00:00.000+03:00', prerequisiteIds: ['tsk_001'] });
    s.counters.tsk = 2;
    t.as('usr_003');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' }, { correlationId: 'cor_open' });
    const cause = Object.values(s.events).find((e) => e.verb === 'task.status_changed' && e.targetId === 'tsk_001')!;
    const reopened = Object.values(s.events).find((e) => e.verb === 'task.reopened')!;
    expect(reopened.causeEventId).toBe(cause.id);
  });

  it('refuses a story Undo that finishes your own task while its prerequisite is open (audit 2026-10-03, V-2)', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', title: 'Task A', needsReview: false });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', title: 'Task B', needsReview: false, prerequisiteIds: ['tsk_001'] });
    s.counters.tsk = 2;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    // Sara takes back her finish of A with a single Undo, sent with a story ID she picks: B reopens in that story.
    const finish = Object.values(s.events).find((e) => e.targetId === 'tsk_001' && e.verb === 'task.status_changed')!;
    await t.api.call('events.undo', { eventId: finish.id }, { correlationId: 'cor_x' });
    expect(s.tasks.tsk_002.status).toBe('todo');
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_x' })).rejects.toMatchObject({ details: { reason: 'prerequisite_open' } });
    expect(t.store.state.tasks.tsk_001.status).toBe('todo');
    expect(t.store.state.tasks.tsk_002.status).toBe('todo');
  });

  it('still brings two tasks back together when the story reopened both (audit 2026-10-03, V-2)', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', title: 'Task A', needsReview: false });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', title: 'Task B', needsReview: false, prerequisiteIds: ['tsk_001'] });
    s.counters.tsk = 2;
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'todo' }, { correlationId: 'cor_open' });
    expect(s.tasks.tsk_002.status).toBe('todo');
    await t.api.call('events.undoStory', { correlationId: 'cor_open' });
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
    expect(t.store.state.tasks.tsk_002.status).toBe('done');
  });
});

describe('Undo brings back the health override that a stage move cleared (audit 2026-10-03, API-5)', () => {
  it('restores the override and its reason', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', stageId: 'stg_001', ownerId: 'usr_003', needsReview: false });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', stageId: 'stg_002', ownerId: 'usr_003', title: 'Later' });
    s.counters.tsk = 2;
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'late', reason: 'Client changed the brief' });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_stage' });
    expect(s.projects.prj_001.healthOverride).toBeNull();
    await t.api.call('events.undoStory', { correlationId: 'cor_stage' });
    expect(s.tasks.tsk_001.status).toBe('todo');
    expect(s.projects.prj_001.currentStageId).toBe('stg_001');
    expect(s.projects.prj_001.healthOverride).toMatchObject({ value: 'late', reason: 'Client changed the brief' });
  });

  function threeStages() {
    const t = testApi(calls);
    const s = t.store.state;
    s.stages.stg_003 = makeStage({ id: 'stg_003', name: 'Design Development', order: 2, startDate: '2026-11-01', endDate: '2026-11-30' });
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', stageId: 'stg_001', title: 'Concept sketch', ownerId: 'usr_003', needsReview: false });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', stageId: 'stg_002', title: 'SD plan', ownerId: 'usr_003', needsReview: false });
    s.tasks.tsk_003 = makeTask({ id: 'tsk_003', stageId: 'stg_003', title: 'DD plan', ownerId: 'usr_002', needsReview: false });
    s.counters.tsk = 3;
    s.counters.stg = 3;
    s.projects.prj_001.currentStageId = 'stg_001';
    return t;
  }

  it('restores the override when one story holds two stage moves (audit 2026-10-03, V-21)', async () => {
    const t = threeStages();
    const s = t.store.state;
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'late', reason: 'Client changed the brief' });
    // Sara's agent finishes two tasks in one request, so the tag moves twice in one story.
    t.as('usr_005');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_agent' });
    await t.api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'cor_agent' });
    expect(s.projects.prj_001.currentStageId).toBe('stg_003');
    t.as('usr_003');
    await t.api.call('events.undoStory', { correlationId: 'cor_agent' });
    expect(s.projects.prj_001.currentStageId).toBe('stg_001');
    expect(s.projects.prj_001.healthOverride).toMatchObject({ value: 'late', reason: 'Client changed the brief' });
  });

  it('takes back only the newer move when one Undo brings the tag back one stage (audit 2026-10-03, V-21)', async () => {
    const t = threeStages();
    const s = t.store.state;
    t.as('usr_002');
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'late', reason: 'Client changed the brief' });
    t.as('usr_005');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_agent' });
    await t.api.call('tasks.complete', { id: 'tsk_002' }, { correlationId: 'cor_agent' });
    t.as('usr_003');
    const second = Object.values(s.events).find((e) => e.verb === 'task.status_changed' && e.targetId === 'tsk_002')!;
    await t.api.call('events.undo', { eventId: second.id });
    expect(s.projects.prj_001.currentStageId).toBe('stg_002');
    expect(s.projects.prj_001.healthOverride).toBeNull();
    const moves = Object.values(s.events).filter((e) => e.verb === 'project.stage_changed' && e.correlationId === 'cor_agent');
    expect(moves.map((e) => e.undoneBy !== null)).toEqual([false, true]);
  });
});

describe('A team member undoes their own link change (audit 2026-10-03, API-6)', () => {
  it('undoes an added, an edited and a removed link', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    const added = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'moodboard', url: 'https://pinterest.com/x' }, { correlationId: 'cor_add' });
    await t.api.call('events.undoStory', { correlationId: 'cor_add' });
    expect(t.store.state.projects.prj_001.links ?? []).toHaveLength(0);
    const again = await t.api.call('projects.addLink', { projectId: 'prj_001', kind: 'moodboard', url: 'https://pinterest.com/x' });
    const linkId = again.project.links![0].id;
    await t.api.call('projects.updateLink', { projectId: 'prj_001', linkId, label: 'Board' }, { correlationId: 'cor_edit' });
    await t.api.call('events.undoStory', { correlationId: 'cor_edit' });
    expect(t.store.state.projects.prj_001.links![0].label).toBe('');
    await t.api.call('projects.removeLink', { projectId: 'prj_001', linkId }, { correlationId: 'cor_remove' });
    await t.api.call('events.undoStory', { correlationId: 'cor_remove' });
    expect(t.store.state.projects.prj_001.links).toHaveLength(1);
    expect(added.project.links).toHaveLength(1);
  });

  it('still needs the edit right to undo other project changes', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    t.store.state.events.evt_900 = {
      id: 'evt_900', seq: 900, projectId: 'prj_001', actorId: 'usr_003', actorKind: 'human', actingForId: 'usr_003', correlationId: 'cor_x',
      verb: 'project.updated', targetType: 'project', targetId: 'prj_001', before: { name: 'Old' }, after: { name: 'Test Tower' }, createdAt: '2026-09-30T09:00:00.000+03:00', undoneBy: null,
    };
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_x' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('events.list hides bug reports from people who do not run the office (audit 2026-10-03, API-12)', () => {
  it('gives the reports to the Admin only', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('feedback.send', { kind: 'bug', message: 'Private: my manager keeps changing my due dates', page: '/projects' });
    t.as('usr_004');
    expect(await t.api.call('events.list', { targetType: 'feedback' })).toEqual([]);
    expect((await t.api.call('events.list', {})).some((view) => view.event.targetType === 'feedback')).toBe(false);
    t.as('usr_001');
    expect(await t.api.call('events.list', { targetType: 'feedback' })).toHaveLength(1);
  });
});

describe('events.list compares "since" as a time (audit 2026-10-03, API-20)', () => {
  it('leaves out an event before the time, written in another offset', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    setNow(new Date('2026-09-30T05:00:00Z'));
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [early] = await t.api.call('events.list', { projectId: 'prj_001' });
    expect(early.event.createdAt).toBe('2026-09-30T08:00:00.000+03:00');
    expect(await t.api.call('events.list', { projectId: 'prj_001', since: '2026-09-30T06:00:00.000Z' })).toEqual([]);
    expect(await t.api.call('events.list', { projectId: 'prj_001', since: '2026-09-30T04:00:00.000Z' })).toHaveLength(1);
  });
});

describe('Undo takes back the notices of the undone change (audit 2026-10-03, API-13)', () => {
  it('removes the "task assigned" notice of an undone new task', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Draw sections', ownerId: 'usr_003' }, { correlationId: 'cor_as' });
    t.as('usr_003');
    expect((await t.api.call('notifications.count', {})).badge).toBe(1);
    t.as('usr_002');
    await t.api.call('events.undoStory', { correlationId: 'cor_as' });
    t.as('usr_003');
    expect(await t.api.call('notifications.list', {})).toEqual([]);
    expect((await t.api.call('notifications.count', {})).badge).toBe(0);
  });

  it('removes a review request when the move to review is undone', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', needsReview: true });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_rv' });
    expect(Object.values(t.store.state.notifications).filter((n) => n.userId === 'usr_002')).toHaveLength(1);
    await t.api.call('events.undoStory', { correlationId: 'cor_rv' });
    expect(Object.values(t.store.state.notifications).filter((n) => n.userId === 'usr_002')).toHaveLength(0);
  });

  it('keeps the notices of a story that is only partly undone', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Draw sections', ownerId: 'usr_003' }, { correlationId: 'cor_keep' });
    t.store.state.tasks.tsk_001.title = 'Draw sections';
    expect(Object.values(t.store.state.notifications)).toHaveLength(1);
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Note' }, { correlationId: 'cor_keep' });
    const comment = Object.values(t.store.state.events).find((e) => e.verb === 'comment.created');
    await t.api.call('events.undo', { eventId: comment!.id });
    expect(Object.values(t.store.state.notifications)).toHaveLength(1);
  });
});
