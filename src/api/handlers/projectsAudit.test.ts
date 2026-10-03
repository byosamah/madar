import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calls } from '../calls';
import { makeProject, makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { memoryPersister } from '../persist';
import { projectsDelete } from './projects';
import { setNow } from '../../lib/dates';
import { memberKey } from '../store';

beforeEach(() => setNow(NOW));

// Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Hala (usr_001) is the Admin.

describe('A paused project that leaves the pause closes it (audit 2026-10-03, API-8, PRJ-17)', () => {
  const openLoops = (t: ReturnType<typeof testApi>) => t.api.call('tracker.list', { projectId: 'prj_001', openOnly: true });

  it('closes the pause and its client item when the project is completed', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Waiting for the soil report', kind: 'client' });
    await t.api.call('projects.setStatus', { id: 'prj_001', status: 'completed' });
    expect(t.store.state.projects.prj_001.pause ?? null).toBeNull();
    expect(await openLoops(t)).toEqual([]);
    await t.api.call('projects.setStatus', { id: 'prj_001', status: 'active' });
    expect(t.store.state.projects.prj_001.pause ?? null).toBeNull();
  });

  it('closes them when the project is archived, and one Undo brings both back', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('projects.pause', { id: 'prj_001', reason: 'Waiting for the soil report', kind: 'client' });
    await t.api.call('projects.setStatus', { id: 'prj_001', status: 'archived' }, { correlationId: 'cor_arc' });
    expect(await openLoops(t)).toEqual([]);
    await t.api.call('events.undoStory', { correlationId: 'cor_arc' });
    expect(t.store.state.projects.prj_001.status).toBe('on_hold');
    expect(t.store.state.projects.prj_001.pause?.reason).toBe('Waiting for the soil report');
    expect(await openLoops(t)).toHaveLength(1);
  });

  it('refuses a pause with no reason through projects.setStatus', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await expect(t.api.call('projects.setStatus', { id: 'prj_001', status: 'on_hold' })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'pause_needs_reason' } });
    expect(t.store.state.projects.prj_001.status).toBe('active');
  });
});

describe('Deleting a project removes its Tracker entries and its file data (audit 2026-10-03, API-17)', () => {
  it('leaves no Tracker entry and no stored file data of the project', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('tracker.log', { projectId: 'prj_001', type: 'meeting', direction: 'both', title: 'Kickoff' });
    const file = await t.api.call('files.upload', { projectId: 'prj_001', name: 'plan.pdf', blob: new Blob(['a'], { type: 'application/pdf' }) });
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'plan.pdf', blob: new Blob(['b'], { type: 'application/pdf' }) });
    const keys = t.store.state.files[file.file.id].versions.map((version) => version.blobKey);
    expect(await t.store.persister.getBlob(keys[0])).not.toBeNull();
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    expect(Object.keys(t.store.state.tracker ?? {})).toHaveLength(0);
    for (const key of keys) expect(await t.store.persister.getBlob(key)).toBeNull();
  });

  it('saves the office without the project before it removes the file data (review 2026-10-03)', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await t.api.call('files.upload', { projectId: 'prj_001', name: 'plan.pdf', blob: new Blob(['a'], { type: 'application/pdf' }) });
    const order: string[] = [];
    const { persister } = t.store;
    const save = persister.save.bind(persister);
    const deleteBlob = persister.deleteBlob.bind(persister);
    vi.spyOn(persister, 'save').mockImplementation(async (state) => {
      if (!state.projects.prj_001) order.push('saved without the project');
      return save(state);
    });
    vi.spyOn(persister, 'deleteBlob').mockImplementation(async (key) => {
      order.push('file data removed');
      return deleteBlob(key);
    });
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    expect(order[0]).toBe('saved without the project');
    expect(order).toContain('file data removed');
  });
});

