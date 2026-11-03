import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { contentCalls } from './content';
import { projectCalls } from './projects';
import { addProjectConversation } from '../chatState';
import type { FileRec, RoleSettings } from '../contract/entities';
import { makeProject, makeTask, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { memberKey } from '../rowKeys';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The switch "Share files" in a project chat and on the comments of a to-do (owner, 2026-11-03: "Server follows switch"). The catalog says
 * "Share a project file into a chat or a to-do", and files.share asks the switch for every target. chats.send and comments.create also carry
 * the files that the person uploaded for the message, so without the switch a person, or the agent of that person, may attach only a file
 * whose newest version the person or that agent uploaded. Lina usr_006 is on the team of prj_001 with a role that has the switch off.
 * usr_007 is the agent of Lina. Sara usr_003 is on the team with the switch on.
 */
const calls = { ...chatCalls, ...contentCalls, ...projectCalls };
const NO_SHARE: RoleSettings = { custom: [{ id: 'rol_001', name: 'Desk', nameAr: 'مكتب', rights: [], off: ['file.share'] }] };

const version = (letter: string, uploadedBy: string) => ({ letter, blobKey: `blob_${letter}_${uploadedBy}`, mimeType: 'application/pdf', size: 10, uploadedBy, uploadedAt: STAMP });
const file = (id: string, ...uploaders: string[]): FileRec => ({
  id, projectId: 'prj_001', stageId: null, taskId: null, name: `${id}.pdf`, versions: uploaders.map((by, i) => version(String.fromCharCode(65 + i), by)),
});

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = NO_SHARE;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Desk', roleId: 'rol_001' });
  state.users.usr_007 = makeUser('usr_007', { name: 'Lina Assistant', kind: 'agent', discipline: 'Agent', ownerId: 'usr_006' });
  state.members[memberKey('prj_001', 'usr_006')] = { projectId: 'prj_001', userId: 'usr_006', discipline: 'Architect' };
  state.tasks.tsk_001 = makeTask();
  state.files.fil_101 = file('fil_101', 'usr_003');
  state.files.fil_102 = file('fil_102', 'usr_006');
  state.files.fil_103 = file('fil_103', 'usr_007');
  // A new version by Lina of a file that Sara started (an upload with the same name adds a version), and the other way round.
  state.files.fil_104 = file('fil_104', 'usr_003', 'usr_006');
  state.files.fil_105 = file('fil_105', 'usr_006', 'usr_003');
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'P-002', name: 'Secret tower', leaderId: 'usr_002' });
  state.files.fil_106 = { ...file('fil_106', 'usr_002'), projectId: 'prj_002' };
  const room = addProjectConversation(state, 'prj_001', STAMP);
  return { ...t, room: room.id };
}

const filesIn = (t: ReturnType<typeof world>) => Object.values(t.store.state.messages).filter((m) => (m.fileIds?.length ?? 0) > 0).length;
// fil_101: uploaded by Sara. fil_102: by Lina. fil_103: by the agent of Lina. fil_104: started by Sara, newest version by Lina.
// fil_105: started by Lina, newest version by Sara. fil_106: a file of the hidden prj_002. fil_999: no such file.
const refused = { code: 'forbidden', details: { action: 'file.share' } };

describe('the switch "Share files" in a project chat', () => {
  it('refuses the file of another person to a person without the switch, and posts nothing', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Look', fileIds: ['fil_101'] })).rejects.toMatchObject(refused);
    expect(filesIn(t)).toBe(0);
  });

  it('takes a file that the person or the agent of the person uploaded, so an upload in the chat still works', async () => {
    const t = world();
    t.as('usr_006');
    const sent = await t.api.call('chats.send', { conversationId: t.room, body: 'Mine', fileIds: ['fil_102', 'fil_103'] });
    expect(sent.message.fileIds).toEqual(['fil_102', 'fil_103']);
  });

  it('reads the newest version: a new version by the person counts as the person\'s file, a newer version by another person does not', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'New version', fileIds: ['fil_104'] })).resolves.toBeDefined();
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Other', fileIds: ['fil_105'] })).rejects.toMatchObject(refused);
  });

  it('gives the agent of the person the same rule: the files of the person pass, the file of another person does not', async () => {
    const t = world();
    t.as('usr_007');
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Lina file', fileIds: ['fil_102'] })).resolves.toBeDefined();
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Sara file', fileIds: ['fil_101'] })).rejects.toMatchObject(refused);
  });

  it('keeps every file for a person with the switch', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'All', fileIds: ['fil_101', 'fil_102', 'fil_103'] })).resolves.toBeDefined();
  });

  it('answers a file that the person may not see as a missing file first, so the refusal tells nothing about it', async () => {
    const t = world();
    await t.api.call('projects.setAccess', { id: 'prj_002', hidden: true, viewerIds: [] }).catch(() => undefined);
    t.as('usr_006');
    for (const fileId of ['fil_106', 'fil_999']) {
      await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Look', fileIds: [fileId] }), fileId).rejects.toMatchObject({
        code: 'invalid_input', details: { reason: 'file_missing' },
      });
    }
  });
});

describe('the switch "Share files" on the comments of a to-do', () => {
  it('refuses the file of another person, and takes the own file, for the person and for the agent of the person', async () => {
    const t = world();
    for (const actor of ['usr_006', 'usr_007']) {
      t.as(actor);
      await expect(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Sheet', fileIds: ['fil_101'] }), actor).rejects.toMatchObject(refused);
      await expect(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Mine', fileIds: ['fil_102'] }), actor).resolves.toBeDefined();
    }
    expect(Object.values(t.store.state.comments).filter((c) => c.fileIds?.includes('fil_101'))).toHaveLength(0);
  });

  it('keeps a comment with no file for a person without the switch', async () => {
    const t = world();
    t.as('usr_006');
    await expect(t.api.call('comments.create', { targetType: 'task', targetId: 'tsk_001', body: 'Done.' })).resolves.toBeDefined();
  });
});
