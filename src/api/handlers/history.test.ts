import { beforeEach, describe, expect, it } from 'vitest';
import { fileCalls } from './files';
import { historyCalls } from './history';
import { peopleCalls } from './people';
import { projectCalls } from './projects';
import { taskCalls } from './tasks';
import { makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { memberKey } from '../store';

beforeEach(() => setNow(NOW));
const calls = { ...taskCalls, ...historyCalls, ...projectCalls, ...peopleCalls };

describe('events', () => {
  it('lists only the events at or after the stamp in since', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    setNow(new Date(NOW.getTime() + 60 * 60 * 1000));
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    const all = await t.api.call('events.list', { projectId: 'prj_001' });
    expect(all).toHaveLength(2);
    const since = all[0].event.createdAt;
    expect(since > all[1].event.createdAt).toBe(true);
    const late = await t.api.call('events.list', { projectId: 'prj_001', since });
    expect(late.map((view) => view.event.id)).toEqual([all[0].event.id]);
    expect(late[0].label).toBeTruthy();
  });

  it('undoes my own change', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [latest] = await t.api.call('events.list', { targetType: 'task', targetId: 'tsk_001' });
    await t.api.call('events.undo', { eventId: latest.event.id });
    expect(t.store.state.tasks.tsk_001.status).toBe('todo');
  });

  it("lets the leader or the agent's person undo an agent change, and stops others", async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ ownerId: 'usr_003', needsReview: false });
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', ownerId: 'usr_003', needsReview: false });
    t.as('usr_005');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    await t.api.call('tasks.complete', { id: 'tsk_002' });
    const [second, first] = await t.api.call('events.list', { projectId: 'prj_001' });
    expect(first.actor.kind).toBe('agent');
    expect(first.event.actingForId).toBe('usr_003');
    t.as('usr_004');
    await expect(t.api.call('events.undo', { eventId: first.event.id })).rejects.toMatchObject({ code: 'forbidden' });
    t.as('usr_002');
    await t.api.call('events.undo', { eventId: first.event.id });
    expect(t.store.state.tasks.tsk_001.status).toBe('todo');
    t.as('usr_003');
    await t.api.call('events.undo', { eventId: second.event.id });
    expect(t.store.state.tasks.tsk_002.status).toBe('todo');
  });

  it('reports a conflict when the item changed later', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' });
    const [done] = await t.api.call('events.list', { targetId: 'tsk_001' });
    t.as('usr_002');
    await t.api.call('tasks.move', { id: 'tsk_001', status: 'in_progress' });
    t.as('usr_003');
    await expect(t.api.call('events.undo', { eventId: done.event.id })).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('undo keeps the rules of the original action', () => {
  it('stops a leader who gave the project away from taking it back by undo', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.setLeader', { id: 'prj_001', leaderId: 'usr_003' });
    const [change] = await t.api.call('events.list', { projectId: 'prj_001', targetType: 'project' });
    expect(change.event.verb).toBe('project.leader_changed');
    await expect(t.api.call('events.undo', { eventId: change.event.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.projects.prj_001.leaderId).toBe('usr_003');
  });

  it('refuses to undo a create that other items now use', async () => {
    const t = testApi(calls);
    const user = await t.api.call('users.create', { name: 'New Person', email: 'new@madar.test', discipline: 'Engineer' });
    await t.api.call('members.add', { projectId: 'prj_001', userId: user.id });
    const [created] = await t.api.call('events.list', { targetType: 'user', targetId: user.id });
    await expect(t.api.call('events.undo', { eventId: created.event.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(t.store.state.users[user.id]).toBeDefined();
  });

  it('refuses to bring back a task whose project is gone', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask();
    await t.api.call('tasks.delete', { id: 'tsk_001' });
    const [deleted] = await t.api.call('events.list', { targetId: 'tsk_001' });
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    await expect(t.api.call('events.undo', { eventId: deleted.event.id })).rejects.toMatchObject({ code: 'conflict' });
    expect(t.store.state.tasks.tsk_001).toBeUndefined();
  });
});

describe('undo of a whole story', () => {
  const image = {
    id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Render.png',
    versions: [{ letter: 'A', blobKey: 'blob_1', mimeType: 'image/png', size: 10, uploadedBy: 'usr_002', uploadedAt: STAMP }],
  };

  it('undoes every change of one story, newest first', async () => {
    const t = testApi({ ...calls, ...fileCalls });
    t.store.state.files.fil_001 = structuredClone(image);
    t.store.state.projects.prj_001.coverFileId = 'fil_001';
    t.as('usr_002');
    await t.api.call('files.delete', { id: 'fil_001' }, { correlationId: 'cor_ui_story1' });
    expect(t.store.state.projects.prj_001.coverFileId).toBeNull();
    const result = await t.api.call('events.undoStory', { correlationId: 'cor_ui_story1' });
    expect(result.undone).toHaveLength(2);
    expect(t.store.state.files.fil_001).toBeDefined();
    expect(t.store.state.projects.prj_001.coverFileId).toBe('fil_001');
  });

  it("refuses another person's story and changes nothing", async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask({ needsReview: false });
    t.as('usr_003');
    await t.api.call('tasks.complete', { id: 'tsk_001' }, { correlationId: 'cor_ui_story2' });
    t.as('usr_004');
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_ui_story2' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.tasks.tsk_001.status).toBe('done');
  });

  it('lets a team member undo the delete of their own file that was the cover', async () => {
    const t = testApi({ ...calls, ...fileCalls });
    t.store.state.files.fil_001 = { ...structuredClone(image), versions: [{ ...image.versions[0], uploadedBy: 'usr_003' }] };
    t.store.state.projects.prj_001.coverFileId = 'fil_001';
    t.as('usr_003');
    await t.api.call('files.delete', { id: 'fil_001' }, { correlationId: 'cor_ui_story4' });
    await t.api.call('events.undoStory', { correlationId: 'cor_ui_story4' });
    expect(t.store.state.files.fil_001).toBeDefined();
    expect(t.store.state.projects.prj_001.coverFileId).toBe('fil_001');
  });

  it('does not bring the cover back for a person who left the team', async () => {
    const t = testApi({ ...calls, ...fileCalls });
    t.store.state.files.fil_001 = { ...structuredClone(image), versions: [{ ...image.versions[0], uploadedBy: 'usr_003' }] };
    t.store.state.projects.prj_001.coverFileId = 'fil_001';
    t.as('usr_003');
    await t.api.call('files.delete', { id: 'fil_001' }, { correlationId: 'cor_ui_story5' });
    const story = Object.values(t.store.state.events).filter((e) => e.correlationId === 'cor_ui_story5');
    const cover = story.find((e) => e.verb === 'project.cover_changed');
    await t.api.call('events.undo', { eventId: story.find((e) => e.verb === 'file.deleted')!.id });
    delete t.store.state.members[memberKey('prj_001', 'usr_003')];
    await expect(t.api.call('events.undo', { eventId: cover!.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(t.store.state.projects.prj_001.coverFileId).toBeNull();
  });

  it('reports an unknown story', async () => {
    const t = testApi(calls);
    await expect(t.api.call('events.undoStory', { correlationId: 'cor_ui_none' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