describe('The Team tab counts the tasks a person leads or helps on (audit 2026-10-03, PRJ-3)', () => {
  it('counts a helper task, and names the rule when Remove is refused', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    s.users.usr_006 = { ...s.users.usr_003, id: 'usr_006', name: 'Lina Helper', email: 'lina@madar.test' };
    s.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
    s.tasks.tsk_001 = makeTask({ id: 'tsk_001', ownerId: 'usr_003', title: 'Stair details', helperIds: ['usr_006'] });
    t.as('usr_002');
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.members.find((m) => m.user.id === 'usr_006')?.openTasks).toBe(1);
    await expect(t.api.call('members.remove', { projectId: 'prj_001', userId: 'usr_006' })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'member_has_open_tasks' },
    });
  });
});

describe('projects.get says which members are active (audit 2026-10-03, V-4a)', () => {
  it('marks an inactive member, so a pick list can leave the person out', async () => {
    const t = testApi(calls);
    t.as('usr_001');
    await t.api.call('users.deactivate', { id: 'usr_002' });
    const detail = await t.api.call('projects.get', { id: 'prj_001' });
    expect(detail.members.map((member) => [member.user.id, member.active])).toEqual([['usr_002', false], ['usr_003', true]]);
  });
});

describe('projects.delete removes data by the ids of the project, not by absence (plan 4.13, A2; AM 7.2)', () => {
  /** Project B (prj_002) with a task, a post, a comment on each, and a notice for each. */
  function withProjectB(t: ReturnType<typeof testApi>) {
    const s = t.store.state;
    s.projects.prj_002 = makeProject({ id: 'prj_002', code: 'KH-26-002', name: 'Other Tower' });
    s.tasks.tsk_201 = makeTask({ id: 'tsk_201', projectId: 'prj_002' });
    s.updates.upd_201 = { id: 'upd_201', projectId: 'prj_002', authorId: 'usr_002', body: 'B post', fileIds: [], createdAt: STAMP, editedAt: null };
    const comment = { authorId: 'usr_002', body: 'B note', reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: STAMP, editedAt: null };
    s.comments.cmt_201 = { ...comment, id: 'cmt_201', targetType: 'task', targetId: 'tsk_201' };
    s.comments.cmt_202 = { ...comment, id: 'cmt_202', targetType: 'update', targetId: 'upd_201' };
    const notice = { userId: 'usr_003', trigger: 'mention' as const, actorId: 'usr_002', read: false, createdAt: STAMP, dedupeKey: null };
    s.notifications.ntf_201 = { ...notice, id: 'ntf_201', targetType: 'task', targetId: 'tsk_201' };
    s.notifications.ntf_202 = { ...notice, id: 'ntf_202', targetType: 'update', targetId: 'upd_201' };
    s.notifications.ntf_203 = { ...notice, id: 'ntf_203', targetType: 'project', targetId: 'prj_002' };
  }

  /** Project A (prj_001) with the same set, so the delete has something of its own to remove. */
  function withProjectA(t: ReturnType<typeof testApi>) {
    const s = t.store.state;
    s.tasks.tsk_101 = makeTask({ id: 'tsk_101' });
    s.updates.upd_101 = { id: 'upd_101', projectId: 'prj_001', authorId: 'usr_002', body: 'A post', fileIds: [], createdAt: STAMP, editedAt: null };
    const comment = { authorId: 'usr_002', body: 'A note', reactions: { '👍': [], '✅': [], '👀': [] }, createdAt: STAMP, editedAt: null };
    s.comments.cmt_101 = { ...comment, id: 'cmt_101', targetType: 'task', targetId: 'tsk_101' };
    s.comments.cmt_102 = { ...comment, id: 'cmt_102', targetType: 'update', targetId: 'upd_101' };
    const notice = { userId: 'usr_003', trigger: 'mention' as const, actorId: 'usr_002', read: false, createdAt: STAMP, dedupeKey: null };
    s.notifications.ntf_101 = { ...notice, id: 'ntf_101', targetType: 'task', targetId: 'tsk_101' };
    s.notifications.ntf_102 = { ...notice, id: 'ntf_102', targetType: 'update', targetId: 'upd_101' };
    s.notifications.ntf_103 = { ...notice, id: 'ntf_103', targetType: 'project', targetId: 'prj_001' };
  }

  it('removes the comments and notices of the project and keeps those of another project', async () => {
    const t = testApi(calls);
    withProjectA(t);
    withProjectB(t);
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    const s = t.store.state;
    expect(Object.keys(s.comments).sort()).toEqual(['cmt_201', 'cmt_202']);
    expect(Object.keys(s.notifications).sort()).toEqual(['ntf_201', 'ntf_202', 'ntf_203']);
  });

  it('keeps the comments and notices of another project whose task and post the server did not load', async () => {
    const t = testApi(calls);
    withProjectA(t);
    withProjectB(t);
    // The server loads only what the delete needs. Rows of project B that point at rows it did not load must stay.
    delete t.store.state.tasks.tsk_201;
    delete t.store.state.updates.upd_201;
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    const s = t.store.state;
    expect(Object.keys(s.comments).sort()).toEqual(['cmt_201', 'cmt_202']);
    expect(Object.keys(s.notifications).sort()).toEqual(['ntf_201', 'ntf_202', 'ntf_203']);
  });

  it('removes the comments and notices of a task and a post that were deleted before the project (review 2026-10-03)', async () => {
    const t = testApi(calls);
    withProjectA(t);
    withProjectB(t);
    t.as('usr_002');
    await t.api.call('tasks.delete', { id: 'tsk_101' });
    await t.api.call('updates.delete', { id: 'upd_101' });
    // The deletes keep the comments and notices, so an Undo can bring them back.
    expect(t.store.state.comments.cmt_101).toBeDefined();
    expect(t.store.state.notifications.ntf_102).toBeDefined();
    t.as('usr_001');
    await t.api.call('projects.delete', { id: 'prj_001', confirm: true });
    const s = t.store.state;
    expect(Object.keys(s.comments).sort()).toEqual(['cmt_201', 'cmt_202']);
    expect(Object.keys(s.notifications).sort()).toEqual(['ntf_201', 'ntf_202', 'ntf_203']);
  });

  it('removes the picture data of the project with its file data, and keeps a key that blobKeysInUse reports (review 2026-10-03)', async () => {
    const t = testApi(calls);
    const s = t.store.state;
    const version = { letter: 'A', blobKey: 'prj-001/fil-901/1', thumbKey: 'prj-001/fil-901/1/thumb', size: 1, mimeType: 'image/png', uploadedBy: 'usr_002', uploadedAt: STAMP };
    s.files.fil_901 = { id: 'fil_901', projectId: 'prj_001', stageId: null, taskId: null, name: 'site.png', versions: [version] };
    const keys = (await projectsDelete.prepare!({ id: 'prj_001', confirm: true }, { state: s } as never)) as { blobKeys: string[] };
    expect(keys.blobKeys.sort()).toEqual(['prj-001/fil-901/1', 'prj-001/fil-901/1/thumb']);
    const persister = memoryPersister();
    for (const key of keys.blobKeys) await persister.putBlob(key, new Blob(['x']));
    const ctx = {
      state: s, persister, actor: s.users.usr_001, now: NOW,
      async blobKeysInUse() { return new Set(['prj-001/fil-901/1']); },
    };
    await projectsDelete.after!({ deleted: true }, ctx, keys);
    expect(await persister.getBlob('prj-001/fil-901/1')).not.toBeNull();
    expect(await persister.getBlob('prj-001/fil-901/1/thumb')).toBeNull();
  });

  it('keeps the stored data that blobKeysInUse reports, and removes the rest', async () => {
    const t = testApi(calls);
    const persister = memoryPersister();
    await persister.putBlob('blob_kept', new Blob(['a']));
    await persister.putBlob('blob_gone', new Blob(['b']));
    const asked: string[][] = [];
    const ctx = {
      state: t.store.state, persister, actor: t.store.state.users.usr_001, now: NOW,
      async blobKeysInUse(keys: string[]) {
        asked.push(keys);
        return new Set(['blob_kept']);
      },
    };
    await projectsDelete.after!({ deleted: true }, ctx, { blobKeys: ['blob_kept', 'blob_gone'] });
    expect(asked).toEqual([['blob_kept', 'blob_gone']]);
    expect(await persister.getBlob('blob_kept')).not.toBeNull();
    expect(await persister.getBlob('blob_gone')).toBeNull();
  });
});
