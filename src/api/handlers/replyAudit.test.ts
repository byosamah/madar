import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { memberKey } from '../store';

beforeEach(() => setNow(NOW));

// Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Hala (usr_001) is the Admin.
// Concept (stg_001) runs in August, Schematic Design (stg_002) from September.
const world = () => testApi(calls);
type T = ReturnType<typeof world>;
async function ask(t: T, title = 'Client asks for the area table') {
  const row = await t.api.call('tracker.log', {
    projectId: 'prj_001', type: 'message', direction: 'in', title, waiting: 'us', replyBy: { userId: 'usr_003', dueDate: '2026-10-05' },
  });
  return { entryId: row.entry.id, taskId: t.store.state.tracker![row.entry.id].replyTaskId! };
}

describe('Reply tasks follow the task rules (audit 2026-10-03, API-9)', () => {
  it('closes the entry while the reply task waits for another task, and the task stays open and unlinked (V-13 rule, review 2026-10-03)', async () => {
    const t = world();
    t.as('usr_002');
    const { entryId, taskId } = await ask(t);
    t.store.state.tasks.tsk_900 = makeTask({ id: 'tsk_900', ownerId: 'usr_003', title: 'Must come first' });
    t.store.state.counters.tsk = 900;
    await t.api.call('tasks.update', { id: taskId, patch: { prerequisiteIds: ['tsk_900'] } });
    await t.api.call('tracker.close', { id: entryId }, { correlationId: 'cor_close' });
    const s = t.store.state;
    expect(s.tracker![entryId].closedAt).not.toBeNull();
    expect(s.tracker![entryId].replyTaskId ?? null).toBeNull();
    expect(s.tasks[taskId].status).toBe('todo');
    expect(s.tasks[taskId].trackerEntryId ?? null).toBeNull();
    // One Undo brings back the open entry and the link.
    await t.api.call('events.undoStory', { correlationId: 'cor_close' });
    expect(s.tracker![entryId].closedAt).toBeNull();
    expect(s.tracker![entryId].replyTaskId).toBe(taskId);
    expect(s.tasks[taskId].trackerEntryId).toBe(entryId);
  });

  it('moves the stage tag when closing the entry finishes the last open task of a stage', async () => {
    const t = world();
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', stageId: 'stg_001', ownerId: 'usr_003', needsReview: false });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', stageId: 'stg_002', ownerId: 'usr_003', title: 'SD work' });
    s.counters.tsk = 2;
    s.projects.prj_001.currentStageId = 'stg_001';
    t.as('usr_002');
    const { entryId, taskId } = await ask(t);
    expect(s.tasks[taskId].stageId).toBe('stg_001');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('projects.setHealthOverride', { id: 'prj_001', value: 'at_risk', reason: 'Client is slow' });
    await t.api.call('tracker.close', { id: entryId });
    expect(s.projects.prj_001.currentStageId).toBe('stg_002');
    expect(s.projects.prj_001.healthOverride).toBeNull();
    expect(Object.values(s.events).some((e) => e.verb === 'project.stage_changed' && (e.after as { currentStageId?: string }).currentStageId === 'stg_002')).toBe(true);
  });

  it('opens the reply task in the stage the project is in, not in a stale saved stage', async () => {
    const t = world();
    const s = t.store.state;
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', stageId: 'stg_001', status: 'done', completedAt: '2026-08-30T09:00:00.000+03:00' });
    s.tasks.tsk_002 = makeTask({ id: 'tsk_002', stageId: 'stg_002', title: 'SD work' });
    s.counters.tsk = 2;
    s.projects.prj_001.currentStageId = 'stg_001';
    t.as('usr_002');
    const { taskId } = await ask(t);
    expect(s.tasks[taskId].stageId).toBe('stg_002');
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.currentStage.id).toBe('stg_002');
    expect(detail.project.currentStageId).toBe('stg_002');
    expect(detail.project.stageBack ?? null).toBeNull();
  });

  it('closes the open reply task when the entry stops waiting for our reply', async () => {
    const t = world();
    t.as('usr_002');
    const { entryId, taskId } = await ask(t);
    await t.api.call('tracker.update', { id: entryId, waiting: null });
    expect(t.store.state.tasks[taskId].status).toBe('done');
    expect(Object.values(t.store.state.tracker!).filter((entry) => entry.auto === 'reply')).toHaveLength(0);
  });
});

