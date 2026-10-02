import { beforeEach, describe, expect, it } from 'vitest';
import { calls } from '../calls';
import { makeTask, NOW, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';
import { memberKey } from '../store';

beforeEach(() => setNow(NOW));

// Faisal (usr_002) leads prj_001, Sara (usr_003) is on the team, Hala (usr_001) is the Admin.
const pdf = () => new Blob(['%PDF-1.4'], { type: 'application/pdf' });

describe('files.upload takes only a picture as the cover (audit 2026-10-03, API-16)', () => {
  it('refuses a PDF as the cover and stores nothing', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    await expect(t.api.call('files.upload', { projectId: 'prj_001', name: 'contract.pdf', blob: pdf(), asCover: true })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'cover_not_image' },
    });
    expect(t.store.state.projects.prj_001.coverFileId).toBeNull();
    expect(Object.keys(t.store.state.files)).toHaveLength(0);
  });

  it('still takes a picture as the cover', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const view = await t.api.call('files.upload', { projectId: 'prj_001', name: 'front.png', blob: new Blob(['x'], { type: 'image/png' }), asCover: true });
    expect(t.store.state.projects.prj_001.coverFileId).toBe(view.file.id);
  });
});

describe('reactions.toggle writes an event (audit 2026-10-03, API-19)', () => {
  it('logs the reaction with the agent and the person it acts for, and the person may take it back', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_002');
    const comment = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Please check the stairs.' });
    t.as('usr_005');
    await t.api.call('reactions.toggle', { commentId: comment.comment.id, emoji: '👍' }, { correlationId: 'cor_react' });
    const event = Object.values(t.store.state.events).find((e) => e.verb === 'comment.reacted');
    expect(event).toMatchObject({ actorId: 'usr_005', actingForId: 'usr_003', targetType: 'comment', targetId: comment.comment.id });
    expect((event?.after as { reactions: Record<string, string[]> }).reactions['👍']).toEqual(['usr_005']);
    t.as('usr_003');
    await t.api.call('events.undoStory', { correlationId: 'cor_react' });
    expect(t.store.state.comments[comment.comment.id].reactions['👍']).toEqual([]);
  });
});

describe('Undo of a comment edit', () => {
  it('brings back the words the comment had', async () => {
    const t = testApi(calls);
    t.store.state.tasks.tsk_001 = makeTask();
    t.as('usr_003');
    const comment = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'First words' });
    await t.api.call('comments.update', { id: comment.comment.id, body: 'New words' }, { correlationId: 'cor_edit' });
    await t.api.call('events.undoStory', { correlationId: 'cor_edit' });
    expect(t.store.state.comments[comment.comment.id].body).toBe('First words');
  });
});

describe('A post carries its files as attachments (audit 2026-10-03, PRJ-6)', () => {
  it('names each file, and gives a null name for a deleted one', async () => {
    const t = testApi(calls);
    t.as('usr_002');
    const notes = await t.api.call('files.upload', { projectId: 'prj_001', name: 'Brief notes.txt', blob: new Blob(['n'], { type: 'text/plain' }) });
    const post = await t.api.call('updates.create', { projectId: 'prj_001', body: 'Notes from the client', fileIds: [notes.file.id] });
    expect(post.kind === 'update' && post.attachments).toEqual([{ id: notes.file.id, name: 'Brief notes.txt' }]);
    await t.api.call('files.delete', { id: notes.file.id });
    const [item] = await t.api.call('updates.list', { projectId: 'prj_001', filter: 'posts' });
    expect(item.kind === 'update' && item.attachments).toEqual([{ id: notes.file.id, name: null }]);
  });
});

describe('Each file says if the viewer may delete it (audit 2026-10-03, PRJ-16)', () => {
  it('lets the uploader on the team, the leader and the Admin delete, and not an uploader who left', async () => {
    const t = testApi(calls);
    t.as('usr_003');
    const view = await t.api.call('files.upload', { projectId: 'prj_001', name: 'sketch.png', blob: new Blob(['s'], { type: 'image/png' }) });
    expect(view.canDelete).toBe(true);
    t.as('usr_002');
    expect((await t.api.call('files.list', { projectId: 'prj_001' }))[0].canDelete).toBe(true);
    t.as('usr_001');
    expect((await t.api.call('files.list', { projectId: 'prj_001' }))[0].canDelete).toBe(true);
    delete t.store.state.members[memberKey('prj_001', 'usr_003')];
    t.as('usr_003');
    expect((await t.api.call('files.list', { projectId: 'prj_001' }))[0].canDelete).toBe(false);
    await expect(t.api.call('files.delete', { id: view.file.id })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
