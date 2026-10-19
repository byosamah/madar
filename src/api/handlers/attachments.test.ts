import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { fileCalls } from './files';
import { shareCalls } from './sharing';
import { addProjectConversation } from '../chatState';
import { makeProject, makeTask, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

const calls = { ...chatCalls, ...contentCalls, ...fileCalls, ...shareCalls };

// Hala is the Admin, Faisal leads prj_001, Sara is on the team, Omar is outside. File fil_001 is in prj_001, fil_002 is in prj_002 (nobody but Hala leads it).
function world() {
  const t = testApi(calls);
  const state = t.store.state;
  const room = addProjectConversation(state, 'prj_001', STAMP);
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'P-002', name: 'Other project', leaderId: 'usr_001' });
  state.tasks.tsk_001 = makeTask();
  const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
  state.files.fil_001 = { id: 'fil_001', projectId: 'prj_001', stageId: null, taskId: null, name: 'Plan.pdf', versions: [version] };
  state.files.fil_002 = { id: 'fil_002', projectId: 'prj_002', stageId: null, taskId: null, name: 'Secret.pdf', versions: [version] };
  return { ...t, room: room.id };
}

describe('files in comments', () => {
  it('stores the files of a task comment and returns their names', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'See the plan.', fileIds: ['fil_001'] });
    expect(made.comment.fileIds).toEqual(['fil_001']);
    expect(made.files).toEqual([{ id: 'fil_001', name: 'Plan.pdf', mimeType: 'application/pdf' }]);
    const listed = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(listed[0].files).toEqual([{ id: 'fil_001', name: 'Plan.pdf', mimeType: 'application/pdf' }]);
  });

  it('gives each file the type of its newest version, so a screen can show a picture as a preview (owner, 2026-10-19)', async () => {
    const t = world();
    t.as('usr_003');
    const state = t.store.state;
    const first = state.files.fil_001.versions[0];
    state.files.fil_003 = {
      id: 'fil_003', projectId: 'prj_001', stageId: null, taskId: null, name: 'Site.jpg',
      versions: [{ ...first, mimeType: 'application/pdf' }, { ...first, letter: 'B', mimeType: 'image/jpeg' }],
    };
    const made = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Photo.', fileIds: ['fil_003', 'fil_001'] });
    expect(made.files).toEqual([
      { id: 'fil_003', name: 'Site.jpg', mimeType: 'image/jpeg' },
      { id: 'fil_001', name: 'Plan.pdf', mimeType: 'application/pdf' },
    ]);
  });

  it('takes a comment with no files and an old saved comment without the list', async () => {
    const t = world();
    t.as('usr_003');
    const made = await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'No files.' });
    expect(made.files).toEqual([]);
    delete t.store.state.comments[made.comment.id].fileIds;
    expect((await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' }))[0].files).toEqual([]);
  });

  it('refuses a file that does not exist, a file of another project and more than 10 files', async () => {
    const t = world();
    t.as('usr_003');
    const base = { targetType: 'task' as const, targetId: 'tsk_001', body: 'Files.' };
    await expect(t.api.call('comments.create', { ...base, fileIds: ['fil_099'] })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'file_missing' } });
    await expect(t.api.call('comments.create', { ...base, fileIds: ['fil_002'] })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'file_other_project' } });
    const many = Array.from({ length: 11 }, () => 'fil_001');
    await expect(t.api.call('comments.create', { ...base, fileIds: many })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('shows a deleted file as removed and keeps the comment readable', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'See the plan.', fileIds: ['fil_001'] });
    await t.api.call('files.delete', { id: 'fil_001' });
    const listed = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(listed[0].comment.body).toBe('See the plan.');
    expect(listed[0].files).toEqual([{ id: 'fil_001', name: null }]);
  });
});