describe('Ending the wait is never refused (audit 2026-10-03, V-13)', () => {
  async function waitingReply(t: T, userId = 'usr_003') {
    const row = await t.api.call('tracker.log', {
      projectId: 'prj_001', type: 'message', direction: 'in', title: 'Client asks for the area table', waiting: 'us', replyBy: { userId, dueDate: '2026-10-05' },
    });
    const entryId = row.entry.id;
    const taskId = t.store.state.tracker![entryId].replyTaskId!;
    t.store.state.tasks.tsk_900 = makeTask({ id: 'tsk_900', ownerId: 'usr_003', title: 'Must come first' });
    t.store.state.counters.tsk = 900;
    await t.api.call('tasks.update', { id: taskId, patch: { prerequisiteIds: ['tsk_900'] } });
    return { entryId, taskId };
  }

  for (const waiting of [null, 'client'] as const) {
    it(`unlinks the reply task and keeps it open when the entry stops waiting for us (waiting ${waiting})`, async () => {
      const t = world();
      t.as('usr_002');
      const { entryId, taskId } = await waitingReply(t);
      await t.api.call('tracker.update', { id: entryId, waiting });
      const s = t.store.state;
      expect(s.tracker![entryId].waiting).toBe(waiting);
      expect(s.tracker![entryId].replyTaskId ?? null).toBeNull();
      expect(s.tasks[taskId].status).toBe('todo');
      expect(s.tasks[taskId].trackerEntryId ?? null).toBeNull();
      expect(Object.values(s.tracker!).filter((entry) => entry.auto === 'reply')).toHaveLength(0);
    });
  }

  it('lets the team member who ended the wait undo it, and the link comes back', async () => {
    const t = world();
    t.as('usr_002');
    const { entryId, taskId } = await waitingReply(t, 'usr_002');
    t.as('usr_003');
    await t.api.call('tracker.update', { id: entryId, waiting: null }, { correlationId: 'cor_end' });
    await t.api.call('events.undoStory', { correlationId: 'cor_end' });
    const s = t.store.state;
    expect(s.tracker![entryId].waiting).toBe('us');
    expect(s.tracker![entryId].replyTaskId).toBe(taskId);
    expect(s.tasks[taskId].trackerEntryId).toBe(entryId);
  });
});

describe('A deactivated leader does not stop reviews (audit 2026-10-03, API-7)', () => {
  it('sends the review request to the active Admins', async () => {
    const t = world();
    t.store.state.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', needsReview: true });
    t.as('usr_001');
    await t.api.call('users.deactivate', { id: 'usr_002' });
    t.as('usr_003');
    expect((await t.api.call('tasks.complete', { id: 'tsk_001' })).result).toBe('in_review');
    expect(Object.values(t.store.state.notifications).filter((n) => n.trigger === 'review_requested').map((n) => n.userId)).toEqual(['usr_001']);
    t.as('usr_001');
    expect((await t.api.call('tasks.list', { filter: 'review_for_me' })).map((row) => row.task.id)).toEqual(['tsk_001']);
  });

  it('refuses an inactive person as the lead, a helper or the person who replies', async () => {
    const t = world();
    const s = t.store.state;
    s.users.usr_006 = { ...s.users.usr_003, id: 'usr_006', name: 'Lina Gone', email: 'lina@madar.test', active: false };
    s.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003' });
    t.as('usr_002');
    const refused = { code: 'invalid_input', details: { reason: 'person_inactive' } };
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'Sections', ownerId: 'usr_006' })).rejects.toMatchObject(refused);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { ownerId: 'usr_006' } })).rejects.toMatchObject(refused);
    await expect(t.api.call('tasks.update', { id: 'tsk_001', patch: { helperIds: ['usr_006'] } })).rejects.toMatchObject(refused);
    await expect(t.api.call('tracker.log', {
      projectId: 'prj_001', type: 'message', direction: 'in', title: 'Question', waiting: 'us', replyBy: { userId: 'usr_006', dueDate: '2026-10-05' },
    })).rejects.toMatchObject(refused);
  });

  it('keeps an inactive helper who is already on a task when the leader edits the task', async () => {
    const t = world();
    const s = t.store.state;
    s.users.usr_006 = { ...s.users.usr_003, id: 'usr_006', name: 'Lina Gone', email: 'lina@madar.test', active: false };
    s.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', helperIds: ['usr_006'] });
    t.as('usr_002');
    const detail = await t.api.call('tasks.update', { id: 'tsk_001', patch: { title: 'Stair details', helperIds: ['usr_006'] } });
    expect(detail.task.title).toBe('Stair details');
  });
});
