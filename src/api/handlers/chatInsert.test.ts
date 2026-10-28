import { beforeEach, describe, expect, it } from 'vitest';
import { chatCalls } from './chats';
import { fileCalls } from './files';
import { shareCalls } from './sharing';
import { projectCalls } from './projects';
import { addGroupConversation, addProjectConversation } from '../chatState';
import type { RoleSettings } from '../contract/entities';
import { makeProject, makeUser, NOW, STAMP, testApi } from '../../test/factories';
import { setNow } from '../../lib/dates';

beforeEach(() => setNow(NOW));

/**
 * The project files that a chat takes (fbk_070, tsk_482). The screen sends them with chats.send and fileIds, so the rules are the ones
 * of files.share: the sender and every other person of the chat must be on the project of the file, and the sender needs the switch
 * "Share files". A hidden project reads as a missing file. Faisal usr_002 leads prj_001, Sara usr_003 is on its team, Omar usr_004
 * is outside. Lina usr_006 holds a role without the switch "Share files". prj_002 is hidden: only Hala (Admin) and Faisal see it.
 */
const calls = { ...chatCalls, ...fileCalls, ...shareCalls, ...projectCalls };
const NO_SHARE: RoleSettings = { custom: [{ id: 'rol_001', name: 'Desk', nameAr: 'مكتب', rights: [], off: ['file.share'] }] };

function world() {
  const t = testApi(calls);
  const state = t.store.state;
  state.settings.roles = NO_SHARE;
  state.users.usr_006 = makeUser('usr_006', { name: 'Lina Desk', roleId: 'rol_001' });
  const room = addProjectConversation(state, 'prj_001', STAMP);
  const version = { letter: 'A', blobKey: 'blob_1', mimeType: 'application/pdf', size: 10, uploadedBy: 'usr_003', uploadedAt: STAMP };
  for (let n = 1; n <= 12; n += 1) {
    const id = `fil_${String(n).padStart(3, '0')}`;
    state.files[id] = { id, projectId: 'prj_001', stageId: null, taskId: null, name: `Sheet ${n}.pdf`, versions: [version] };
  }
  state.projects.prj_002 = makeProject({ id: 'prj_002', code: 'P-002', name: 'Secret tower', leaderId: 'usr_002' });
  state.files.fil_900 = { id: 'fil_900', projectId: 'prj_002', stageId: null, taskId: null, name: 'Secret.pdf', versions: [version] };
  // Sara and Faisal are on prj_001. A group of the two, and a group with Omar, who is outside.
  const team = addGroupConversation(state, 'Team', 'usr_003', ['usr_003', 'usr_002', 'usr_001'], STAMP);
  const mixed = addGroupConversation(state, 'Mixed', 'usr_003', ['usr_003', 'usr_002', 'usr_004'], STAMP);
  return { ...t, room: room.id, team: team.id, mixed: mixed.id };
}

const ids = (count: number) => Array.from({ length: count }, (_, i) => `fil_${String(i + 1).padStart(3, '0')}`);