describe('files in chat messages', () => {
  it('stores the files of a project chat message', async () => {
    const t = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: t.room, body: 'The plan.', fileIds: ['fil_001'] });
    expect(sent.message.fileIds).toEqual(['fil_001']);
    expect(sent.files).toEqual([{ id: 'fil_001', name: 'Plan.pdf', mimeType: 'application/pdf' }]);
    expect((await t.api.call('chats.messages', { conversationId: t.room })).messages[0].files[0].name).toBe('Plan.pdf');
  });

  it('refuses a file of another project in a project chat', async () => {
    const t = world();
    t.as('usr_001');
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Hi', fileIds: ['fil_002'] })).rejects.toMatchObject({ details: { reason: 'file_other_project' } });
  });

  it('refuses a file the sender cannot see in a direct chat', async () => {
    const t = world();
    t.as('usr_004');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_003' });
    await expect(t.api.call('chats.send', { conversationId: id, body: 'Look', fileIds: ['fil_001'] })).rejects.toMatchObject({ code: 'invalid_input', details: { reason: 'file_not_visible' } });
  });

  it('refuses a file in a direct chat with a person who cannot see the project', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_004' });
    await expect(t.api.call('chats.send', { conversationId: id, body: 'Look', fileIds: ['fil_001'] })).rejects.toMatchObject({ details: { reason: 'recipient_not_on_project' } });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
  });

  it('refuses files in a project chat that has no project', async () => {
    const t = world();
    t.as('usr_001');
    const orphan = addProjectConversation(t.store.state, 'prj_001', STAMP);
    t.store.state.conversations[orphan.id].projectId = null;
    t.store.state.conversations[orphan.id].kind = 'project';
    // The Admin cannot open a project chat without a project, so the chat refuses first, as a chat that does not exist.
    await expect(t.api.call('chats.send', { conversationId: orphan.id, body: 'Hi', fileIds: ['fil_001'] })).rejects.toMatchObject({ code: 'not_found' });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
  });

  it('refuses files in a direct chat that has no other member', async () => {
    const t = world();
    t.as('usr_003');
    t.store.state.conversations.cnv_901 = { id: 'cnv_901', kind: 'direct', projectId: null, memberIds: ['usr_003'], createdAt: STAMP };
    await expect(t.api.call('chats.send', { conversationId: 'cnv_901', body: 'Hi', fileIds: ['fil_001'] })).rejects.toMatchObject({ details: { reason: 'file_not_visible' } });
  });

  it('checks every other member of a direct chat, not only the first', async () => {
    const t = world();
    t.as('usr_003');
    // A malformed chat with three members: Faisal can see the project, Omar cannot.
    t.store.state.conversations.cnv_902 = { id: 'cnv_902', kind: 'direct', projectId: null, memberIds: ['usr_002', 'usr_003', 'usr_004'] as unknown as string[], createdAt: STAMP };
    await expect(t.api.call('chats.send', { conversationId: 'cnv_902', body: 'Hi', fileIds: ['fil_001'] })).rejects.toMatchObject({ details: { reason: 'recipient_not_on_project' } });
  });

  it('allows a file in a direct chat between two people of the project', async () => {
    const t = world();
    t.as('usr_003');
    const { id } = await t.api.call('chats.openDirect', { userId: 'usr_002' });
    const sent = await t.api.call('chats.send', { conversationId: id, body: 'Look', fileIds: ['fil_001'] });
    expect(sent.files).toEqual([{ id: 'fil_001', name: 'Plan.pdf', mimeType: 'application/pdf' }]);
  });

  it('shows a deleted file as removed', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: t.room, body: 'The plan.', fileIds: ['fil_001'] });
    await t.api.call('files.delete', { id: 'fil_001' });
    const thread = await t.api.call('chats.messages', { conversationId: t.room });
    expect(thread.messages[0].message.body).toBe('The plan.');
    expect(thread.messages[0].files).toEqual([{ id: 'fil_001', name: null }]);
  });
});

describe('files.share', () => {
  it('posts a file into the project chat with the file name when no message is given', async () => {
    const t = world();
    t.as('usr_003');
    const done = await t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'project_chat' } });
    expect(done).toEqual({ kind: 'project_chat', id: t.room });
    const message = Object.values(t.store.state.messages)[0];
    expect(message).toMatchObject({ body: 'Plan.pdf', fileIds: ['fil_001'], conversationId: t.room });
  });

  it('posts a file into a task conversation, with a message', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'task', taskId: 'tsk_001' }, message: 'Please check.' });
    const listed = await t.api.call('comments.list', { targetType: 'task', targetId: 'tsk_001' });
    expect(listed[0].comment).toMatchObject({ body: 'Please check.', fileIds: ['fil_001'] });
  });

  it('refuses a task of another project', async () => {
    const t = world();
    t.store.state.tasks.tsk_002 = makeTask({ id: 'tsk_002', projectId: 'prj_002' });
    t.as('usr_001');
    await expect(t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'task', taskId: 'tsk_002' } })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('shares into a direct chat with a person of the project and makes the chat', async () => {
    const t = world();
    t.as('usr_003');
    const done = await t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'person', userId: 'usr_002' } });
    expect(t.store.state.conversations[done.id].kind).toBe('direct');
    expect(Object.values(t.store.state.messages)[0].fileIds).toEqual(['fil_001']);
  });

  it('refuses a direct chat with a person who cannot see the project and leaves no chat behind', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'person', userId: 'usr_004' } })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'recipient_not_on_project' },
    });
    expect(Object.values(t.store.state.conversations).filter((c) => c.kind === 'direct')).toHaveLength(0);
  });

  it('refuses a person outside the project as sender', async () => {
    const t = world();
    t.as('usr_004');
    await expect(t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'project_chat' } })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'person', userId: 'usr_003' } })).rejects.toMatchObject({ details: { reason: 'file_not_visible' } });
  });
});
