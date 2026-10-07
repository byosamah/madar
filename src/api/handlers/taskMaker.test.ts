import { beforeEach, describe, expect, it } from 'vitest';
import { historyCalls } from './history';
import { projectCalls } from './projects';
import { taskCalls } from './tasks';
import type { Store } from '../store';
import { memberKey } from '../store';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));
const calls = { ...taskCalls, ...historyCalls, ...projectCalls };

/** The newest change in the store. */
const latest = (store: Store) => Object.values(store.state.events).sort((a, b) => b.seq - a.seq)[0];

/** A team member (usr_003) adds a task with a title only, as the quick add does. */
async function memberTask() {
  const t = testApi(calls);
  t.store.state.tasks.tsk_001 = makeTask({ stageId: 'stg_001' });
  t.store.state.counters.tsk = 1;
  t.as('usr_003');
  const { task } = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Roof plan' });
  return { t, id: task.id };
}

describe('the maker of a project task (owner, 2026-10-07)', () => {
  it('names a team mate as lead, sets helpers, dates and the title, and deletes the task', async () => {
    const { t, id } = await memberTask();
    await t.api.call('tasks.update', { id, patch: { ownerId: 'usr_002', helperIds: ['usr_003'], dueDate: '2026-10-12', title: 'Roof plan v2' } });
    expect(t.store.state.tasks[id]).toMatchObject({ ownerId: 'usr_002', helperIds: ['usr_003'], dueDate: '2026-10-12', title: 'Roof plan v2' });
    await t.api.call('tasks.update', { id, patch: { prerequisiteIds: ['tsk_001'] } });
    expect(t.store.state.tasks[id].prerequisiteIds).toEqual(['tsk_001']);
    await t.api.call('tasks.delete', { id });
    expect(t.store.state.tasks[id]).toBeUndefined();
  });

  it('names a lead, helpers and prerequisites when it adds the task', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ stageId: 'stg_001' });
    t.store.state.counters.tsk = 1;
    t.as('usr_003');
    const { task } = await t.api.call('tasks.create', {
      projectId: 'prj_001', title: 'Sections', ownerId: 'usr_002', helperIds: ['usr_003'], prerequisiteIds: ['tsk_001'],
    });
    expect(task).toMatchObject({ ownerId: 'usr_002', helperIds: ['usr_003'], prerequisiteIds: ['tsk_001'], needsReview: true, createdBy: 'usr_003' });
  });

  it('leaves the review to the leader', async () => {
    const { t, id } = await memberTask();
    await expect(t.api.call('tasks.update', { id, patch: { needsReview: false } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.create', { projectId: 'prj_001', title: 'X', needsReview: false })).rejects.toMatchObject({ code: 'forbidden' });
    await t.api.call('tasks.update', { id, patch: { ownerId: 'usr_003' } });
    expect((await t.api.call('tasks.complete', { id })).result).toBe('in_review');
    await expect(t.api.call('tasks.approve', { id })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.sendBack', { id, note: 'Fix it' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('shows the maker the edit rights, and not the review rights', async () => {
    const { t, id } = await memberTask();
    const detail = await t.api.call('tasks.get', { id });
    expect(detail.viewerCan).toMatchObject({ edit: true, editAll: true, delete: true, review: false, setNeedsReview: false, saveTemplate: false });
    t.as('usr_002');
    expect((await t.api.call('tasks.get', { id })).viewerCan).toMatchObject({ editAll: true, setNeedsReview: true, saveTemplate: true });
  });

  it('names only a person on the team', async () => {
    const { t, id } = await memberTask();
    await expect(t.api.call('tasks.update', { id, patch: { ownerId: 'usr_004' } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_on_team' } });
    await expect(t.api.call('tasks.update', { id, patch: { helperIds: ['usr_004'] } }))
      .rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'not_on_team' } });
    expect(t.store.state.members[memberKey('prj_001', 'usr_004')]).toBeUndefined();
  });

  it('gives another team member no new rights', async () => {
    const { t, id } = await memberTask();
    t.store.state.members[memberKey('prj_001', 'usr_004')] = { projectId: 'prj_001', userId: 'usr_004', discipline: 'Architect' };
    t.as('usr_004');
    await expect(t.api.call('tasks.update', { id, patch: { title: 'Mine now' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.update', { id, patch: { ownerId: 'usr_002' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.delete', { id })).rejects.toMatchObject({ code: 'forbidden' });
    expect((await t.api.call('tasks.get', { id })).viewerCan).toMatchObject({ edit: false, editAll: false, delete: false, take: true });
  });

  it('ends when the maker leaves the team', async () => {
    const { t, id } = await memberTask();
    delete t.store.state.members[memberKey('prj_001', 'usr_003')];
    await expect(t.api.call('tasks.update', { id, patch: { title: 'Late change' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('tasks.delete', { id })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('holds for the person of an agent that made the task', async () => {
    const t = testApi(calls);
    t.as('usr_005');
    const { task } = await t.api.call('tasks.create', { projectId: 'prj_001', title: 'Area check', ownerId: 'usr_002' });
    expect(task).toMatchObject({ ownerId: 'usr_002', createdBy: 'usr_005' });
    t.as('usr_003');
    await t.api.call('tasks.update', { id: task.id, patch: { ownerId: null, title: 'Area check v2' } });
    expect(t.store.state.tasks[task.id]).toMatchObject({ ownerId: null, title: 'Area check v2' });
  });

  it('takes back its own lead change and its delete with Undo', async () => {
    const { t, id } = await memberTask();
    await t.api.call('tasks.update', { id, patch: { ownerId: 'usr_002' } });
    await t.api.call('events.undo', { eventId: latest(t.store).id });
    expect(t.store.state.tasks[id].ownerId).toBeNull();
    await t.api.call('tasks.delete', { id });
    await t.api.call('events.undo', { eventId: latest(t.store).id });
    expect(t.store.state.tasks[id]).toMatchObject({ title: 'Roof plan' });
  });

  it('takes back the add of its task with Undo', async () => {
    const { t, id } = await memberTask();
    const created = Object.values(t.store.state.events).find((event) => event.verb === 'task.created' && event.targetId === id);
    await t.api.call('events.undo', { eventId: created!.id });
    expect(t.store.state.tasks[id]).toBeUndefined();
  });

  it('never takes back a change of the review need', async () => {
    const { t, id } = await memberTask();
    t.as('usr_002');
    await t.api.call('tasks.update', { id, patch: { needsReview: false } });
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: latest(t.store).id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks[id].needsReview).toBe(false);
  });
});