describe('project files in a group, a direct chat and a project chat', () => {
  it('takes up to 10 project files in one message of a group whose people are all on the project', async () => {
    const t = world();
    t.as('usr_003');
    const sent = await t.api.call('chats.send', { conversationId: t.team, body: 'Ten sheets.', fileIds: ids(10) });
    expect(sent.message.fileIds).toEqual(ids(10));
    expect(sent.files.map((file) => file.name)).toEqual(ids(10).map((_, i) => `Sheet ${i + 1}.pdf`));
  });

  it('refuses an 11th file in one message, so the screen sends 10 in each message', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.send', { conversationId: t.team, body: 'Eleven.', fileIds: ids(11) })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
  });

  it('keeps the order of two messages that follow each other: 10 files, then 2', async () => {
    const t = world();
    t.as('usr_003');
    await t.api.call('chats.send', { conversationId: t.team, body: 'First ten.', fileIds: ids(10) });
    await t.api.call('chats.send', { conversationId: t.team, body: 'Last two.', fileIds: ids(12).slice(10) });
    const thread = await t.api.call('chats.messages', { conversationId: t.team });
    expect(thread.messages.map((view) => view.message.fileIds?.length)).toEqual([10, 2]);
  });

  it('refuses a group with a person who is not on the project, and posts nothing', async () => {
    const t = world();
    t.as('usr_003');
    await expect(t.api.call('chats.send', { conversationId: t.mixed, body: 'Look', fileIds: ['fil_001'] })).rejects.toMatchObject({
      code: 'invalid_input', details: { reason: 'recipient_not_on_project' },
    });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
  });

  it('needs the switch "Share files" for a project file in a direct chat or a group, as files.share does', async () => {
    const t = world();
    t.as('usr_006');
    const group = addGroupConversation(t.store.state, 'Desk group', 'usr_006', ['usr_006', 'usr_003', 'usr_002'], STAMP);
    await expect(t.api.call('files.share', { fileId: 'fil_001', target: { kind: 'person', userId: 'usr_003' } })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'file.share' } });
    await expect(t.api.call('chats.send', { conversationId: group.id, body: 'Look', fileIds: ['fil_001'] })).rejects.toMatchObject({ code: 'forbidden', details: { action: 'file.share' } });
    expect(Object.values(t.store.state.messages)).toHaveLength(0);
    // The person still sends a plain message in the same group.
    await expect(t.api.call('chats.send', { conversationId: group.id, body: 'Hello' })).resolves.toBeDefined();
  });

  it('takes the files of its own project in a project chat and refuses the files of another project', async () => {
    const t = world();
    t.as('usr_002');
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Own', fileIds: ids(10) })).resolves.toBeDefined();
    await expect(t.api.call('chats.send', { conversationId: t.room, body: 'Other', fileIds: ['fil_900'] })).rejects.toMatchObject({ details: { reason: 'file_other_project' } });
  });
});

describe('a hidden project in the insert path', () => {
  async function hidden() {
    const w = world();
    w.as('usr_002');
    await w.api.call('projects.setAccess', { id: 'prj_002', hidden: true, viewerIds: [] });
    return w;
  }

  it('lists no hidden project and no file of it to a person who does not see it', async () => {
    const w = await hidden();
    for (const person of ['usr_003', 'usr_004']) {
      w.as(person);
      const names = (await w.api.call('projects.list', {})).map((row) => row.project.id);
      expect(names, person).not.toContain('prj_002');
      await expect(w.api.call('files.list', { projectId: 'prj_002' }), person).rejects.toMatchObject({ code: 'not_found' });
    }
  });

  it('answers chats.send with a hidden file exactly as for a missing file, in a group, a direct chat and a project chat, and posts nothing', async () => {
    const w = await hidden();
    w.as('usr_003');
    const direct = await w.api.call('chats.openDirect', { userId: 'usr_002' });
    for (const conversationId of [w.team, direct.id, w.room]) {
      const hiddenFile = await w.api.call('chats.send', { conversationId, body: 'Look', fileIds: ['fil_900'] }).catch((error: unknown) => error as { code: string; message: string; details: unknown });
      const missing = await w.api.call('chats.send', { conversationId, body: 'Look', fileIds: ['fil_999'] }).catch((error: unknown) => error as { code: string; message: string; details: unknown });
      const shape = (error: unknown, id: string) => JSON.parse(JSON.stringify(error, ['code', 'message', 'details', 'reason', 'fields']).split(id).join('@')) as unknown;
      expect(shape(hiddenFile, 'fil_900'), conversationId).toEqual(shape(missing, 'fil_999'));
      expect(hiddenFile, conversationId).toMatchObject({ code: 'invalid_input', details: { reason: 'file_missing' } });
    }
    expect(Object.values(w.store.state.messages)).toHaveLength(0);
  });
});
